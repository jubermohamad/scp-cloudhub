import { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';

function pgSslConfig() {
  return process.env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: false };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  tenant_name VARCHAR(255) UNIQUE NOT NULL,
  business_unit VARCHAR(255),
  cloud_provider VARCHAR(50) NOT NULL,
  subscription_id VARCHAR(255) NOT NULL,
  regions TEXT[] NOT NULL DEFAULT '{}',
  environments TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY,
  subscription_id VARCHAR(255) UNIQUE,
  subscription_name VARCHAR(255),
  cloud_provider VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS clusters (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  cluster_name VARCHAR(255),
  subscription_id VARCHAR(255),
  resource_group VARCHAR(255),
  region VARCHAR(100),
  environment VARCHAR(100),
  kubernetes_version VARCHAR(50),
  provisioning_state VARCHAR(50),
  cloud_provider VARCHAR(50),
  onboarded BOOLEAN DEFAULT FALSE,
  onboarding_state VARCHAR(50) DEFAULT 'pending',
  tags JSONB DEFAULT '{}'::jsonb,
  catalog_entity_ref VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (cluster_name, subscription_id)
);

CREATE TABLE IF NOT EXISTS environments (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  environment_name VARCHAR(100) NOT NULL,
  region VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, environment_name, region)
);

CREATE TABLE IF NOT EXISTS node_pools (
  id UUID PRIMARY KEY,
  cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE,
  nodepool_name VARCHAR(255),
  vm_size VARCHAR(100),
  node_count INT,
  mode VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS onboarding_audit_logs (
  id UUID PRIMARY KEY,
  actor_ref VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(100) NOT NULL,
  target_id VARCHAR(255),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_history (
  id UUID PRIMARY KEY,
  cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

export class TenantRegistryDatabase {
  private readonly pool: Pool;
  private readonly logger: LoggerService;
  private ready = false;

  constructor(pool: Pool, logger: LoggerService) {
    this.pool = pool;
    this.logger = logger;
  }

  static fromEnv(logger: LoggerService): TenantRegistryDatabase | null {
    const host = process.env.POSTGRES_HOST;
    if (!host) {
      logger.warn(
        '[tenant-registry] POSTGRES_HOST is not set; metadata store is disabled',
      );
      return null;
    }

    const pool = new Pool({
      host,
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
      user: process.env.POSTGRES_USER ?? 'backstage',
      password: process.env.POSTGRES_PASSWORD ?? 'backstage',
      database: process.env.POSTGRES_DB ?? 'backstage',
      ssl: pgSslConfig(),
    });

    return new TenantRegistryDatabase(pool, logger);
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
    this.ready = true;
    this.logger.info('[tenant-registry] Database schema initialized');
  }

  async query<T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (!this.ready) {
      throw new Error('Tenant registry database is not initialized');
    }
    const result = await this.pool.query(text, params);
    return result.rows as T[];
  }

  isReady(): boolean {
    return this.ready;
  }
}
