import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface AlbStackProps extends cdk.StackProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
  albSecurityGroup: ec2.ISecurityGroup;
  hostedZone: route53.IHostedZone;
  certificate: acm.ICertificate;
  serviceA: ecs.FargateService;
  serviceC: ecs.FargateService;
}

export class AlbStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AlbStackProps) {
    super(scope, id, props);

    const { env, domain, backendSubdomain } = props.config;
    const backendFqdn = `${backendSubdomain}.${domain}`;

    // ALB in public subnets
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `alb-${env}`,
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // HTTP listener -> redirect to HTTPS
    alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // HTTPS listener
    const httpsListener = alb.addListener('HttpsListener', {
      port: 443,
      certificates: [props.certificate],
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'Not Found',
      }),
    });

    // Target Group Service A: /api/service-a/*
    const tgA = new elbv2.ApplicationTargetGroup(this, 'TgServiceA', {
      targetGroupName: `tg-service-a-${env}`,
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [props.serviceA],
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200',
      },
    });

    httpsListener.addTargetGroups('ServiceARule', {
      targetGroups: [tgA],
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/service-a/*'])],
    });

    // Target Group Service C: /api/service-c/*
    const tgC = new elbv2.ApplicationTargetGroup(this, 'TgServiceC', {
      targetGroupName: `tg-service-c-${env}`,
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [props.serviceC],
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200',
      },
    });

    httpsListener.addTargetGroups('ServiceCRule', {
      targetGroups: [tgC],
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/service-c/*'])],
    });

    // Route53 A record -> ALB
    new route53.ARecord(this, 'BackendAliasRecord', {
      recordName: backendFqdn,
      zone: props.hostedZone,
      target: route53.RecordTarget.fromAlias(
        new targets.LoadBalancerTarget(alb),
      ),
    });

    cdk.Tags.of(this).add('Project', `Infra001-Alb-${env}`);
  }
}
