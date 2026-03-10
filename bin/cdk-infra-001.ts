#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { getConfig, Environment } from '../lib/config';
import { NetworkingStack } from '../lib/networking-stack';
import { DnsStack } from '../lib/dns-stack';
import { MessagingStack } from '../lib/messaging-stack';
import { StorageStack } from '../lib/storage-stack';
import { EcrStack } from '../lib/ecr-stack';
import { ClusterStack } from '../lib/cluster-stack';
import { ServicesStack } from '../lib/services-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { AlbStack } from '../lib/alb-stack';

const app = new cdk.App();

const envName = (app.node.tryGetContext('env') as Environment) || 'DEV';
const config = getConfig(envName);

const awsEnv: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const networking = new NetworkingStack(app, `NetworkingStack-${envName}`, {
  config,
  env: awsEnv,
});

const dns = new DnsStack(app, `DnsStack-${envName}`, {
  config,
  env: awsEnv,
});

const messaging = new MessagingStack(app, `MessagingStack-${envName}`, {
  config,
  env: awsEnv,
});

const storage = new StorageStack(app, `StorageStack-${envName}`, {
  config,
  vpc: networking.vpc,
  efsSecurityGroup: networking.efsSecurityGroup,
  env: awsEnv,
});
storage.addDependency(networking);

const ecr = new EcrStack(app, `EcrStack-${envName}`, {
  config,
  env: awsEnv,
});

const cluster = new ClusterStack(app, `ClusterStack-${envName}`, {
  config,
  vpc: networking.vpc,
  postgresSecurityGroup: networking.postgresSecurityGroup,
  fileSystem: storage.fileSystem,
  efsAccessPoint: storage.efsAccessPoint,
  postgresSecret: storage.postgresSecret,
  env: awsEnv,
});
cluster.addDependency(networking);
cluster.addDependency(storage);

const albStack = new AlbStack(app, `AlbStack-${envName}`, {
  config,
  vpc: networking.vpc,
  albSecurityGroup: networking.albSecurityGroup,
  hostedZone: dns.hostedZone,
  certificate: dns.backendCertificate,
  env: awsEnv,
});
albStack.addDependency(networking);
albStack.addDependency(dns);

const services = new ServicesStack(app, `ServicesStack-${envName}`, {
  config,
  vpc: networking.vpc,
  cluster: cluster.cluster,
  servicesSecurityGroup: networking.servicesSecurityGroup,
  topic: messaging.topic,
  sqsAlfa: messaging.sqsAlfa,
  sqsBeta: messaging.sqsBeta,
  postgresSecret: storage.postgresSecret,
  apiKeySecret: storage.apiKeySecret,
  httpsListener: albStack.httpsListener,
  env: awsEnv,
});
services.addDependency(cluster);
services.addDependency(messaging);
services.addDependency(storage);
services.addDependency(albStack);

const frontend = new FrontendStack(app, `FrontendStack-${envName}`, {
  config,
  hostedZone: dns.hostedZone,
  certificate: dns.frontendCertificate,
  env: awsEnv,
});
frontend.addDependency(dns);
