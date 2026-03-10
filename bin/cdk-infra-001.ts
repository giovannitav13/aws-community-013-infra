#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { getConfig, Environment } from '../lib/config';
import { NetworkingStack } from '../lib/networking-stack';
import { DnsStack } from '../lib/dns-stack';
import { MessagingStack } from '../lib/messaging-stack';

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
