/**
 * End-to-end tests against a real PostgreSQL database: the HTTP router, the
 * scheduler plugin and the agent protocol working together.
 *
 * Opt-in: set DATA_EXPORT_TEST_PG_HOST (plus optional DATA_EXPORT_TEST_PG_PORT,
 * _USER, _PASSWORD, _DB). The tests DROP the data_export schema and pr_* tables,
 * so point them only at a disposable database, for example:
 *
 *   docker run -d --name dxh-pg-test -e POSTGRES_USER=backstage \
 *     -e POSTGRES_PASSWORD=backstage -e POSTGRES_DB=backstage postgres:16-alpine
 */
import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
// Sandboxed WSL hosts resolve localhost to IPv6 first; the sibling router tests need the same shim.
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { patchSupertestIpv4 } from 'backend/src/test-utils/patchSupertestIpv4';
import { ExportScheduler, SchedulerDatabase } from '@internal/plugin-data-export-scheduler';
import { DataExportDatabase } from '../db';
import { MIGRATIONS } from '../migrations';
import { createDataExportRouter } from '../router';
import { insertNetRevealTestDatasets } from './fixtures';
import { PLATFORM_ADMIN, SCHEDULER, agentToken, fakeAuth, logger, tenantAdmin, tenantUser } from './testAuth';

patchSupertestIpv4();

const host = process.env.DATA_EXPORT_TEST_PG_HOST;
const describeIfDb = host ? describe : describe.skip;

function newPool() {
  return new Pool({
    host,
    port: parseInt(process.env.DATA_EXPORT_TEST_PG_PORT ?? '5432', 10),
    user: process.env.DATA_EXPORT_TEST_PG_USER ?? 'backstage',
    password: process.env.DATA_EXPORT_TEST_PG_PASSWORD ?? 'backstage',
    database: process.env.DATA_EXPORT_TEST_PG_DB ?? 'backstage',
    ssl: false,
  });
}

const SFTP_CONFIG = {
  host: 'sftp.metrobank.example',
  username: 'netreveal',
  remotePath: '/outbound',
  secretRef: 'kv://kv-dxh-prod/sftp-metrobank-key',
  hostKeyFingerprint: 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8',
};

