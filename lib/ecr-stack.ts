import * as cdk from 'aws-cdk-lib/core';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface EcrStackProps extends cdk.StackProps {
  config: EnvConfig;
}

export class EcrStack extends cdk.Stack {
  public readonly repoServiceA: ecr.Repository;
  public readonly repoServiceB: ecr.Repository;
  public readonly repoServiceC: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrStackProps) {
    super(scope, id, props);

    const { env } = props.config;

    this.repoServiceA = new ecr.Repository(this, 'RepoServiceA', {
      repositoryName: `repo-service-a-${env.toLowerCase()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    this.repoServiceB = new ecr.Repository(this, 'RepoServiceB', {
      repositoryName: `repo-service-b-${env.toLowerCase()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    this.repoServiceC = new ecr.Repository(this, 'RepoServiceC', {
      repositoryName: `repo-service-c-${env.toLowerCase()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    cdk.Tags.of(this).add('Project', `Infra001-Ecr-${env}`);
  }
}
