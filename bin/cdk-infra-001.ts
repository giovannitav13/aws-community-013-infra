#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { getConfig, Environment } from '../lib/config';
import { NetworkingStack } from '../lib/networking-stack';

const app = new cdk.App();

const envName = (app.node.tryGetContext('env') as Environment) || 'DEV';
const config = getConfig(envName);

const networking = new NetworkingStack(app, `NetworkingStack-${envName}`, {
  config,
});
