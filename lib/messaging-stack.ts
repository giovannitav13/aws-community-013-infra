import * as cdk from 'aws-cdk-lib/core';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface MessagingStackProps extends cdk.StackProps {
  config: EnvConfig;
}

export class MessagingStack extends cdk.Stack {
  public readonly topic: sns.Topic;
  public readonly sqsAlfa: sqs.Queue;
  public readonly sqsBeta: sqs.Queue;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    const { env } = props.config;

    // SNS Topic (published by Service A)
    this.topic = new sns.Topic(this, 'Topic', {
      topicName: `topic-${env}`,
    });

    // DLQ for SQS-alfa
    const dlqAlfa = new sqs.Queue(this, 'DlqAlfa', {
      queueName: `sqs-alfa-${env}-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS-alfa: subscribed to SNS, consumed by Service B
    this.sqsAlfa = new sqs.Queue(this, 'SqsAlfa', {
      queueName: `sqs-alfa-${env}-queue`,
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: dlqAlfa,
        maxReceiveCount: 3,
      },
    });

    // DLQ for SQS-beta
    const dlqBeta = new sqs.Queue(this, 'DlqBeta', {
      queueName: `sqs-beta-${env}-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS-beta: subscribed to SNS, consumed by Service C
    this.sqsBeta = new sqs.Queue(this, 'SqsBeta', {
      queueName: `sqs-beta-${env}-queue`,
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: dlqBeta,
        maxReceiveCount: 3,
      },
    });

    // Subscriptions
    this.topic.addSubscription(new subscriptions.SqsSubscription(this.sqsAlfa));
    this.topic.addSubscription(new subscriptions.SqsSubscription(this.sqsBeta));

    cdk.Tags.of(this).add('Project', `Infra001-Messaging-${env}`);
  }
}
