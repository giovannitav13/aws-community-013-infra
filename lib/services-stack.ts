import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
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
  httpsListener: elbv2.ApplicationListener;
  repoServiceA: ecr.IRepository;
  repoServiceB: ecr.IRepository;
  repoServiceC: ecr.IRepository;
}

export class ServicesStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const { env } = props.config;

    // --- Service A (Spring Boot, port 8080) ---
    // Public (ALB), publishes to SNS, calls Service B via Service Connect
    const taskDefA = new ecs.FargateTaskDefinition(this, 'TaskDefA', {
      family: `service-a-${env}-task`,
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefA.addContainer('app', {
      containerName: `service-a-${env}`,
      image: ecs.ContainerImage.fromEcrRepository(props.repoServiceA, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `service-a-${env}`,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(props.postgresSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(props.postgresSecret, 'password'),
        API_KEY: ecs.Secret.fromSecretsManager(props.apiKeySecret),
      },
      environment: {
        DB_URL: 'jdbc:postgresql://postgres:5432/postgres',
        SNS_TOPIC_ARN: props.topic.topicArn,
        SERVICE_B_URL: 'http://service-b:8000',
        SERVICE_NAME: 'service-a',
        ENV: env,
      },
      portMappings: [
        {
          containerPort: 8080,
          name: 'service-a',
          appProtocol: ecs.AppProtocol.http,
        },
      ],
    });

    props.topic.grantPublish(taskDefA.taskRole);
    props.postgresSecret.grantRead(taskDefA.taskRole);
    props.apiKeySecret.grantRead(taskDefA.taskRole);

    const serviceA = new ecs.FargateService(this, 'ServiceA', {
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
            port: 8080,
          },
        ],
      },
      enableExecuteCommand: true,
    });

    // --- Service B (FastAPI, port 8000) ---
    // Internal only (Service Connect), consumes SQS-alfa
    const taskDefB = new ecs.FargateTaskDefinition(this, 'TaskDefB', {
      family: `service-b-${env}-task`,
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefB.addContainer('app', {
      containerName: `service-b-${env}`,
      image: ecs.ContainerImage.fromEcrRepository(props.repoServiceB, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `service-b-${env}`,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(props.postgresSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(props.postgresSecret, 'password'),
        API_KEY: ecs.Secret.fromSecretsManager(props.apiKeySecret),
      },
      environment: {
        DB_HOST: 'postgres',
        DB_PORT: '5432',
        DB_NAME: 'postgres',
        SQS_ALFA_URL: props.sqsAlfa.queueUrl,
        SERVICE_NAME: 'service-b',
        ENV: env,
      },
      portMappings: [
        {
          containerPort: 8000,
          name: 'service-b',
          appProtocol: ecs.AppProtocol.http,
        },
      ],
    });

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
            port: 8000,
          },
        ],
      },
      enableExecuteCommand: true,
    });

    // --- Service C (Spring Boot, port 8080) ---
    // Public (ALB), consumes SQS-beta
    const taskDefC = new ecs.FargateTaskDefinition(this, 'TaskDefC', {
      family: `service-c-${env}-task`,
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefC.addContainer('app', {
      containerName: `service-c-${env}`,
      image: ecs.ContainerImage.fromEcrRepository(props.repoServiceC, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `service-c-${env}`,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(props.postgresSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(props.postgresSecret, 'password'),
        API_KEY: ecs.Secret.fromSecretsManager(props.apiKeySecret),
      },
      environment: {
        DB_URL: 'jdbc:postgresql://postgres:5432/postgres',
        SQS_BETA_URL: props.sqsBeta.queueUrl,
        SERVICE_NAME: 'service-c',
        ENV: env,
      },
      portMappings: [
        {
          containerPort: 8080,
          name: 'service-c',
          appProtocol: ecs.AppProtocol.http,
        },
      ],
    });

    props.sqsBeta.grantConsumeMessages(taskDefC.taskRole);
    props.postgresSecret.grantRead(taskDefC.taskRole);
    props.apiKeySecret.grantRead(taskDefC.taskRole);

    const serviceC = new ecs.FargateService(this, 'ServiceC', {
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
            port: 8080,
          },
        ],
      },
      enableExecuteCommand: true,
    });

    // --- ALB Target Groups ---
    // Registered here to avoid cyclic dependency between AlbStack and ServicesStack

    props.httpsListener.addTargets('TgServiceA', {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [serviceA],
      healthCheck: {
        path: '/api/service-a/ultimi-numeri',
        healthyHttpCodes: '200',
        port: '8080',
      },
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/service-a/*'])],
    });

    props.httpsListener.addTargets('TgServiceC', {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [serviceC],
      healthCheck: {
        path: '/api/service-c/health',
        healthyHttpCodes: '200',
        port: '8080',
      },
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/service-c/*'])],
    });

    cdk.Tags.of(this).add('Project', `Infra001-Services-${env}`);
  }
}
