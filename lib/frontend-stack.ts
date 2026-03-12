import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface FrontendStackProps extends cdk.StackProps {
  config: EnvConfig;
  hostedZone: route53.IHostedZone;
  certificate: acm.ICertificate;
}

export class FrontendStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { env, domain, frontendSubdomain } = props.config;
    const frontendFqdn = `${frontendSubdomain}.${domain}`;

    // S3 bucket for static files
    this.bucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${frontendFqdn}-${env.toLowerCase()}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Frontend ${env}`,
      domainNames: [frontendFqdn],
      certificate: props.certificate,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    // Route53 A record -> CloudFront
    new route53.ARecord(this, 'FrontendAliasRecord', {
      recordName: frontendFqdn,
      zone: props.hostedZone,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(this.distribution),
      ),
    });

    cdk.Tags.of(this).add('Project', `Infra001-Frontend-${env}`);
  }
}
