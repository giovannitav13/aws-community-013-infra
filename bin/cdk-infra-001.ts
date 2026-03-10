#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { getConfig, Environment } from '../lib/config';
import { NetworkingStack } from '../lib/networking-stack';
import { DnsStack } from '../lib/dns-stack';
import { MessagingStack } from '../lib/messaging-stack';
import { StorageStack } from '../lib/storage-stack';
import { EcrStack } from '../lib/ecr-stack';
import { ClusterStack } from '../lib/cluster-stack';

const app = new cdk.App();

const envName = (app.node.tryGetContext('env') as Environment) || 'DEV';
const config = getConfig(envName);

const networking = new NetworkingStack(app, `NetworkingStack-${envName}`, {
  config,
});

const dns = new DnsStack(app, `DnsStack-${envName}`, {
  config,
});

const messaging = new MessagingStack(app, `MessagingStack-${envName}`, {
  config,
});

const storage = new StorageStack(app, `StorageStack-${envName}`, {
  config,
  vpc: networking.vpc,
  efsSecurityGroup: networking.efsSecurityGroup,
});
storage.addDependency(networking);

const ecr = new EcrStack(app, `EcrStack-${envName}`, {
  config,
});

const cluster = new ClusterStack(app, `ClusterStack-${envName}`, {
  config,
  vpc: networking.vpc,
  postgresSecurityGroup: networking.postgresSecurityGroup,
  fileSystem: storage.fileSystem,
  efsAccessPoint: storage.efsAccessPoint,
  postgresSecret: storage.postgresSecret,
});
cluster.addDependency(networking);
cluster.addDependency(storage);
