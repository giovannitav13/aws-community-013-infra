import * as cdk from 'aws-cdk-lib/core';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface StorageStackProps extends cdk.StackProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
  efsSecurityGroup: ec2.ISecurityGroup;
}

export class StorageStack extends cdk.Stack {
  public readonly fileSystem: efs.FileSystem;
  public readonly efsAccessPoint: efs.AccessPoint;
  public readonly postgresSecret: secretsmanager.Secret;
  public readonly apiKeySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { env } = props.config;

    // EFS for Postgres data persistence
    this.fileSystem = new efs.FileSystem(this, 'PostgresEfs', {
      fileSystemName: `postgres-${env}-efs`,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: props.efsSecurityGroup,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Access point for Postgres container (uid/gid 999 = postgres user)
    this.efsAccessPoint = this.fileSystem.addAccessPoint('PostgresAccessPoint', {
      path: '/postgres-data',
      createAcl: {
        ownerGid: '999',
        ownerUid: '999',
        permissions: '755',
      },
      posixUser: {
        gid: '999',
        uid: '999',
      },
    });

    // Postgres credentials
    this.postgresSecret = new secretsmanager.Secret(this, 'PostgresSecret', {
      secretName: `postgres-${env}-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 24,
      },
    });

    // API key secret (placeholder for services)
    this.apiKeySecret = new secretsmanager.Secret(this, 'ApiKeySecret', {
      secretName: `api-key-${env}-secret`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    cdk.Tags.of(this).add('Project', `Infra001-Storage-${env}`);
  }
}
