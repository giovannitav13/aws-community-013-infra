import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface NetworkingStackProps extends cdk.StackProps {
  config: EnvConfig;
}

export class NetworkingStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly servicesSecurityGroup: ec2.SecurityGroup;
  public readonly postgresSecurityGroup: ec2.SecurityGroup;
  public readonly efsSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkingStackProps) {
    super(scope, id, props);

    const { env } = props.config;

    // VPC: 2 AZ, 2 public + 2 private subnets, 1 NAT Gateway
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `vpc-${env}`,
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: `public-${env}`,
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: `private-${env}`,
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Security Group: ALB (ingress HTTP/HTTPS from internet)
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      securityGroupName: `alb-${env}-sg`,
      vpc: this.vpc,
      description: 'Security group for the public ALB',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS from internet',
    );
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from internet (redirect to HTTPS)',
    );

    // Security Group: Fargate services (private group cluster)
    this.servicesSecurityGroup = new ec2.SecurityGroup(this, 'ServicesSg', {
      securityGroupName: `services-${env}-sg`,
      vpc: this.vpc,
      description: 'Security group for Fargate services',
      allowAllOutbound: true,
    });
    this.servicesSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(8080),
      'Allow traffic from ALB on port 8080',
    );
    // Allow service-to-service communication via Service Connect
    this.servicesSecurityGroup.addIngressRule(
      this.servicesSecurityGroup,
      ec2.Port.allTcp(),
      'Allow internal service-to-service traffic',
    );

    // Security Group: Postgres
    this.postgresSecurityGroup = new ec2.SecurityGroup(this, 'PostgresSg', {
      securityGroupName: `postgres-${env}-sg`,
      vpc: this.vpc,
      description: 'Security group for Postgres on Fargate',
      allowAllOutbound: true,
    });
    this.postgresSecurityGroup.addIngressRule(
      this.servicesSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Postgres access from Fargate services',
    );

    // Security Group: EFS
    this.efsSecurityGroup = new ec2.SecurityGroup(this, 'EfsSg', {
      securityGroupName: `efs-${env}-sg`,
      vpc: this.vpc,
      description: 'Security group for EFS',
      allowAllOutbound: true,
    });
    this.efsSecurityGroup.addIngressRule(
      this.postgresSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow NFS from Postgres task',
    );

    cdk.Tags.of(this).add('Project', `Infra001-Networking-${env}`);
  }
}
