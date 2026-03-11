import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface ClusterStackProps extends cdk.StackProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
  postgresSecurityGroup: ec2.ISecurityGroup;
  fileSystem: efs.IFileSystem;
  efsAccessPoint: efs.IAccessPoint;
  postgresSecret: secretsmanager.ISecret;
}

export class ClusterStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly defaultCloudMapNamespace: string;

  constructor(scope: Construct, id: string, props: ClusterStackProps) {
    super(scope, id, props);

    const { env } = props.config;

    const namespaceName = `infra001-${env.toLowerCase()}`;

    // ECS Cluster with Service Connect
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `cluster-${env}`,
      vpc: props.vpc,
      defaultCloudMapNamespace: {
        name: namespaceName,
      },
    });
    this.defaultCloudMapNamespace = namespaceName;

    // --- Postgres Fargate Task ---
    // In production, use RDS Postgres instead of Fargate+EFS for
    // better persistence, automated backups, and reliability.
    // This approach is intentional to reduce costs in test environments.

    const postgresTaskDef = new ecs.FargateTaskDefinition(this, 'PostgresTaskDef', {
      family: `postgres-${env}-task`,
      cpu: 256,
      memoryLimitMiB: 512,
    });

    // EFS volume
    postgresTaskDef.addVolume({
      name: 'postgres-data',
      efsVolumeConfiguration: {
        fileSystemId: props.fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: props.efsAccessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Grant EFS access to task role
    props.fileSystem.grant(postgresTaskDef.taskRole, 'elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite');

    const postgresContainer = postgresTaskDef.addContainer('postgres', {
      containerName: `postgres-${env}`,
      image: ecs.ContainerImage.fromRegistry('postgres:15'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `postgres-${env}`,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      secrets: {
        POSTGRES_USER: ecs.Secret.fromSecretsManager(props.postgresSecret, 'username'),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(props.postgresSecret, 'password'),
      },
      environment: {
        PGDATA: '/var/lib/postgresql/data/pgdata',
      },
      portMappings: [
        {
          containerPort: 5432,
          name: 'postgres',
        },
      ],
    });

    postgresContainer.addMountPoints({
      sourceVolume: 'postgres-data',
      containerPath: '/var/lib/postgresql/data',
      readOnly: false,
    });

    const postgresService = new ecs.FargateService(this, 'PostgresService', {
      serviceName: `postgres-${env}-service`,
      cluster: this.cluster,
      taskDefinition: postgresTaskDef,
      desiredCount: 1,
      securityGroups: [props.postgresSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      serviceConnectConfiguration: {
        services: [
          {
            portMappingName: 'postgres',
            dnsName: 'postgres',
            port: 5432,
          },
        ],
      },
      enableExecuteCommand: true,
    });

    // Ensure the Cloud Map namespace is fully created before the service
    postgresService.node.addDependency(this.cluster);

    cdk.Tags.of(this).add('Project', `Infra001-Cluster-${env}`);
  }
}
