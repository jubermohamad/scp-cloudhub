/**
 * Agent configuration, read from the environment only and validated once at
 * startup so a misconfigured Deployment fails fast with every problem listed,
 * instead of failing the first job an hour later.
 */
import os from 'os';
import path from 'path';
import { LOG_LEVELS, LogLevel } from './logger';

export const PG_SSL_MODES = [
  'disable',
  'require',
  'verify-ca',
  'verify-full',
] as const;
export type PgSslMode = (typeof PG_SSL_MODES)[number];

export interface PgConfig {
  host: string;
  port: number;
  database: string;
  /** The managed identity's PostgreSQL role name. */
  user: string;
  sslMode: PgSslMode;
  /** Optional CA bundle path (mounted from a ConfigMap) for verify-ca/verify-full. */
  sslRootCertPath?: string;
}

export interface AgentConfig {
  controlPlaneUrl: string;
  controlPlaneScope: string;
  clusterName: string;
  agentName: string;
  pg: PgConfig;
  workDir: string;
  healthPort: number;
  shutdownGraceSeconds: number;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid agent configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Variables that would carry a stored secret. Their presence means someone is
 * trying to bypass workload identity, so the agent refuses to start.
 */
const FORBIDDEN_SECRET_VARS = [
  'PGPASSWORD',
  'PGPASSFILE',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'AZURE_USERNAME',
  'AZURE_PASSWORD',
  'AZURE_STORAGE_CONNECTION_STRING',
  'AZURE_STORAGE_KEY',
];

const CLUSTER_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

type Env = Record<string, string | undefined>;

function intInRange(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    problems.push(`${name} must be an integer, got "${raw}"`);
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    problems.push(`${name} must be between ${min} and ${max}, got ${value}`);
    return fallback;
  }
  return value;
}

/** Parses and validates the agent configuration; throws ConfigError listing every problem. */
export function loadConfig(env: Env = process.env): AgentConfig {
  const problems: string[] = [];
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) problems.push(`${name} is required`);
    return value ?? '';
  };

  for (const name of FORBIDDEN_SECRET_VARS) {
    if (env[name]) {
      problems.push(
        `${name} is set; the agent authenticates with Azure Workload Identity only and must not be given stored secrets`,
      );
    }
  }

  const controlPlaneUrl = required('CONTROL_PLANE_URL').replace(/\/+$/, '');
  if (controlPlaneUrl) {
    try {
      const url = new URL(controlPlaneUrl);
      const loopback = LOOPBACK_HOSTS.has(url.hostname);
      if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && loopback)
      ) {
        problems.push(
          'CONTROL_PLANE_URL must use https (plain http is only accepted for localhost)',
        );
      }
      if (url.username || url.password) {
        problems.push('CONTROL_PLANE_URL must not contain credentials');
      }
    } catch {
      problems.push(
        `CONTROL_PLANE_URL is not a valid URL: "${controlPlaneUrl}"`,
      );
    }
  }

  const controlPlaneScope = required('CONTROL_PLANE_SCOPE');
  if (controlPlaneScope && !controlPlaneScope.endsWith('/.default')) {
    problems.push(
      'CONTROL_PLANE_SCOPE must be an app ID URI ending in "/.default", e.g. api://cloudhub-data-export/.default',
    );
  }

  const clusterName = required('CLUSTER_NAME');
  if (clusterName && !CLUSTER_NAME.test(clusterName)) {
    problems.push(`CLUSTER_NAME "${clusterName}" contains invalid characters`);
  }

  const host = required('PGHOST');
  const database = required('PGDATABASE');
  const user = required('PGUSER');
  const port = intInRange(env, 'PGPORT', 5432, 1, 65535, problems);
  const sslModeRaw = (env.PGSSLMODE?.trim() || 'verify-full').toLowerCase();
  if (!(PG_SSL_MODES as readonly string[]).includes(sslModeRaw)) {
    problems.push(
      `PGSSLMODE must be one of ${PG_SSL_MODES.join(
        ', ',
      )}, got "${sslModeRaw}"`,
    );
  }

  const logLevelRaw = (env.LOG_LEVEL?.trim() || 'info').toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(logLevelRaw)) {
    problems.push(
      `LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevelRaw}"`,
    );
  }

  const workDir =
    env.WORK_DIR?.trim() || path.join(os.tmpdir(), 'data-export-agent');
  if (!path.isAbsolute(workDir)) {
    problems.push(`WORK_DIR must be an absolute path, got "${workDir}"`);
  }

  const healthPort = intInRange(env, 'HEALTH_PORT', 8080, 1, 65535, problems);
  const shutdownGraceSeconds = intInRange(
    env,
    'SHUTDOWN_GRACE_SECONDS',
    300,
    0,
    86400,
    problems,
  );

  const agentName =
    env.AGENT_NAME?.trim() ||
    (clusterName ? `${clusterName}-data-export-agent` : os.hostname());

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    controlPlaneUrl,
    controlPlaneScope,
    clusterName,
    agentName,
    pg: {
      host,
      port,
      database,
      user,
      sslMode: sslModeRaw as PgSslMode,
      sslRootCertPath: env.PGSSLROOTCERT?.trim() || undefined,
    },
    workDir,
    healthPort,
    shutdownGraceSeconds,
    logLevel: logLevelRaw as LogLevel,
  };
}
