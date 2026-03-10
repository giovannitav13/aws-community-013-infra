import * as cdk from 'aws-cdk-lib/core';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

interface DnsStackProps extends cdk.StackProps {
  config: EnvConfig;
}

export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly frontendCertificate: acm.ICertificate;
  public readonly backendCertificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const { env, domain, frontendSubdomain, backendSubdomain } = props.config;

    const frontendFqdn = `${frontendSubdomain}.${domain}`;
    const backendFqdn = `${backendSubdomain}.${domain}`;

    // Lookup existing hosted zone (domain already on Route53)
    this.hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: domain,
    });

    // ACM certificate for frontend (CloudFront)
    this.frontendCertificate = new acm.Certificate(this, 'FrontendCert', {
      certificateName: `frontend-${env}-cert`,
      domainName: frontendFqdn,
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // ACM certificate for backend (ALB)
    this.backendCertificate = new acm.Certificate(this, 'BackendCert', {
      certificateName: `backend-${env}-cert`,
      domainName: backendFqdn,
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    cdk.Tags.of(this).add('Project', `Infra001-Dns-${env}`);
  }
}
