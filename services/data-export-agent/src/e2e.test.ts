/**
 * Whole-platform test: the production agent against the real control plane.
 *
 * Opt-in: DATA_EXPORT_E2E=1 yarn test --watchAll=false src/e2e.test.ts
 *
 * Runs, in this process:
 * - the CloudHub control plane router (plugins/data-export-hub-backend) over HTTP
 *   at /api/data-export, backed by a real PostgreSQL schema;
 * - the scheduler (plugins/data-export-scheduler) turning a schedule into a job;
 * - the agent (this package) heartbeating, claiming, extracting from a real
 *   PostgreSQL "read replica" under its guardrails, and delivering to a real
 *   SFTP server with host key verification.
 *
 * Only identity is faked: Backstage's token verification (bearer tokens map to
 * a user or the agent's workload identity subject), the agent's Entra tokens,
 * and the Key Vault lookup of the SFTP key. Containers `dxh-e2e-pg` and
 * `dxh-e2e-sftp` are started and removed by the test.
 */
import { execFileSync } from 'child_process';
import { createHash, generateKeyPairSync, KeyObject } from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { AddressInfo } from 'net';
import express from 'express';
import { Client, Pool } from 'pg';
import SftpClient from 'ssh2-sftp-client';
// eslint-disable-next-line @backstage/no-mixed-plugin-imports
import {
  DataExportDatabase,
  createDataExportRouter,
} from '@internal/plugin-data-export-hub-backend';
// eslint-disable-next-line @backstage/no-mixed-plugin-imports
import {
  ExportScheduler,
  SchedulerDatabase,
} from '@internal/plugin-data-export-scheduler';
import { Agent } from './agent';
import { POSTGRES_AAD_SCOPE, TokenProvider } from './auth';
import { ControlPlaneClient } from './controlPlaneClient';
import { JobRunner } from './jobRunner';
import { silentLogger } from './logger';
import { parseChecksumContent } from './manifest';
import { createDefaultRegistry } from './providers/registry';
import { SourceConnector } from './sql/source';

const enabled = process.env.DATA_EXPORT_E2E === '1';
const describeE2e = enabled ? describe : describe.skip;

const PG = 'dxh-e2e-pg';
const SFTP = 'dxh-e2e-sftp';
const PG_PASSWORD = 'e2e-only-password';
const CP_SCOPE = 'api://cloudhub-e2e/.default';
const AGENT_OBJECT_ID = 'cccccccc-3333-4333-8333-333333333333';
const TOKENS: Record<
  string,
  { type: 'user'; groups: string[] } | { type: 'service'; subject: string }
> = {
  'admin-token': {
    type: 'user',
    groups: ['group:default/cloudhub.dataexport.admin'],
  },
  'metro-admin-token': {
    type: 'user',
    groups: ['group:default/cloudhub.dataexport.tenant.metrobank.admin'],
  },
  'agent-token': {
    type: 'service',
    subject: `external:data-export-agent:${AGENT_OBJECT_ID}`,
  },
};
const quiet = { error: () => {}, end: () => {}, close: () => {} };

const docker = (...args: string[]) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
const dockerInput = (input: string, ...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', input });
const ipOf = (name: string) =>
  docker(
    'inspect',
    '-f',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}',
    name,
  ).split(' ')[0];
const removeContainers = () => {
  for (const name of [PG, SFTP]) {
    try {
      docker('rm', '-f', '-v', name);
    } catch {
      // not running
    }
  }
};

