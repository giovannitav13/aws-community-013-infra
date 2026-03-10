export type Environment = 'DEV' | 'STAGING' | 'PROD';

export interface EnvConfig {
  env: Environment;
  domain: string;
  frontendSubdomain: string;
  backendSubdomain: string;
}

const baseConfig = {
  domain: 'dev-tool.click',
  frontendSubdomain: 'nuova-app',
  backendSubdomain: 'nuova-app-be',
};

export function getConfig(env: Environment): EnvConfig {
  return {
    env,
    ...baseConfig,
  };
}
