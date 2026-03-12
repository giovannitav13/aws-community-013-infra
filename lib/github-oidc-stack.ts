import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface GithubOidcStackProps extends cdk.StackProps {
  config: EnvConfig;
  frontendBucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
  repoServiceA: ecr.IRepository;
  repoServiceB: ecr.IRepository;
  repoServiceC: ecr.IRepository;
  cluster: ecs.ICluster;
}

export class GithubOidcStack extends cdk.Stack {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const { env } = props.config;

    // OIDC Provider for GitHub Actions
    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
    });

    // Trusted GitHub repos
    const trustedRepos = [
      `repo:giovannitav13/aws-community-013-ui:ref:refs/heads/main`,
      `repo:giovannitav13/aws-community-013-monorepo-microservice:ref:refs/heads/main`,
    ];

    // IAM Role for GitHub Actions
    this.role = new iam.Role(this, 'GithubActionsRole', {
      roleName: `github-actions-role-${env}`,
      assumedBy: new iam.WebIdentityPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': trustedRepos,
          },
        },
      ),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // S3 permissions for frontend deployment
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [
          props.frontendBucket.bucketArn,
          `${props.frontendBucket.bucketArn}/*`,
        ],
      }),
    );

    // CloudFront invalidation
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${props.distribution.distributionId}`,
        ],
      }),
    );

    // ECR auth token (must be *)
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );

    // ECR push permissions
    const ecrRepos = [props.repoServiceA, props.repoServiceB, props.repoServiceC];
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
        ],
        resources: ecrRepos.map((repo) => repo.repositoryArn),
      }),
    );

    // ECS UpdateService permissions
    const serviceNames = ['service-a', 'service-b', 'service-c'];
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:UpdateService'],
        resources: serviceNames.map(
          (svc) =>
            `arn:aws:ecs:${this.region}:${this.account}:service/${props.cluster.clusterName}/${svc}-${env}-fargate`,
        ),
      }),
    );

    // Output the Role ARN
    new cdk.CfnOutput(this, 'GithubActionsRoleArn', {
      exportName: `GithubActionsRoleArn-${env}`,
      value: this.role.roleArn,
    });

    cdk.Tags.of(this).add('Project', `Infra001-GithubOidc-${env}`);
  }
}