describeIfDb('migration 3 upgrades Phase 1.1 data', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = newPool();
    await pool.query('DROP SCHEMA IF EXISTS data_export CASCADE');
    await pool.query('CREATE SCHEMA data_export');
    await pool.query(`CREATE TABLE data_export.schema_migrations (
      version INTEGER PRIMARY KEY, name VARCHAR(255) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    for (const migration of MIGRATIONS.slice(0, 2)) {
      await pool.query(migration.sql);
      await pool.query('INSERT INTO data_export.schema_migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ]);
    }
  }, 30_000);

  afterAll(() => pool.end());

  it('converts catalog fields, export options, runs and watermarks', async () => {
    const datasetId = randomUUID();
    const clusterId = randomUUID();
    const destinationId = randomUUID();
    const profileId = randomUUID();
    await pool.query(
      `INSERT INTO data_export.datasets (id, dataset_id, display_name, description, product, category,
         primary_keys, estimated_volume, retention_days)
       VALUES ($1, 'NR_V_CASES', 'Cases', 'Investigation cases', 'NetReveal', 'CASES', '{CASE_ID}', '120000', 30)`,
      [datasetId],
    );
    await pool.query(
      `INSERT INTO data_export.clusters (id, cluster_name, environment, tenant_id) VALUES ($1, 'aks-1', 'PRODUCTION', 'visa')`,
      [clusterId],
    );
    await pool.query(
      `INSERT INTO data_export.destinations (id, type, name) VALUES ($1, 'SFTP', 'legacy-sftp')`,
      [destinationId],
    );
    await pool.query(
      `INSERT INTO data_export.export_profiles (id, name, tenant_id, owner_id, cluster_id, environment, schedule,
         cron_expression, format, destination_id)
       VALUES ($1, 'Legacy', 'visa', 'user:default/alice', $2, 'PRODUCTION', 'DAILY', '0 2 * * *', 'CSV', $3)`,
      [profileId, clusterId, destinationId],
    );
    await pool.query(
      `INSERT INTO data_export.export_runs (id, profile_id, dataset_id, status) VALUES
         ($1, $3, $4, 'QUEUED'), ($2, $3, $4, 'COMPLETED')`,
      [randomUUID(), randomUUID(), profileId, datasetId],
    );

    await new DataExportDatabase(pool, logger).migrate();

    const dataset = (await pool.query('SELECT * FROM data_export.datasets WHERE id = $1', [datasetId])).rows[0];
    expect(dataset).toMatchObject({
      source_product: 'NETREVEAL',
      business_description: 'Investigation cases',
      primary_keys: ['CASE_ID'],
      estimated_daily_volume: '120000',
      classification: 'CONFIDENTIAL',
      contains_pii: true,
    });
    const profile = (await pool.query('SELECT * FROM data_export.export_profiles WHERE id = $1', [profileId])).rows[0];
    expect(profile).toMatchObject({ file_format: 'CSV', compression: 'GZIP', export_mode: 'FULL' });
    const jobs = (await pool.query('SELECT status, tenant_id, cluster_id FROM data_export.jobs ORDER BY status')).rows;
    expect(jobs).toEqual([
      { status: 'CANCELLED', tenant_id: 'visa', cluster_id: clusterId },
      { status: 'COMPLETED', tenant_id: 'visa', cluster_id: clusterId },
    ]);
    const runsTable = await pool.query("SELECT to_regclass('data_export.export_runs') AS t");
    expect(runsTable.rows[0].t).toBeNull();
  });
});

describeIfDb('control plane, scheduler and agent protocol end to end', () => {
  let pool: Pool;
  let app: express.Express;
  let scheduler: ExportScheduler;
  const agentIdentity = 'aaaaaaaa-1111-4111-8111-111111111111';
  const otherAgentIdentity = 'bbbbbbbb-2222-4222-8222-222222222222';
  const ids: Record<string, string> = {};

  const as = (principal: string) => ({
    get: (url: string) => request(app).get(url).set('x-test-principal', principal),
    post: (url: string, body?: object) => request(app).post(url).set('x-test-principal', principal).send(body ?? {}),
    put: (url: string, body?: object) => request(app).put(url).set('x-test-principal', principal).send(body ?? {}),
  });
  const admin = as(PLATFORM_ADMIN);
  const metroAdmin = as(tenantAdmin('metrobank'));
  const metroUser = as(tenantUser('metrobank'));
  const visaAdmin = as(tenantAdmin('visa'));
  const agent = as(agentToken(agentIdentity));
  const otherAgent = as(agentToken(otherAgentIdentity));

  const heartbeat = (client = agent) =>
    client.post('/agent/heartbeat', {
      protocolVersion: 1,
      agentName: 'aks-metro-prod-agent',
      version: '1.0.0',
      status: 'ONLINE',
      capabilities: { formats: ['PARQUET', 'CSV'], providers: ['ADLS_GEN2', 'SFTP'] },
    });

  beforeAll(async () => {
    pool = newPool();
    await pool.query('DROP SCHEMA IF EXISTS data_export CASCADE');
    await pool.query('DROP TABLE IF EXISTS pr_clusters, pr_environments, pr_cloud_accounts, pr_platforms CASCADE');
    const db = new DataExportDatabase(pool, logger);
    await db.migrate();
    await insertNetRevealTestDatasets(db);
    const { httpAuth, userInfo } = fakeAuth();
    app = express();
    app.use(createDataExportRouter({ logger, httpAuth, userInfo, db }));
    scheduler = new ExportScheduler(new SchedulerDatabase(newPool()), logger);
  }, 60_000);

  afterAll(() => pool.end());

  it('applies every migration exactly once', async () => {
    await new DataExportDatabase(pool, logger).migrate();
    const { rows } = await pool.query('SELECT version FROM data_export.schema_migrations ORDER BY version');
    expect(rows.map(row => row.version)).toEqual(MIGRATIONS.map(migration => migration.version));
  });

  it('serves the catalog with pagination, sorting, filtering and lineage', async () => {
    const page = await admin.get('/datasets?pageSize=2&sortBy=datasetId&sortOrder=desc');
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(6);
    expect(page.body.items.map((d: any) => d.datasetId)).toEqual(['NR_WORKFLOW_NOTE', 'NR_WLM_SWIFT_MATCH_DETAILS']);
    const second = await admin.get('/datasets?pageSize=2&page=1&sortBy=datasetId&sortOrder=desc');
    expect(second.body.items.map((d: any) => d.datasetId)).toEqual(['NR_V_CC_ALERTS', 'NR_V_CASES']);
    expect((await admin.get('/datasets?hasSqlTemplate=true')).body.total).toBe(0);
    const filtered = await admin.get('/datasets?category=CUSTOMERS&containsPii=true');
    expect(filtered.body.items.map((d: any) => d.datasetId)).toEqual(['NR_CUSTOMERS']);

    const customers = filtered.body.items[0];
    const lineage = await metroUser.get(`/datasets/${customers.id}/lineage`);
    expect(lineage.body.nodes.map((n: any) => n.datasetId).sort()).toEqual(['NR_CUSTOMERS', 'NR_CUSTOMER_DYNAMIC'].sort());
    expect(lineage.body.edges).toHaveLength(1);
    expect(lineage.body.edges[0].from).toBe(customers.id);
  });

  it('prevents dependency cycles in the catalog', async () => {
    const all = (await admin.get('/datasets?pageSize=50')).body.items;
    const customers = all.find((d: any) => d.datasetId === 'NR_CUSTOMERS');
    const dynamic = all.find((d: any) => d.datasetId === 'NR_CUSTOMER_DYNAMIC');
    const res = await admin.put(`/datasets/${customers.id}`, { dependsOn: [dynamic.id] });
    expect(res.status).toBe(400);
    expect(res.body.details[0]).toMatch(/cycle/);
  });

  it('prepares a dataset, cluster, agent and destination', async () => {
    const cases = (await admin.get('/datasets?search=NR_V_CASES')).body.items[0];
    ids.dataset = cases.id;
    const updated = await admin.put(`/datasets/${cases.id}`, {
      sqlTemplate: 'SELECT * FROM nr_v_cases',
      supportsIncremental: true,
      watermarkColumn: 'UPDATED_AT',
      ownerTeam: 'AML Platform',
      supportEmail: 'aml-platform@symphonyai.com',
      estimatedDailyVolume: 125000,
    });
    expect(updated.status).toBe(200);
    const runnable = await metroAdmin.get('/datasets?hasSqlTemplate=true&supportsIncremental=true');
    expect(runnable.body.items.map((d: any) => d.datasetId)).toEqual(['NR_V_CASES']);

    const cluster = await admin.post('/clusters', {
      clusterName: 'aks-metro-prod',
      environment: 'PRODUCTION',
      tenantId: 'metrobank',
      region: 'southeastasia',
    });
    expect(cluster.status).toBe(201);
    ids.cluster = cluster.body.id;
    expect(cluster.body.health).toBe('OFFLINE');

    const registered = await admin.post(`/clusters/${ids.cluster}/agents`, { identitySubject: agentIdentity });
    expect(registered.status).toBe(201);
    const visaCluster = await admin.post('/clusters', { clusterName: 'aks-visa', environment: 'PRODUCTION', tenantId: 'visa' });
    await admin.post(`/clusters/${visaCluster.body.id}/agents`, { identitySubject: otherAgentIdentity });

    const destination = await metroAdmin.post('/destinations', {
      type: 'SFTP',
      name: 'metrobank-sftp',
      tenantId: 'metrobank',
      configuration: SFTP_CONFIG,
    });
    expect(destination.status).toBe(201);
    ids.destination = destination.body.id;
  });

  it('lets a tenant admin create an incremental export within the tenant only', async () => {
    const body = {
      name: 'Daily cases',
      tenantId: 'metrobank',
      environment: 'PRODUCTION',
      clusterId: ids.cluster,
      schedule: 'HOURLY',
      exportMode: 'INCREMENTAL',
      fileFormat: 'PARQUET',
      retentionDays: 30,
      destinationId: ids.destination,
      datasetIds: [ids.dataset],
    };
    expect((await metroUser.post('/exports', body)).status).toBe(403);
    expect((await visaAdmin.post('/exports', body)).status).toBe(403);
    const created = await metroAdmin.post('/exports', body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      compression: 'SNAPPY',
      watermarkStrategy: 'GREATER_THAN',
      ownerId: 'user:default/tester',
      clusterName: 'aks-metro-prod',
    });
    expect(created.body.nextRunAt).toMatch(/T\d\d:00:00.000Z$/);
    ids.export = created.body.id;

    const list = await metroUser.get(`/exports?datasetId=${ids.dataset}&sortBy=name`);
    expect(list.body.total).toBe(1);
    expect((await visaAdmin.get('/exports')).body.total).toBe(0);
    expect((await visaAdmin.get(`/exports/${ids.export}`)).status).toBe(404);
  });

  it('reports agent heartbeats and derived health', async () => {
    const res = await heartbeat();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clusterName: 'aks-metro-prod', tenantId: 'metrobank', heartbeatIntervalSeconds: 60 });
    expect(res.body.destinationsToCheck.map((d: any) => d.id)).toEqual([ids.destination]);

    const checked = await agent.post('/agent/heartbeat', {
      protocolVersion: 1,
      agentName: 'aks-metro-prod-agent',
      version: '1.0.0',
      status: 'ONLINE',
      capabilities: {},
      destinationChecks: [
        { destinationId: ids.destination, status: 'HEALTHY', message: 'connected', checkedAt: new Date().toISOString() },
      ],
    });
    expect(checked.body.destinationsToCheck).toEqual([]);
    const destination = (await metroAdmin.get(`/destinations/${ids.destination}`)).body;
    expect(destination.status).toBe('HEALTHY');
    expect(destination.lastTestMessage).toMatch(/Live check from aks-metro-prod/);

    const agents = await metroUser.get('/agents');
    expect(agents.body.items).toHaveLength(1);
    expect(agents.body.items[0]).toMatchObject({ health: 'HEALTHY', agentVersion: '1.0.0', agentName: 'aks-metro-prod-agent' });
    const cluster = (await metroUser.get(`/clusters/${ids.cluster}`)).body;
    expect(cluster).toMatchObject({ health: 'HEALTHY', agentVersion: '1.0.0' });
    expect((await admin.get(`/agents/${agents.body.items[0].id}`)).body.heartbeats).toHaveLength(2);
  });

  it('turns a due schedule into a queued job', async () => {
    await pool.query(
      `UPDATE data_export.export_profiles SET last_scheduled_at = NOW() - INTERVAL '2 hours' WHERE id = $1`,
      [ids.export],
    );
    const tick = await scheduler.tick();
    expect(tick).toMatchObject({ jobsCreated: 1, jobsQueued: 1, jobsRejected: 0 });
    expect((await scheduler.tick()).jobsCreated).toBe(0);
    const jobs = await metroUser.get(`/jobs?exportId=${ids.export}`);
    expect(jobs.body.items).toHaveLength(1);
    expect(jobs.body.items[0]).toMatchObject({ status: 'QUEUED', trigger: 'SCHEDULE', datasetId: 'NR_V_CASES' });
  });

  it('runs a job through the agent protocol and advances the watermark on completion', async () => {
    expect((await otherAgent.post('/agent/jobs/claim')).status).toBe(204);
    const claim = await agent.post('/agent/jobs/claim');
    expect(claim.status).toBe(200);
    const job = claim.body.job;
    ids.job = job.jobId;
    expect(job).toMatchObject({
      attempt: 1,
      tenantId: 'metrobank',
      profile: { exportMode: 'INCREMENTAL', fileFormat: 'PARQUET', compression: 'SNAPPY', retentionDays: 30 },
      dataset: { datasetId: 'NR_V_CASES', sqlTemplate: 'SELECT * FROM nr_v_cases', watermarkColumn: 'UPDATED_AT' },
      watermark: { lastSuccessValue: null },
      destination: { id: ids.destination, type: 'SFTP' },
    });
    expect(job.outputPrefix).toMatch(/^tenant\/metrobank\/exports\/daily-cases-[0-9a-f]{8}\/\d{4}\/\d{2}\/\d{2}\//);
    expect(job.outputPrefix.endsWith(job.jobId)).toBe(true);

    expect((await otherAgent.post(`/agent/jobs/${job.jobId}/progress`, { status: 'RUNNING' })).status).toBe(404);
    expect((await agent.post(`/agent/jobs/${job.jobId}/progress`, { status: 'UPLOADING' })).status).toBe(409);
    expect((await agent.post(`/agent/jobs/${job.jobId}/progress`, { status: 'RUNNING' })).body).toEqual({ continue: true });
    expect(
      (await agent.post(`/agent/jobs/${job.jobId}/progress`, { status: 'UPLOADING', rowsExported: 2 })).body,
    ).toEqual({ continue: true });

    const sha = 'a'.repeat(64);
    const complete = await agent.post(`/agent/jobs/${job.jobId}/complete`, {
      rowsExported: 2,
      bytesExported: 2048,
      files: [
        { name: 'NR_V_CASES.parquet', path: `/outbound/${job.outputPrefix}/NR_V_CASES.parquet`, sizeBytes: 2000, sha256: sha, records: 2 },
        { name: 'checksum.sha256', path: `/outbound/${job.outputPrefix}/checksum.sha256`, sizeBytes: 48, sha256: sha },
        { name: 'manifest.json', path: `/outbound/${job.outputPrefix}/manifest.json`, sizeBytes: 300, sha256: sha },
      ],
      manifest: { manifestVersion: 1, tenant: 'metrobank', dataset: 'NR_V_CASES', runId: job.jobId, status: 'COMPLETED', records: 2 },
      watermarkValue: '2026-10-20T00:00:00Z',
      logs: 'exported 2 rows',
    });
    expect(complete.status).toBe(200);

    const detail = (await metroUser.get(`/jobs/${job.jobId}`)).body;
    expect(detail).toMatchObject({
      status: 'COMPLETED',
      rowsExported: 2,
      bytesExported: 2048,
      filesDelivered: 3,
      watermarkFrom: null,
      watermarkTo: '2026-10-20T00:00:00Z',
      assignedAgentName: 'aks-metro-prod-agent',
    });
    const manifest = await metroUser.get(`/jobs/${job.jobId}/manifest`);
    expect(manifest.headers['content-disposition']).toContain('manifest-');
    expect(manifest.body.runId).toBe(job.jobId);
    expect((await metroUser.get(`/jobs/${job.jobId}/logs`)).text).toBe('exported 2 rows');
    expect((await visaAdmin.get(`/jobs/${job.jobId}`)).status).toBe(404);

    const watermark = await pool.query('SELECT last_success_value, tenant_id FROM data_export.watermarks');
    expect(watermark.rows).toEqual([{ last_success_value: '2026-10-20T00:00:00Z', tenant_id: 'metrobank' }]);
  });

  it('hands the stored watermark to the next run and backs off after a retryable failure', async () => {
    const run = await metroAdmin.post(`/exports/${ids.export}/run`);
    expect(run.status).toBe(202);
    expect(run.body[0]).toMatchObject({ status: 'QUEUED', trigger: 'MANUAL' });
    const claim = await agent.post('/agent/jobs/claim');
    expect(claim.body.job.watermark).toEqual({ lastSuccessValue: '2026-10-20T00:00:00Z' });
    const jobId = claim.body.job.jobId;
    await agent.post(`/agent/jobs/${jobId}/progress`, { status: 'RUNNING' });
    const fail = await agent.post(`/agent/jobs/${jobId}/fail`, { errorMessage: 'ECONNRESET', retryable: true });
    expect(fail.body).toEqual({ willRetry: true });
    expect((await agent.post('/agent/jobs/claim')).status).toBe(204);
    const job = (await metroUser.get(`/jobs/${jobId}`)).body;
    expect(job).toMatchObject({ status: 'QUEUED', retryCount: 1, errorMessage: 'ECONNRESET' });

    await pool.query('UPDATE data_export.jobs SET not_before = NOW() WHERE id = $1', [jobId]);
    const retried = await agent.post('/agent/jobs/claim');
    expect(retried.body.job).toMatchObject({ jobId, attempt: 2 });
    await agent.post(`/agent/jobs/${jobId}/progress`, { status: 'RUNNING' });
    const final = await agent.post(`/agent/jobs/${jobId}/fail`, { errorMessage: 'syntax error', retryable: false });
    expect(final.body).toEqual({ willRetry: false });
    expect((await metroUser.get(`/jobs/${jobId}`)).body.status).toBe('FAILED');

    expect((await metroUser.post(`/jobs/${jobId}/retry`)).status).toBe(403);
    const manual = await metroAdmin.post(`/jobs/${jobId}/retry`);
    expect(manual.body).toMatchObject({ status: 'QUEUED', trigger: 'RETRY' });
    ids.retriedJob = jobId;
  });

  it('stops an agent when its job is cancelled', async () => {
    const claim = await agent.post('/agent/jobs/claim');
    expect(claim.body.job.jobId).toBe(ids.retriedJob);
    await agent.post(`/agent/jobs/${ids.retriedJob}/progress`, { status: 'RUNNING' });
    const cancel = await metroAdmin.post(`/jobs/${ids.retriedJob}/cancel`);
    expect(cancel.body.status).toBe('CANCELLED');
    expect((await agent.post(`/agent/jobs/${ids.retriedJob}/progress`, { status: 'RUNNING' })).body).toEqual({
      continue: false,
    });
    expect((await metroAdmin.post(`/jobs/${ids.retriedJob}/cancel`)).status).toBe(409);
  });

  it('reclaims work from an agent that stops sending heartbeats', async () => {
    const run = await metroAdmin.post(`/exports/${ids.export}/run`);
    const jobId = run.body[0].id;
    await agent.post('/agent/jobs/claim');
    await agent.post(`/agent/jobs/${jobId}/progress`, { status: 'RUNNING' });
    await pool.query(`UPDATE data_export.agents SET last_seen = NOW() - INTERVAL '20 minutes'`);
    expect((await metroUser.get(`/clusters/${ids.cluster}`)).body.health).toBe('OFFLINE');

    const tick = await scheduler.tick();
    expect(tick.jobsReclaimed).toBe(1);
    const job = (await metroUser.get(`/jobs/${jobId}`)).body;
    expect(job).toMatchObject({ status: 'QUEUED', retryCount: 1 });
    expect(job.errorMessage).toMatch(/stopped sending heartbeats/);
    await metroAdmin.post(`/jobs/${jobId}/cancel`);
    await heartbeat();
  });

  it('rejects scheduled jobs whose dataset is no longer runnable', async () => {
    await admin.put(`/datasets/${ids.dataset}`, { enabled: false });
    // Re-scheduling the same occurrence is absorbed by the unique key…
    await pool.query(
      `UPDATE data_export.export_profiles SET last_scheduled_at = NOW() - INTERVAL '2 hours' WHERE id = $1`,
      [ids.export],
    );
    expect((await scheduler.tick()).jobsCreated).toBe(0);
    // …so stage a freshly created job to exercise dispatch.
    await pool.query(
      `INSERT INTO data_export.jobs (id, profile_id, dataset_id, cluster_id, tenant_id, status, scheduled_time)
       VALUES ($1, $2, $3, $4, 'metrobank', 'CREATED', NOW())`,
      [randomUUID(), ids.export, ids.dataset, ids.cluster],
    );
    const tick = await scheduler.tick();
    expect(tick).toMatchObject({ jobsCreated: 0, jobsQueued: 0, jobsRejected: 1 });
    const failed = await metroUser.get(`/jobs?status=FAILED&exportId=${ids.export}&sortBy=createdAt&sortOrder=desc`);
    expect(failed.body.items[0].errorMessage).toBe('Dataset NR_V_CASES is disabled');
    await admin.put(`/datasets/${ids.dataset}`, { enabled: true });
  });

  it('summarises operations on the dashboard, scoped to the tenant', async () => {
    const dashboard = (await metroUser.get('/dashboard')).body;
    expect(dashboard.kpis).toMatchObject({
      registeredClusters: 1,
      healthyClusters: 1,
      connectedAgents: 1,
      configuredExports: 1,
      completedJobsToday: 1,
      rowsExportedToday: 2,
      bytesExportedToday: 2048,
      datasetsPublished: 6,
      destinationsConfigured: 1,
    });
    expect(dashboard.clusterHealth).toEqual({ HEALTHY: 1, WARNING: 0, CRITICAL: 0, OFFLINE: 0 });
    expect(dashboard.topDatasets[0]).toMatchObject({ datasetId: 'NR_V_CASES', rowsExported: 2 });
    expect(dashboard.topTenants).toEqual([{ tenantId: 'metrobank', exports: 1, bytesExported: 2048 }]);
    expect(dashboard.topDestinations[0]).toMatchObject({ name: 'metrobank-sftp', filesDelivered: 3 });
    expect(dashboard.queueDepth).toEqual([]);
    expect((await admin.get('/dashboard')).body.queueDepth.length).toBeGreaterThan(0);
    expect((await visaAdmin.get('/dashboard')).body.kpis.completedJobsToday).toBe(0);

    const filters = (await metroUser.get('/filters')).body;
    expect(filters.tenants).toEqual(['metrobank']);
    expect(filters.clusters.map((c: any) => c.clusterName)).toEqual(['aks-metro-prod']);
  });

  it('discovers, adopts and retires clusters from Platform Registry', async () => {
    await pool.query(`
      CREATE TABLE pr_platforms (id UUID PRIMARY KEY, platform_code VARCHAR(100));
      CREATE TABLE pr_environments (id UUID PRIMARY KEY, environment_name VARCHAR(100), environment_type VARCHAR(50));
      CREATE TABLE pr_cloud_accounts (id UUID PRIMARY KEY, cloud_provider VARCHAR(50), account_identifier VARCHAR(255));
      CREATE TABLE pr_clusters (id UUID PRIMARY KEY, platform_id UUID, environment_id UUID, cloud_account_id UUID,
        cluster_name VARCHAR(255), cluster_type VARCHAR(50), provider VARCHAR(50), region VARCHAR(100),
        resource_group VARCHAR(255), status VARCHAR(50));
      INSERT INTO pr_platforms VALUES ('11111111-0000-0000-0000-000000000001', 'MetroBank');
      INSERT INTO pr_environments VALUES ('33333333-0000-0000-0000-000000000001', 'prod', 'prod'),
                                         ('33333333-0000-0000-0000-000000000002', 'perf', 'non-prod');
      INSERT INTO pr_cloud_accounts VALUES ('22222222-0000-0000-0000-000000000001', 'AZURE', '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
      INSERT INTO pr_clusters VALUES
        ('44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
         '22222222-0000-0000-0000-000000000001', 'aks-metro-prod', 'AKS', 'AZURE', 'southeastasia', 'rg-metro', 'active'),
        ('44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
         '22222222-0000-0000-0000-000000000001', 'aks-metro-dr', 'AKS', 'AZURE', 'eastasia', 'rg-metro-dr', 'active'),
        ('44444444-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000002',
         '22222222-0000-0000-0000-000000000001', 'aks-metro-perf', 'AKS', 'AZURE', 'eastasia', 'rg-perf', 'active'),
        ('44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
         null, 'eks-metro', 'EKS', 'AWS', 'ap-southeast-1', null, 'active');
    `);
    // The metrobank tenant slug is "metrobank" (platform code "MetroBank"), so aks-metro-prod is adopted.
    const sync = await request(app).post('/internal/clusters/sync').set('x-test-principal', SCHEDULER);
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ created: 1, updated: 1, retired: 0 });
    expect(sync.body.skipped).toEqual([{ clusterName: 'aks-metro-perf', reason: 'environment "perf" has no mapping' }]);

    const adopted = (await admin.get(`/clusters/${ids.cluster}`)).body;
    expect(adopted).toMatchObject({
      platformRegistryId: '44444444-0000-0000-0000-000000000001',
      subscriptionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      resourceGroup: 'rg-metro',
    });
    expect((await admin.put(`/clusters/${ids.cluster}`, {
      clusterName: 'renamed',
      environment: 'PRODUCTION',
      tenantId: 'metrobank',
    })).status).toBe(409);

    await pool.query(`UPDATE pr_clusters SET status = 'decommissioned' WHERE cluster_name = 'aks-metro-dr'`);
    const second = await admin.post('/clusters/sync');
    expect(second.body).toMatchObject({ created: 0, retired: 1 });
    const retired = await admin.get('/clusters?includeRetired=true&search=aks-metro-dr');
    expect(retired.body.items[0]).toMatchObject({ isRetired: true });
    expect((await admin.get('/clusters?search=aks-metro-dr')).body.total).toBe(0);

    await pool.query(`UPDATE pr_clusters SET status = 'active' WHERE cluster_name = 'aks-metro-dr'`);
    expect((await admin.post('/clusters/sync')).body.restored).toBe(1);
  });

  it('refuses agents on retired clusters and records an audit trail', async () => {
    await admin.post(`/clusters/${ids.cluster}/retire`);
    expect((await heartbeat()).status).toBe(403);
    await admin.post(`/clusters/${ids.cluster}/restore`);
    expect((await heartbeat()).status).toBe(200);

    const audit = await admin.get('/audit?pageSize=100');
    const actions = audit.body.items.map((event: any) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'dataset.updated',
        'cluster.registered',
        'agent.registered',
        'destination.created',
        'export.created',
        'export.run',
        'job.retried',
        'job.cancelled',
        'cluster.discovered',
        'cluster.retired',
        'cluster.restored',
      ]),
    );
    const tenantAudit = await metroAdmin.get('/audit?pageSize=100');
    expect(tenantAudit.body.items.every((event: any) => event.tenantId === 'metrobank')).toBe(true);
    expect((await metroUser.get('/audit')).status).toBe(403);
  });

  it('prunes heartbeat history and metric samples past retention', async () => {
    await pool.query(`UPDATE data_export.agent_heartbeats SET heartbeat_time = NOW() - INTERVAL '8 days'`);
    const pruned = await scheduler.housekeeping();
    expect(pruned.heartbeats).toBeGreaterThan(0);
    const remaining = await pool.query('SELECT COUNT(*)::int AS count FROM data_export.agent_heartbeats');
    expect(remaining.rows[0].count).toBe(0);
  });
});
