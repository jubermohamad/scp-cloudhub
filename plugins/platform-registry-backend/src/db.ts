import { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';

function pgSslConfig() {
  return process.env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: false };
}

/**
 * Platform Registry schema.
 *
 * NOTE: tables are prefixed with `pr_` because this plugin shares the same
 * PostgreSQL database as other backend plugins, which already own the
 * unprefixed `platforms`, `clusters`, and `environments` tables.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pr_platforms (
  id UUID PRIMARY KEY,
  platform_code VARCHAR(100) UNIQUE NOT NULL,
  platform_name VARCHAR(255) NOT NULL,
  platform_type VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  owner_email VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pr_cloud_accounts (
  id UUID PRIMARY KEY,
  platform_id UUID REFERENCES pr_platforms(id) ON DELETE CASCADE,
  cloud_provider VARCHAR(50) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  account_identifier VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  UNIQUE (cloud_provider, account_identifier)
);

CREATE TABLE IF NOT EXISTS pr_environments (
  id UUID PRIMARY KEY,
  platform_id UUID REFERENCES pr_platforms(id) ON DELETE CASCADE,
  environment_name VARCHAR(100) NOT NULL,
  environment_type VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  UNIQUE (platform_id, environment_name)
);

CREATE TABLE IF NOT EXISTS pr_clusters (
  id UUID PRIMARY KEY,
  platform_id UUID REFERENCES pr_platforms(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES pr_environments(id) ON DELETE SET NULL,
  cloud_account_id UUID REFERENCES pr_cloud_accounts(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES pr_platforms(id) ON DELETE CASCADE,
  customer_name VARCHAR(255),
  environment VARCHAR(50) DEFAULT 'PROD',
  cluster_name VARCHAR(255) NOT NULL,
  cluster_type VARCHAR(50) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  subscription_id VARCHAR(255),
  region VARCHAR(100),
  secondary_region VARCHAR(100),
  resource_group VARCHAR(255),
  account_scope VARCHAR(255),
  cluster_endpoint VARCHAR(512),
  kubernetes_version VARCHAR(50),
  netreveal_version VARCHAR(50) DEFAULT 'v9.6',
  postgres_reporting_service VARCHAR(255) DEFAULT 'postgres-ro',
  postgres_reporting_namespace VARCHAR(255) DEFAULT 'nrod',
  active BOOLEAN DEFAULT TRUE,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  discovered_at TIMESTAMP,
  last_synced_at TIMESTAMP,
  UNIQUE (cluster_name, platform_id)
);

CREATE TABLE IF NOT EXISTS pr_namespaces (
  id UUID PRIMARY KEY,
  cluster_id UUID REFERENCES pr_clusters(id) ON DELETE CASCADE,
  namespace_name VARCHAR(255) NOT NULL,
  owner VARCHAR(255),
  purpose VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  UNIQUE (cluster_id, namespace_name)
);

CREATE TABLE IF NOT EXISTS pr_deployment_targets (
  id UUID PRIMARY KEY,
  platform_id UUID REFERENCES pr_platforms(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES pr_environments(id) ON DELETE SET NULL,
  cluster_id UUID REFERENCES pr_clusters(id) ON DELETE SET NULL,
  namespace_id UUID REFERENCES pr_namespaces(id) ON DELETE SET NULL,
  target_name VARCHAR(255) NOT NULL,
  deployment_type VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  UNIQUE (platform_id, target_name)
);

CREATE TABLE IF NOT EXISTS pr_applications (
  id UUID PRIMARY KEY,
  application_name VARCHAR(255) UNIQUE NOT NULL,
  application_type VARCHAR(100),
  helm_chart VARCHAR(255),
  repository VARCHAR(512),
  default_namespace VARCHAR(255),
  supported_platforms TEXT[] NOT NULL DEFAULT '{}'
);


CREATE TABLE IF NOT EXISTS pr_deployments (
  id UUID PRIMARY KEY,
  deployment_target_id UUID REFERENCES pr_deployment_targets(id) ON DELETE CASCADE,
  application_id UUID REFERENCES pr_applications(id) ON DELETE CASCADE,
  version VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  deployed_by VARCHAR(255),
  deployed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pr_deployment_events (
  id UUID PRIMARY KEY,
  deployment_id UUID REFERENCES pr_deployments(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  from_status VARCHAR(50),
  to_status VARCHAR(50) NOT NULL,
  note TEXT,
  actor VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_deployment_events_deployment
  ON pr_deployment_events (deployment_id, created_at DESC);
`;

export class PlatformRegistryDatabase {
  private readonly pool: Pool;
  private readonly logger: LoggerService;
  private ready = false;

  constructor(pool: Pool, logger: LoggerService) {
    this.pool = pool;
    this.logger = logger;
  }

  static fromEnv(logger: LoggerService): PlatformRegistryDatabase | null {
    const host = process.env.POSTGRES_HOST;
    if (!host) {
      logger.warn(
        '[platform-registry] POSTGRES_HOST is not set; registry store is disabled',
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

    return new PlatformRegistryDatabase(pool, logger);
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
    await this.runMigrations();
    this.ready = true;
    this.logger.info('[platform-registry] Database schema initialized');
  }

  private async runMigrations(): Promise<void> {
    // Backward-compatible breaking migration from tenant* to platform* schema.
    await this.pool.query(`
      DO $$
      DECLARE
        platform_count int := 0;
      BEGIN
        IF to_regclass('public.pr_platforms') IS NOT NULL THEN
          EXECUTE 'SELECT COUNT(*) FROM pr_platforms' INTO platform_count;
        END IF;

        IF to_regclass('public.pr_tenants') IS NOT NULL
           AND to_regclass('public.pr_platforms') IS NULL THEN
          ALTER TABLE pr_tenants RENAME TO pr_platforms;
        ELSIF to_regclass('public.pr_tenants') IS NOT NULL
           AND to_regclass('public.pr_platforms') IS NOT NULL
           AND platform_count = 0 THEN
          DROP TABLE pr_platforms;
          ALTER TABLE pr_tenants RENAME TO pr_platforms;
        END IF;
      END $$;
    `);

    await this.pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_platforms' AND column_name = 'tenant_code'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_platforms' AND column_name = 'platform_code'
        ) THEN
          ALTER TABLE pr_platforms RENAME COLUMN tenant_code TO platform_code;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_platforms' AND column_name = 'tenant_name'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_platforms' AND column_name = 'platform_name'
        ) THEN
          ALTER TABLE pr_platforms RENAME COLUMN tenant_name TO platform_name;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_platforms' AND column_name = 'tenant_type'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_platforms' AND column_name = 'platform_type'
        ) THEN
          ALTER TABLE pr_platforms RENAME COLUMN tenant_type TO platform_type;
        END IF;
      END $$;
    `);

    await this.pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_cloud_accounts' AND column_name = 'tenant_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_cloud_accounts' AND column_name = 'platform_id'
        ) THEN
          ALTER TABLE pr_cloud_accounts RENAME COLUMN tenant_id TO platform_id;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_environments' AND column_name = 'tenant_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_environments' AND column_name = 'platform_id'
        ) THEN
          ALTER TABLE pr_environments RENAME COLUMN tenant_id TO platform_id;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_clusters' AND column_name = 'tenant_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_clusters' AND column_name = 'platform_id'
        ) THEN
          ALTER TABLE pr_clusters RENAME COLUMN tenant_id TO platform_id;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_deployment_targets' AND column_name = 'tenant_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pr_deployment_targets' AND column_name = 'platform_id'
        ) THEN
          ALTER TABLE pr_deployment_targets RENAME COLUMN tenant_id TO platform_id;
        END IF;
      END $$;
    `);

    await this.pool.query(
      'ALTER TABLE pr_cloud_accounts DROP COLUMN IF EXISTS tenant_identifier',
    );
    await this.pool.query(
      'ALTER TABLE pr_cloud_accounts DROP COLUMN IF EXISTS platform_identifier',
    );
    await this.pool.query(
      'ALTER TABLE pr_cloud_accounts DROP COLUMN IF EXISTS credential_reference',
    );

    // Schema extension for Customer-to-Cluster mapping and NetReveal operational requirements
    await this.pool.query(`
      ALTER TABLE pr_clusters ADD COLUMN IF NOT EXISTS customer_id UUID;
      ALTER TABLE pr_clusters ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
      ALTER TABLE pr_clusters ADD COLUMN IF NOT EXISTS environment VARCHAR(50) DEFAULT 'PROD';
      ALTER TABLE pr_clusters ADD COLUMN IF NOT EXISTS subscription_id VARCHAR(255);
      ALTER TABLE pr_clusters ADD COLUMN IF NOT EXISTS netreveal_version VARCHAR(50) DEFAULT 'v9.6';
      ALTER TABLE pr_clusters ADD COLUMN IF NOT EXISTS postgres_reporting_service VARCHAR(255) DEFAULT 'postgres-ro';
      ALTER TABLE pr_clusters ADD COLUMN IF NOT EXISTS postgres_reporting_namespace VARCHAR(255) DEFAULT 'nrod';
      ALTER TABLE pr_clusters ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

      UPDATE pr_clusters SET
        customer_id = COALESCE(customer_id, platform_id),
        customer_name = COALESCE(customer_name, (SELECT platform_name FROM pr_platforms WHERE id = pr_clusters.platform_id)),
        environment = COALESCE(environment, 'PROD'),
        subscription_id = COALESCE(subscription_id, account_scope),
        netreveal_version = COALESCE(netreveal_version, 'v9.6'),
        postgres_reporting_service = COALESCE(postgres_reporting_service, 'postgres-ro'),
        postgres_reporting_namespace = COALESCE(postgres_reporting_namespace, 'nrod'),
        active = COALESCE(active, status = 'active');
    `);

    // One-time cleanup for previously seeded synthetic customer/cluster rows.
    // Ground-zero mode keeps Platform Registry populated only by real onboarding.
    await this.pool.query(`
      DELETE FROM pr_clusters
       WHERE id = ANY($1::uuid[])
          OR (
            cluster_name = ANY($2::text[])
            AND COALESCE(account_scope, '') = 'sub-netreveal-prod'
            AND COALESCE(subscription_id, '') = 'sub-netreveal-prod'
          );
    `,
    [
      [
        '44444444-0000-0000-0000-000000000010',
        '44444444-0000-0000-0000-000000000020',
        '44444444-0000-0000-0000-000000000030',
        '44444444-0000-0000-0000-000000000040',
      ],
      [
        'aks-metro-prd-weu',
        'aks-scotia-prd-can',
        'aks-hsbc-prd-uks',
        'aks-rbos-prd-uks',
      ],
    ]);

    await this.pool.query(`
      DELETE FROM pr_platforms p
       WHERE (
              p.id = ANY($1::uuid[])
              OR p.platform_code = ANY($2::text[])
             )
         AND NOT EXISTS (
           SELECT 1 FROM pr_clusters c WHERE c.platform_id = p.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM pr_cloud_accounts a WHERE a.platform_id = p.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM pr_environments e WHERE e.platform_id = p.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM pr_deployment_targets d WHERE d.platform_id = p.id
         );
    `,
    [
      [
        '11111111-0000-0000-0000-000000000010',
        '11111111-0000-0000-0000-000000000020',
        '11111111-0000-0000-0000-000000000030',
        '11111111-0000-0000-0000-000000000040',
      ],
      ['metrobank', 'scotiabank', 'hsbc', 'rbos'],
    ]);

  }

  async query<T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (!this.ready) {
      throw new Error('Platform registry database is not initialized');
    }
    const result = await this.pool.query(text, params);
    return result.rows as T[];
  }

  isReady(): boolean {
    return this.ready;
  }

}
