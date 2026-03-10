# CDK Microservices Infrastructure

AWS CDK TypeScript project for a microservices architecture on ECS Fargate. Multi-environment (DEV, STAGING, PROD) on a single AWS account, with environment selection at deploy time via `--context env=DEV`.

All resource names include the environment suffix. Every stack auto-tags its resources with `Project: Infra001-<StackName>-<ENV>`.

---

## Stack overview

The project is split into 9 independent stacks with explicit dependencies via `addDependency()`.

```
NetworkingStack ─┬──────────────────────────────────► AlbStack
                 ├──► StorageStack ──► ClusterStack ──► ServicesStack ──► AlbStack
                 └──► ServicesStack

DnsStack ────────┬──► FrontendStack
                 └──► AlbStack

MessagingStack ──► ServicesStack

EcrStack (no dependencies)
```

---

## 1. NetworkingStack

**File:** `lib/networking-stack.ts`

Creates the network foundation for the entire infrastructure.

**Resources:**
- **VPC** (`vpc-{ENV}`) — CIDR `10.0.0.0/16`, 2 Availability Zones
- **2 public subnets** (`/24` each) — used by the ALB
- **2 private subnets** (`/24` each) — used by Fargate tasks and Postgres
- **1 NAT Gateway** — allows private subnets to reach the internet (ECR pulls, Secrets Manager, SNS, SQS)
- **4 Security Groups:**

| Security Group | Inbound rules |
|---|---|
| `alb-{ENV}-sg` | TCP 80, 443 from `0.0.0.0/0` |
| `services-{ENV}-sg` | TCP 80 from ALB SG; all TCP from itself (Service Connect) |
| `postgres-{ENV}-sg` | TCP 5432 from services SG |
| `efs-{ENV}-sg` | TCP 2049 (NFS) from postgres SG |

**Exposed props:** `vpc`, `albSecurityGroup`, `servicesSecurityGroup`, `postgresSecurityGroup`, `efsSecurityGroup`

---

## 2. DnsStack

**File:** `lib/dns-stack.ts`

Manages DNS and TLS certificates. The Route53 hosted zone for `dev-tool.click` must already exist in the AWS account.

**Resources:**
- **Hosted Zone lookup** — references the existing `dev-tool.click` zone
- **ACM Certificate** (`frontend-{ENV}-cert`) — for `nuova-app.dev-tool.click`, DNS-validated
- **ACM Certificate** (`backend-{ENV}-cert`) — for `nuova-app-be.dev-tool.click`, DNS-validated

Route53 alias records (A records pointing to CloudFront and ALB) are created in FrontendStack and AlbStack respectively, where the target resources are available.

**Exposed props:** `hostedZone`, `frontendCertificate`, `backendCertificate`

---

## 3. MessagingStack

**File:** `lib/messaging-stack.ts`

Fan-out messaging pattern: one SNS topic fans out to two SQS queues, each consumed by a different service.

**Resources:**
- **SNS Topic** (`topic-{ENV}`) — Service A publishes here
- **SQS-alfa** (`sqs-alfa-{ENV}-queue`) — subscribed to the SNS topic, consumed by Service B
- **SQS-beta** (`sqs-beta-{ENV}-queue`) — subscribed to the SNS topic, consumed by Service C
- **DLQ-alfa** (`sqs-alfa-{ENV}-dlq`) — dead letter queue for SQS-alfa, maxReceiveCount: 3, retention: 14 days
- **DLQ-beta** (`sqs-beta-{ENV}-dlq`) — dead letter queue for SQS-beta, maxReceiveCount: 3, retention: 14 days

**Exposed props:** `topic`, `sqsAlfa`, `sqsBeta`

---

## 4. StorageStack

**File:** `lib/storage-stack.ts`
**Depends on:** NetworkingStack

Persistent storage and secrets for the platform.

**Resources:**
- **EFS File System** (`postgres-{ENV}-efs`) — in private subnets, general purpose performance mode, `DESTROY` removal policy
- **EFS Access Point** — path `/postgres-data`, POSIX user uid/gid `999` (postgres user in the official image)
- **Secrets Manager — Postgres credentials** (`postgres-{ENV}-credentials`) — auto-generated JSON `{"username": "postgres", "password": "<random-24-chars>"}`
- **Secrets Manager — API key** (`api-key-{ENV}-secret`) — auto-generated random string, 32 chars

**Exposed props:** `fileSystem`, `efsAccessPoint`, `postgresSecret`, `apiKeySecret`

---

## 5. EcrStack

**File:** `lib/ecr-stack.ts`

Container image repositories. No dependencies on other stacks.