async function waitFor<T>(
  what: string,
  fn: () => Promise<T>,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for ${what}: ${String(last)}`);
}

function opensshRsaPublicKey(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  const str = (b: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    return Buffer.concat([len, b]);
  };
  const mpint = (b64url: string) => {
    let b = Buffer.from(b64url, 'base64url');
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    return str(b);
  };
  return `ssh-rsa ${Buffer.concat([
    str(Buffer.from('ssh-rsa')),
    mpint(jwk.e),
    mpint(jwk.n),
  ]).toString('base64')} e2e`;
}

/** Backstage auth stand-in: maps bearer tokens to principals the way Backstage would after verifying them. */
function fakeBackstageAuth() {
  const principalOf = (req: express.Request) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    return TOKENS[token];
  };
  const httpAuth = {
    credentials: async (req: express.Request, options: { allow: string[] }) => {
      const principal = principalOf(req);
      if (!principal) {
        const error = new Error('Missing credentials');
        error.name = 'AuthenticationError';
        throw error;
      }
      if (!options.allow.includes(principal.type)) {
        const error = new Error(
          `This endpoint does not allow '${principal.type}' credentials`,
        );
        error.name = 'NotAllowedError';
        throw error;
      }
      return principal.type === 'user'
        ? { principal: { type: 'user' }, groups: principal.groups }
        : { principal: { type: 'service', subject: principal.subject } };
    },
  };
  const userInfo = {
    getUserInfo: async (credentials: { groups: string[] }) => ({
      userEntityRef: 'user:default/e2e',
      ownershipEntityRefs: credentials.groups,
    }),
  };
  return { httpAuth, userInfo };
}

describeE2e(
  'Data Export Hub end to end (control plane + scheduler + agent)',
  () => {
    jest.setTimeout(300_000);

    let pgHost: string;
    let sftpHost: string;
    let fingerprint: string;
    let privateKeyPem: string;
    let server: http.Server;
    let baseUrl: string;
    let cloudhubPool: Pool;
    let scheduler: ExportScheduler;
    let agent: Agent;
    let workDir: string;
    const ids: Record<string, string> = {};

    const api = async (
      token: string,
      method: string,
      url: string,
      body?: unknown,
    ) => {
      const response = await fetch(`${baseUrl}/api/data-export${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }).catch(error => {
        throw new Error(
          `${method} ${url}: ${error.message} (${String(error.cause)})`,
        );
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : undefined,
      };
    };
    const admin = (method: string, url: string, body?: unknown) =>
      api('admin-token', method, url, body);
    const metro = (method: string, url: string, body?: unknown) =>
      api('metro-admin-token', method, url, body);

    const source = () =>
      new Client({
        host: pgHost,
        port: 5432,
        user: 'exporter',
        password: PG_PASSWORD,
        database: 'nr_replica',
      });

    async function sftpGet(remote: string): Promise<Buffer> {
      const client = new SftpClient('e2e-download', quiet);
      await client.connect({
        host: sftpHost,
        port: 22,
        username: 'exporter',
        privateKey: privateKeyPem,
        hostVerifier: (key: Buffer) =>
          `SHA256:${createHash('sha256')
            .update(key)
            .digest('base64')
            .replace(/=+$/, '')}` === fingerprint,
      } as any);
      try {
        return (await client.get(remote)) as Buffer;
      } finally {
        await client.end();
      }
    }

    const waitForJob = (jobId: string, status: string) =>
      waitFor(`job ${jobId} ${status}`, async () => {
        const job = (await metro('GET', `/jobs/${jobId}`)).body;
        if (job.status !== status)
          throw new Error(`${job.status} ${job.errorMessage ?? ''}`);
        return job;
      });

    beforeAll(async () => {
      removeContainers();
      docker(
        'run',
        '-d',
        '--name',
        PG,
        '-e',
        'POSTGRES_USER=exporter',
        '-e',
        `POSTGRES_PASSWORD=${PG_PASSWORD}`,
        '-e',
        'POSTGRES_DB=cloudhub',
        'postgres:16-alpine',
      );
      docker(
        'run',
        '-d',
        '--name',
        SFTP,
        'atmoz/sftp:alpine',
        'exporter::1001::outbound',
      );
      pgHost = ipOf(PG);
      sftpHost = ipOf(SFTP);

      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      privateKeyPem = privateKey
        .export({ type: 'pkcs1', format: 'pem' })
        .toString();
      fingerprint = await waitFor('sftp host key', async () => {
        const fp = docker(
          'exec',
          SFTP,
          'ssh-keygen',
          '-lf',
          '/etc/ssh/ssh_host_ed25519_key.pub',
        ).split(/\s+/)[1];
        if (!fp?.startsWith('SHA256:')) throw new Error('no host key yet');
        docker('exec', SFTP, 'test', '-d', '/home/exporter/outbound');
        return fp;
      });
      dockerInput(
        `${opensshRsaPublicKey(publicKey)}\n`,
        'exec',
        '-i',
        SFTP,
        'sh',
        '-c',
        'mkdir -p /home/exporter/.ssh && cat > /home/exporter/.ssh/authorized_keys && chown -R exporter /home/exporter/.ssh && chmod 700 /home/exporter/.ssh && chmod 600 /home/exporter/.ssh/authorized_keys',
      );

      // One PostgreSQL server plays both roles: database `cloudhub` for the control
      // plane, database `nr_replica` for the customer's NetReveal read replica.
      await waitFor('postgres', async () => {
        const c = new Client({
          host: pgHost,
          user: 'exporter',
          password: PG_PASSWORD,
          database: 'cloudhub',
        });
        await c.connect();
        await c.query('CREATE DATABASE nr_replica');
        await c.end();
      });
      const replica = source();
      await replica.connect();
      await replica.query(`CREATE TABLE nr_v_cases (
      case_id BIGINT PRIMARY KEY, status TEXT, risk_score NUMERIC(6,2), updated_at TIMESTAMPTZ NOT NULL)`);
      await replica.query(`INSERT INTO nr_v_cases
      SELECT i, CASE WHEN i % 2 = 0 THEN 'OPEN' ELSE 'CLOSED' END, i * 1.5,
             '2026-10-20 00:00:00+00'::timestamptz + (i || ' minutes')::interval
        FROM generate_series(1, 25) AS i`);
      await replica.end();

      cloudhubPool = new Pool({
        host: pgHost,
        user: 'exporter',
        password: PG_PASSWORD,
        database: 'cloudhub',
      });
      const db = new DataExportDatabase(cloudhubPool, silentLogger as any);
      await db.migrate();
      const { httpAuth, userInfo } = fakeBackstageAuth();
      const app = express();
      app.use(
        '/api/data-export',
        createDataExportRouter({
          logger: silentLogger as any,
          httpAuth: httpAuth as any,
          userInfo: userInfo as any,
          db,
        }),
      );
      server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      // In some sandboxes the first connection to a freshly bound loopback port is
      // refused; wait until the control plane answers (401 without a token).
      await waitFor('control plane', async () => {
        const response = await fetch(`${baseUrl}/api/data-export/me`);
        if (response.status !== 401) throw new Error(`HTTP ${response.status}`);
      });
      const dataset = await admin('POST', '/datasets', {
        datasetId: 'NR_V_CASES',
        displayName: 'NetReveal Cases (E2E fixture)',
        category: 'CASES',
        sourceProduct: 'NETREVEAL',
        classification: 'CONFIDENTIAL',
        containsPii: true,
        containsSensitiveData: true,
      });
      if (dataset.status !== 201) {
        throw new Error(`Could not create E2E catalog fixture: HTTP ${dataset.status}`);
      }
      scheduler = new ExportScheduler(
        new SchedulerDatabase(
          new Pool({
            host: pgHost,
            user: 'exporter',
            password: PG_PASSWORD,
            database: 'cloudhub',
          }),
        ),
        silentLogger as any,
      );
    });

    afterAll(async () => {
      await agent?.stop();
      await new Promise(resolve => server?.close(resolve));
      await cloudhubPool?.end();
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
      removeContainers();
    });

    it('is configured through the API: dataset, cluster, agent identity, destination and export', async () => {
      const cases = (await admin('GET', '/datasets?search=NR_V_CASES')).body
        .items[0];
      ids.dataset = cases.id;
      expect(
        (
          await admin('PUT', `/datasets/${cases.id}`, {
            sqlTemplate:
              'SELECT case_id, status, risk_score, updated_at FROM nr_v_cases',
            supportsIncremental: true,
            watermarkColumn: 'updated_at',
            primaryKeys: ['case_id'],
          })
        ).status,
      ).toBe(200);

      const cluster = await admin('POST', '/clusters', {
        clusterName: 'aks-metro-prod',
        environment: 'PRODUCTION',
        tenantId: 'metrobank',
      });
      ids.cluster = cluster.body.id;
      expect(
        (
          await admin('POST', `/clusters/${ids.cluster}/agents`, {
            identitySubject: AGENT_OBJECT_ID,
          })
        ).status,
      ).toBe(201);

      const destination = await metro('POST', '/destinations', {
        type: 'SFTP',
        name: 'metrobank-sftp',
        tenantId: 'metrobank',
        configuration: {
          host: sftpHost,
          username: 'exporter',
          remotePath: '/outbound',
          secretRef: 'kv://kv-metrobank/sftp-exporter-key',
          hostKeyFingerprint: fingerprint,
        },
      });
      expect(destination.status).toBe(201);
      ids.destination = destination.body.id;

      const created = await metro('POST', '/exports', {
        name: 'Daily cases',
        tenantId: 'metrobank',
        environment: 'PRODUCTION',
        clusterId: ids.cluster,
        schedule: 'HOURLY',
        exportMode: 'INCREMENTAL',
        fileFormat: 'CSV',
        destinationId: ids.destination,
        datasetIds: [ids.dataset],
      });
      expect(created.status).toBe(201);
      expect(created.body.compression).toBe('GZIP');
      ids.export = created.body.id;
    });

    it('starts the agent, which heartbeats and runs a live destination check', async () => {
      const tokens: TokenProvider = {
        getToken: async scope => {
          if (scope === CP_SCOPE) return 'agent-token';
          if (scope === POSTGRES_AAD_SCOPE) return PG_PASSWORD;
          throw new Error(`unexpected scope ${scope}`);
        },
      };
      const providers = createDefaultRegistry({
        credential: { getToken: async () => null },
        secrets: {
          resolve: async ref => {
            if (ref !== 'kv://kv-metrobank/sftp-exporter-key')
              throw new Error(`unexpected secret ${ref}`);
            return privateKeyPem;
          },
        },
      });
      const controlPlane = new ControlPlaneClient({
        baseUrl,
        scope: CP_SCOPE,
        tokens,
        logger: silentLogger,
        retry: { attempts: 2, baseDelayMs: 10, maxDelayMs: 50 },
      });
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxh-e2e-'));
      const runner = new JobRunner({
        controlPlane,
        source: new SourceConnector({
          pg: {
            host: pgHost,
            port: 5432,
            database: 'nr_replica',
            user: 'exporter',
            sslMode: 'disable',
          },
          tokens,
        }),
        providers,
        logger: silentLogger,
        workDir,
        agentName: 'aks-metro-prod-data-export-agent',
        agentVersion: '1.0.0',
        clusterName: 'aks-metro-prod',
      });
      agent = new Agent({
        controlPlane,
        runner,
        providers,
        logger: silentLogger,
        agentName: 'aks-metro-prod-data-export-agent',
        version: '1.0.0',
        clusterInfo: async () => ({ kubernetesVersion: 'e2e' }),
        shutdownGraceMs: 10_000,
      });
      agent.start();

      const cluster = await waitFor('cluster healthy', async () => {
        const c = (await metro('GET', `/clusters/${ids.cluster}`)).body;
        if (c.health !== 'HEALTHY') throw new Error(c.health);
        return c;
      });
      expect(cluster.agentVersion).toBe('1.0.0');
      const destination = await waitFor('live destination check', async () => {
        const d = (await metro('GET', `/destinations/${ids.destination}`)).body;
        if (d.status !== 'HEALTHY')
          throw new Error(`${d.status} ${d.lastTestMessage}`);
        return d;
      });
      expect(destination.lastTestMessage).toMatch(
        /Live check from aks-metro-prod/,
      );
    });

    it('delivers a scheduled incremental export over SFTP and advances the watermark', async () => {
      await cloudhubPool.query(
        `UPDATE data_export.export_profiles SET last_scheduled_at = NOW() - INTERVAL '2 hours' WHERE id = $1`,
        [ids.export],
      );
      expect(await scheduler.tick()).toMatchObject({
        jobsCreated: 1,
        jobsQueued: 1,
      });
      const jobId = (await metro('GET', `/jobs?exportId=${ids.export}`)).body
        .items[0].id;

      const job = await waitForJob(jobId, 'COMPLETED');
      expect(job).toMatchObject({
        rowsExported: 25,
        filesDelivered: 3,
        watermarkFrom: null,
      });
      expect(job.watermarkTo).toContain('2026-10-20 00:25:00');

      const dir = path.posix.dirname(
        job.outputFiles.find((f: any) => f.name === 'manifest.json').path,
      );
      expect(dir).toMatch(
        /^\/outbound\/tenant\/metrobank\/exports\/daily-cases-[0-9a-f]{8}\/\d{4}\/\d{2}\/\d{2}\//,
      );
      const manifest = JSON.parse(
        (await sftpGet(`${dir}/manifest.json`)).toString(),
      );
      expect(manifest).toMatchObject({
        tenant: 'metrobank',
        dataset: 'NR_V_CASES',
        runId: jobId,
        status: 'COMPLETED',
        records: 25,
      });
      const data = await sftpGet(`${dir}/NR_V_CASES.csv.gz`);
      const checksums = parseChecksumContent(
        (await sftpGet(`${dir}/checksum.sha256`)).toString(),
      );
      expect(checksums.get('NR_V_CASES.csv.gz')).toBe(
        createHash('sha256').update(data).digest('hex'),
      );
      const csv = zlib.gunzipSync(data).toString().trim().split(/\r?\n/);
      expect(csv[0]).toBe('case_id,status,risk_score,updated_at');
      expect(csv).toHaveLength(26);

      const watermark = await cloudhubPool.query(
        'SELECT last_success_value FROM data_export.watermarks',
      );
      expect(watermark.rows[0].last_success_value).toBe(job.watermarkTo);
    });

    it('exports only new rows on the next run', async () => {
      const replica = source();
      await replica.connect();
      await replica.query(`INSERT INTO nr_v_cases
      SELECT i, 'OPEN', 9.99, '2026-10-21 00:00:00+00'::timestamptz + (i || ' seconds')::interval
        FROM generate_series(100, 103) AS i`);
      await replica.end();

      const run = await metro('POST', `/exports/${ids.export}/run`);
      expect(run.status).toBe(202);
      const job = await waitForJob(run.body[0].id, 'COMPLETED');
      expect(job.rowsExported).toBe(4);
      expect(job.watermarkFrom).toContain('2026-10-20 00:25:00');
      expect(job.watermarkTo).toContain('2026-10-21 00:01:43');
    });

    it('fails a job whose SQL tries to write, without retrying or moving the watermark', async () => {
      const before = (
        await cloudhubPool.query(
          'SELECT last_success_value FROM data_export.watermarks',
        )
      ).rows[0];
      await admin('PUT', `/datasets/${ids.dataset}`, {
        sqlTemplate:
          'WITH gone AS (DELETE FROM nr_v_cases RETURNING *) SELECT case_id, status, risk_score, updated_at FROM gone',
      });
      const run = await metro('POST', `/exports/${ids.export}/run`);
      const job = await waitForJob(run.body[0].id, 'FAILED');
      expect(job.retryCount).toBe(0);
      // Rejected by PostgreSQL either way: the read-only session, or (because the
      // incremental wrapper nests the template) the rule that writing CTEs must be top level.
      expect(job.errorMessage).toMatch(/read-only|data-modifying/i);
      const replica = source();
      await replica.connect();
      expect(
        (await replica.query('SELECT COUNT(*)::int AS n FROM nr_v_cases'))
          .rows[0].n,
      ).toBe(29);
      await replica.end();
      const after = (
        await cloudhubPool.query(
          'SELECT last_success_value FROM data_export.watermarks',
        )
      ).rows[0];
      expect(after).toEqual(before);
    });

    it('shows the work on the dashboard', async () => {
      const dashboard = (await metro('GET', '/dashboard')).body;
      expect(dashboard.kpis).toMatchObject({
        healthyClusters: 1,
        connectedAgents: 1,
        completedJobsToday: 2,
        failedJobsToday: 1,
        rowsExportedToday: 29,
      });
      expect(dashboard.topDestinations[0]).toMatchObject({
        name: 'metrobank-sftp',
        filesDelivered: 6,
      });
    });
  },
);
