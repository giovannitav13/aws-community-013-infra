import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface ServicesStackProps extends cdk.StackProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  servicesSecurityGroup: ec2.ISecurityGroup;
  topic: sns.ITopic;
  sqsAlfa: sqs.IQueue;
  sqsBeta: sqs.IQueue;
  postgresSecret: secretsmanager.ISecret;
  apiKeySecret: secretsmanager.ISecret;
}

export class ServicesStack extends cdk.Stack {
  public readonly serviceA: ecs.FargateService;
  public readonly serviceC: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const { env } = props.config;

    // --- Service A ---
    // Public (ALB), publishes to SNS, calls Service B via Service Connect
    const taskDefA = new ecs.FargateTaskDefinition(this, 'TaskDefA', {
      family: `service-a-${env}-task`,
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefA.addContainer('app', {
      containerName: `service-a-${env}`,
      image: ecs.ContainerImage.fromRegistry('nginx'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `service-a-${env}`,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      secrets: {
        POSTGRES_SECRET: ecs.Secret.fromSecretsManager(props.postgresSecret),
        API_KEY: ecs.Secret.fromSecretsManager(props.apiKeySecret),
      },
      environment: {
        SERVICE_NAME: 'service-a',
        ENV: env,
      },
      portMappings: [
        {
          containerPort: 80,
          name: 'service-a',
          appProtocol: ecs.AppProtocol.http,
        },
      ],
    });

    // IAM: SNS publish, Secrets Manager read
    props.topic.grantPublish(taskDefA.taskRole);
    props.postgresSecret.grantRead(taskDefA.taskRole);
    props.apiKeySecret.grantRead(taskDefA.taskRole);

    this.serviceA = new ecs.FargateService(this, 'ServiceA', {
      serviceName: `service-a-${env}-fargate`,
      cluster: props.cluster,
      taskDefinition: taskDefA,
      desiredCount: 1,
      securityGroups: [props.servicesSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      serviceConnectConfiguration: {
        services: [
          {
            portMappingName: 'service-a',
            dnsName: 'service-a',
            port: 80,
          },
        ],
      },
      enableExecuteCommand: true,
    });

    // --- Service B ---
    // Internal only (Service Connect), consumes SQS-alfa
    const taskDefB = new ecs.FargateTaskDefinition(this, 'TaskDefB', {
      family: `service-b-${env}-task`,
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefB.addContainer('app', {
      containerName: `service-b-${env}`,
      image: ecs.ContainerImage.fromRegistry('nginx'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `service-b-${env}`,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      secrets: {
        POSTGRES_SECRET: ecs.Secret.fromSecretsManager(props.postgresSecret),
        API_KEY: ecs.Secret.fromSecretsManager(props.apiKeySecret),
      },
      environment: {
        SERVICE_NAME: 'service-b',
        ENV: env,
      },
      portMappings: [
        {
          containerPort: 80,
          name: 'service-b',
          appProtocol: ecs.AppProtocol.http,
        },
      ],
    });

    // IAM: SQS consume, Secrets Manager read
    props.sqsAlfa.grantConsumeMessages(taskDefB.taskRole);
    props.postgresSecret.grantRead(taskDefB.taskRole);
    props.apiKeySecret.grantRead(taskDefB.taskRole);

    new ecs.FargateService(this, 'ServiceB', {
      serviceName: `service-b-${env}-fargate`,
      cluster: props.cluster,
      taskDefinition: taskDefB,
      desiredCount: 1,
      securityGroups: [props.servicesSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      serviceConnectConfiguration: {
        services: [
          {
            portMappingName: 'service-b',
            dnsName: 'service-b',
            port: 80,
          },
        ],
      },
      enableExecuteCommand: true,
    });

    // --- Service C ---
    // Public (ALB), consumes SQS-beta
    const taskDefC = new ecs.FargateTaskDefinition(this, 'TaskDefC', {
      family: `service-c-${env}-task`,
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefC.addContainer('app', {
      containerName: `service-c-${env}`,
      image: ecs.ContainerImage.fromRegistry('nginx'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `service-c-${env}`,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      secrets: {
        POSTGRES_SECRET: ecs.Secret.fromSecretsManager(props.postgresSecret),
        API_KEY: ecs.Secret.fromSecretsManager(props.apiKeySecret),
      },
      environment: {
        SERVICE_NAME: 'service-c',
        ENV: env,
      },
      portMappings: [
        {
          containerPort: 80,
          name: 'service-c',
          appProtocol: ecs.AppProtocol.http,
        },
      ],
    });

    // IAM: SQS consume, Secrets Manager read
    props.sqsBeta.grantConsumeMessages(taskDefC.taskRole);
    props.postgresSecret.grantRead(taskDefC.taskRole);
    props.apiKeySecret.grantRead(taskDefC.taskRole);

    this.serviceC = new ecs.FargateService(this, 'ServiceC', {
      serviceName: `service-c-${env}-fargate`,
      cluster: props.cluster,
      taskDefinition: taskDefC,
      desiredCount: 1,
      securityGroups: [props.servicesSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      serviceConnectConfiguration: {
        services: [
          {
            portMappingName: 'service-c',
            dnsName: 'service-c',
            port: 80,
          },
        ],
      },
      enableExecuteCommand: true,
    });

    cdk.Tags.of(this).add('Project', `Infra001-Services-${env}`);
  }
}
