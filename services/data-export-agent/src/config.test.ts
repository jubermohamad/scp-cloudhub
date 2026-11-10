import os from 'os';
import path from 'path';
import { ConfigError, loadConfig } from './config';

const base = {
  CONTROL_PLANE_URL: 'https://cloudhub.example.com/',
  CONTROL_PLANE_SCOPE: 'api://cloudhub-data-export/.default',
  CLUSTER_NAME: 'aks-eu-1',
  PGHOST: 'replica.postgres.database.azure.com',
  PGDATABASE: 'app',
  PGUSER: 'mi-data-export-agent',
};

function problemsOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).problems;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(base);
    expect(config).toEqual({
      controlPlaneUrl: 'https://cloudhub.example.com',
      controlPlaneScope: 'api://cloudhub-data-export/.default',
      clusterName: 'aks-eu-1',
      agentName: 'aks-eu-1-data-export-agent',
      pg: {
        host: 'replica.postgres.database.azure.com',
        port: 5432,
        database: 'app',
        user: 'mi-data-export-agent',
        sslMode: 'verify-full',
        sslRootCertPath: undefined,
      },
      workDir: path.join(os.tmpdir(), 'data-export-agent'),
      healthPort: 8080,
      shutdownGraceSeconds: 300,
      logLevel: 'info',
    });
  });

  it('reads optional settings', () => {
    const config = loadConfig({
      ...base,
      PGPORT: '6432',
      PGSSLMODE: 'require',
      WORK_DIR: '/work',
      HEALTH_PORT: '9090',
      SHUTDOWN_GRACE_SECONDS: '60',
      AGENT_NAME: 'custom',
      LOG_LEVEL: 'DEBUG',
    });
    expect(config.pg.port).toBe(6432);
    expect(config.pg.sslMode).toBe('require');
    expect(config.workDir).toBe('/work');
    expect(config.healthPort).toBe(9090);
    expect(config.shutdownGraceSeconds).toBe(60);
    expect(config.agentName).toBe('custom');
    expect(config.logLevel).toBe('debug');
  });

  it('lists every missing variable at once', () => {
    expect(problemsOf({})).toEqual(
      expect.arrayContaining([
        'CONTROL_PLANE_URL is required',
        'CONTROL_PLANE_SCOPE is required',
        'CLUSTER_NAME is required',
        'PGHOST is required',
        'PGDATABASE is required',
        'PGUSER is required',
      ]),
    );
  });

  it('rejects invalid values', () => {
    const problems = problemsOf({
      ...base,
      CONTROL_PLANE_URL: 'http://cloudhub.example.com',
      CONTROL_PLANE_SCOPE: 'api://cloudhub',
      PGPORT: 'abc',
      PGSSLMODE: 'prefer',
      HEALTH_PORT: '70000',
      LOG_LEVEL: 'trace',
      WORK_DIR: 'relative/dir',
      CLUSTER_NAME: 'bad name',
    });
    expect(problems).toHaveLength(8);
  });

  it('allows plain http only for loopback', () => {
    expect(
      problemsOf({ ...base, CONTROL_PLANE_URL: 'http://127.0.0.1:7007' }),
    ).toEqual([]);
    expect(
      problemsOf({
        ...base,
        CONTROL_PLANE_URL: 'https://u:p@cloudhub.example.com',
      }),
    ).toEqual(['CONTROL_PLANE_URL must not contain credentials']);
  });

  it('refuses to start when stored secrets are present', () => {
    const problems = problemsOf({
      ...base,
      PGPASSWORD: 'x',
      AZURE_CLIENT_SECRET: 'y',
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/PGPASSWORD is set/);
  });
});