**Resources:**
- `repo-service-a-{env}` — for Service A
- `repo-service-b-{env}` — for Service B
- `repo-service-c-{env}` — for Service C

All repositories have `DESTROY` removal policy and `emptyOnDelete: true` for easy teardown. Repository names are lowercase (ECR requirement). Postgres uses the public `postgres:15` image — no ECR repo needed.

---

## 6. ClusterStack

**File:** `lib/cluster-stack.ts`
**Depends on:** NetworkingStack, StorageStack

ECS cluster and the Postgres database task.

**Resources:**
- **ECS Cluster** (`cluster-{ENV}`) — with Cloud Map namespace `infra001-{env}` for Service Connect
- **Postgres Fargate Task:**
  - Image: `postgres:15` (public)
  - CPU: 256, Memory: 512 MiB
  - EFS volume mounted at `/var/lib/postgresql/data` with transit encryption
  - Credentials injected from Secrets Manager (`POSTGRES_USER`, `POSTGRES_PASSWORD`)
  - `PGDATA` set to `/var/lib/postgresql/data/pgdata` (required when mounting a volume at the default data dir)
  - Service Connect name: `postgres` (reachable as `postgres:5432` from other services)
  - Dedicated security group: only port 5432 from services SG
  - `enableExecuteCommand: true` for debugging via `aws ecs execute-command`
  - CloudWatch Logs with 1-week retention

> **Production note:** In a real production environment, use Amazon RDS for PostgreSQL instead of Fargate+EFS. RDS provides automated backups, point-in-time recovery, Multi-AZ, and managed maintenance. The Fargate+EFS approach is a deliberate choice to keep costs low in test/demo environments.

**Exposed props:** `cluster`, `defaultCloudMapNamespace`

---

## 7. ServicesStack

**File:** `lib/services-stack.ts`
**Depends on:** ClusterStack, MessagingStack, StorageStack

The three application microservices. All use `nginx` as a placeholder image — CI/CD pipelines will push real images to ECR and update task definitions.

### Service A (`service-a-{ENV}-fargate`)
- **Publicly exposed** via ALB (`/api/service-a/*`)
- Publishes messages to the SNS topic
- Calls Service B internally via Service Connect (`http://service-b:80`)
- Service Connect name: `service-a`
- IAM: `sns:Publish`, Secrets Manager read

### Service B (`service-b-{ENV}-fargate`)
- **Internal only** — no ALB target group, reachable only via Service Connect
- Consumes messages from SQS-alfa (polling)
- Service Connect name: `service-b`
- IAM: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`, Secrets Manager read

### Service C (`service-c-{ENV}-fargate`)
- **Publicly exposed** via ALB (`/api/service-c/*`)
- Consumes messages from SQS-beta (polling)
- Service Connect name: `service-c`
- IAM: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`, Secrets Manager read

All services: CPU 256, Memory 512 MiB, private subnets, CloudWatch Logs (1-week retention), `enableExecuteCommand: true`.

**Exposed props:** `serviceA`, `serviceC` (needed by AlbStack for target group registration)

---

## 8. FrontendStack

**File:** `lib/frontend-stack.ts`
**Depends on:** DnsStack

Static frontend hosting.

**Resources:**
- **S3 Bucket** (`nuova-app.dev-tool.click-{env}`) — `BLOCK_ALL` public access, `DESTROY` removal policy, `autoDeleteObjects: true`
- **CloudFront Distribution** — Origin Access Control (OAC) to S3, HTTPS redirect, `CACHING_OPTIMIZED` cache policy
- **SPA routing** — 403 and 404 errors return `/index.html` with status 200 (for client-side routing)
- **Route53 A record** — `nuova-app.dev-tool.click` → CloudFront distribution

---

## 9. AlbStack

**File:** `lib/alb-stack.ts`
**Depends on:** NetworkingStack, DnsStack, ServicesStack

Public-facing load balancer with path-based routing to backend services.

**Resources:**
- **ALB** (`alb-{ENV}`) — internet-facing, in public subnets
- **HTTP Listener** (port 80) — permanent redirect to HTTPS
- **HTTPS Listener** (port 443) — ACM certificate for `nuova-app-be.dev-tool.click`
  - Default action: 404 fixed response
  - Priority 10: `/api/service-a/*` → Target Group Service A
  - Priority 20: `/api/service-c/*` → Target Group Service C
- **Target Groups** — HTTP health check on `/`, expecting 200
- **Route53 A record** — `nuova-app-be.dev-tool.click` → ALB

Service B has no target group — it is intentionally not exposed through the ALB.
