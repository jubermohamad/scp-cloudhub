/**
 * End-to-end test against real PostgreSQL and SFTP servers in Docker.
 *
 * Opt-in: DATA_EXPORT_AGENT_IT=1 yarn test --watchAll=false src/integration.test.ts
 *
 * The test starts (and removes) two containers of its own, `dxh-agent-pg`
 * (postgres:16-alpine) and `dxh-agent-sftp` (atmoz/sftp:alpine), and talks to
 * them on their bridge IPs because published ports are unreliable on WSL.
 *
 * Only injection points are faked: the token provider (the "AAD token" for
 * PostgreSQL is the container's password), the Key Vault resolver (returns
 * the generated private key) and the control plane (a local HTTP server
 * implementing the agent protocol). Guardrails, query building, writers, the
 * SFTP provider (with host key verification) and the HTTP client are the
 * production code.
 */
import { execFileSync } from 'child_process';
import { createHash, generateKeyPairSync } from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { AddressInfo } from 'net';
import { Client } from 'pg';
import SftpClient from 'ssh2-sftp-client';
import { ParquetReader } from '@dsnp/parquetjs';
import { Agent } from './agent';
import { POSTGRES_AAD_SCOPE, TokenProvider } from './auth';
import { ControlPlaneClient } from './controlPlaneClient';
import { JobRunner } from './jobRunner';
import { createLogger, silentLogger } from './logger';
import { parseChecksumContent } from './manifest';
import type {
  CompleteRequest,
  FailRequest,
  HeartbeatRequest,
  JobSpec,
} from './protocol';
import { createDefaultRegistry } from './providers/registry';
import { SourceConnector } from './sql/source';
import { makeJob } from './__fixtures__/fakes';

const enabled = process.env.DATA_EXPORT_AGENT_IT === '1';
const describeIt = enabled ? describe : describe.skip;

const PG_CONTAINER = 'dxh-agent-pg';
const SFTP_CONTAINER = 'dxh-agent-sftp';
const PG_PASSWORD = 'it-only-password';
const CP_SCOPE = 'api://cloudhub-it/.default';
const CP_TOKEN = 'cp-test-token';
const quietCallbacks = { error: () => {}, end: () => {}, close: () => {} };

function docker(...args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function dockerInput(input: string, ...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', input }).trim();
}

function removeOurContainers() {
  for (const name of [PG_CONTAINER, SFTP_CONTAINER]) {
    try {
      docker('rm', '-f', '-v', name);
    } catch {
      // not running
    }
  }
}

function containerIp(name: string): string {
  const ip = docker(
    'inspect',
    '-f',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}',
    name,
  ).split(' ')[0];
  if (!ip) throw new Error(`No bridge IP for ${name}`);
  return ip;
}

async function waitFor<T>(
  what: string,
  fn: () => Promise<T>,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`Timed out waiting for ${what}: ${String(lastError)}`);
}

/** OpenSSH `ssh-rsa` public key line from an RSA key, built from its JWK. */
function opensshRsaPublicKey(publicKey: import('crypto').KeyObject): string {
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
  const blob = Buffer.concat([
    str(Buffer.from('ssh-rsa')),
    mpint(jwk.e),
    mpint(jwk.n),
  ]);
  return `ssh-rsa ${blob.toString('base64')} data-export-agent-it`;
}

/** A control plane implementing the agent protocol in memory. */
class FakeControlPlaneServer {
  readonly queue: JobSpec[] = [];
  readonly heartbeats: HeartbeatRequest[] = [];
  readonly completed = new Map<string, CompleteRequest>();
  readonly failed = new Map<string, FailRequest>();
  readonly progress: Array<{
    jobId: string;
    status: string;
    rowsExported?: number;
  }> = [];
  readonly unauthorized: string[] = [];
  destinationsToCheck: JobSpec['destination'][] = [];
  private server?: http.Server;

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => {
        body += c;
      });
      req.on('end', () => this.handle(req, res, body ? JSON.parse(body) : {}));
    });
    await new Promise<void>(r => this.server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async stop() {
    await new Promise(r => this.server?.close(r));
  }

  private handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: any,
  ) {
    const send = (status: number, payload?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload === undefined ? undefined : JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${CP_TOKEN}`) {
      this.unauthorized.push(req.url ?? '');
      send(403, { error: 'unknown agent' });
      return;
    }
    const url = req.url ?? '';
    const prefix = '/api/data-export/agent';
    if (req.method !== 'POST' || !url.startsWith(prefix)) {
      send(404, { error: 'not found' });
      return;
    }
    const route = url.slice(prefix.length);
    if (route === '/heartbeat') {
      this.heartbeats.push(body);
      const checks = this.destinationsToCheck;
      this.destinationsToCheck = [];
      send(200, {
        agentId: 'agent-it',
        clusterId: 'cluster-it',
        clusterName: 'aks-it',
        tenantId: 'tenant-it',
        heartbeatIntervalSeconds: 5,
        pollIntervalSeconds: 1,
        destinationsToCheck: checks,
      });
      return;
    }
    if (route === '/jobs/claim') {
      const job = this.queue.shift();
      if (job) send(200, { job });
      else send(204);
      return;
    }
    const m = /^\/jobs\/([^/]+)\/(progress|complete|fail)$/.exec(route);
    if (!m) {
      send(404, { error: 'not found' });
      return;
    }
    const jobId = decodeURIComponent(m[1]);
    if (m[2] === 'progress') {
      this.progress.push({
        jobId,
        status: body.status,
        rowsExported: body.rowsExported,
      });
      send(200, { continue: true });
    } else if (m[2] === 'complete') {
      this.completed.set(jobId, body);
      send(200, {});
    } else {
      this.failed.set(jobId, body);
      send(200, { willRetry: false });
    }
  }

  async waitForResult(
    jobId: string,
  ): Promise<{ complete?: CompleteRequest; fail?: FailRequest }> {
    return waitFor(`result of ${jobId}`, async () => {
      const complete = this.completed.get(jobId);
      const fail = this.failed.get(jobId);
      if (!complete && !fail) throw new Error('pending');
      return { complete, fail };
    });
  }
}

describeIt('agent integration (postgres + sftp containers)', () => {
  jest.setTimeout(240_000);

  let pgHost: string;
  let sftpHost: string;
  let fingerprint: string;
  let privateKeyPem: string;
  let cp: FakeControlPlaneServer;
  let agent: Agent;
  let workDir: string;

  const sftpConfig = () => ({
    host: sftpHost,
    port: '22',
    username: 'exporter',
    remotePath: '/upload',
    secretRef: 'kv://it-vault/sftp-key',
    hostKeyFingerprint: fingerprint,
  });

  const pgClient = () =>
    new Client({
      host: pgHost,
      port: 5432,
      user: 'exporter',
      password: PG_PASSWORD,
      database: 'app',
    });

  async function download(remote: string): Promise<Buffer> {
    const c = new SftpClient('it-download', quietCallbacks);
    await c.connect({
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
      return (await c.get(remote)) as Buffer;
    } finally {
      await c.end();
    }
  }

  beforeAll(async () => {
    removeOurContainers();
    docker(
      'run',
      '-d',
      '--name',
      PG_CONTAINER,
      '-e',
      'POSTGRES_USER=exporter',
      '-e',
      `POSTGRES_PASSWORD=${PG_PASSWORD}`,
      '-e',
      'POSTGRES_DB=app',
      'postgres:16-alpine',
    );
    docker(
      'run',
      '-d',
      '--name',
      SFTP_CONTAINER,
      'atmoz/sftp:alpine',
      'exporter::1001::upload',
    );

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    privateKeyPem = privateKey
      .export({ type: 'pkcs1', format: 'pem' })
      .toString();
    const pub = opensshRsaPublicKey(publicKey);

    pgHost = containerIp(PG_CONTAINER);
    sftpHost = containerIp(SFTP_CONTAINER);

    fingerprint = await waitFor('sftp host key', async () => {
      const out = docker(
        'exec',
        SFTP_CONTAINER,
        'ssh-keygen',
        '-lf',
        '/etc/ssh/ssh_host_ed25519_key.pub',
      );
      const fp = out.split(/\s+/)[1];
      if (!fp?.startsWith('SHA256:')) throw new Error(out);
      // The user's chroot home exists once the entrypoint has created the user.
      docker('exec', SFTP_CONTAINER, 'test', '-d', '/home/exporter/upload');
      return fp;
    });
    dockerInput(
      `${pub}\n`,
      'exec',
      '-i',
      SFTP_CONTAINER,
      'sh',
      '-c',
      'mkdir -p /home/exporter/.ssh && cat > /home/exporter/.ssh/authorized_keys && chown -R exporter /home/exporter/.ssh && chmod 700 /home/exporter/.ssh && chmod 600 /home/exporter/.ssh/authorized_keys',
    );

    await waitFor('postgres', async () => {
      const c = pgClient();
      await c.connect();
      await c.end();
    });
    const c = pgClient();
    await c.connect();
    await c.query(`
      CREATE TABLE accounts (
        id serial PRIMARY KEY,
        name text NOT NULL,
        balance numeric(14,2),
        active boolean,
        updated_at timestamptz NOT NULL,
        tags jsonb
      )`);
    await c.query(`
      INSERT INTO accounts (name, balance, active, updated_at, tags)
      SELECT 'acct-' || i, (i * 1000.25)::numeric, i % 2 = 0,
             '2026-10-01 00:00:00.000001+00'::timestamptz + (i || ' minutes')::interval + (i || ' microseconds')::interval,
             jsonb_build_object('n', i)
      FROM generate_series(1, 5) AS i`);
    await c.end();

    await waitFor('sftp login', async () => {
      const probe = new SftpClient('it-probe', quietCallbacks);
      await probe.connect({
        host: sftpHost,
        port: 22,
        username: 'exporter',
        privateKey: privateKeyPem,
        readyTimeout: 5000,
      } as any);
      try {
        await probe.list('/upload');
      } finally {
        await probe.end();
      }
    });

    cp = new FakeControlPlaneServer();
    const baseUrl = await cp.start();
    const logger = process.env.IT_LOG_LEVEL
      ? createLogger(process.env.IT_LOG_LEVEL as any)
      : silentLogger;
    const tokens: TokenProvider = {
      // Fake workload identity: the control plane token, and the PG "AAD token" (container password).
      getToken: async scope => {
        if (scope === CP_SCOPE) return CP_TOKEN;
        if (scope === POSTGRES_AAD_SCOPE) return PG_PASSWORD;
        throw new Error(`unexpected scope ${scope}`);
      },
    };
    const credential = { getToken: async () => null };
    const providers = createDefaultRegistry({
      credential,
      secrets: {
        resolve: async ref => {
          if (ref !== 'kv://it-vault/sftp-key')
            throw new Error(`unexpected secret ${ref}`);
          return privateKeyPem;
        },
      },
    });
    const controlPlane = new ControlPlaneClient({
      baseUrl,
      scope: CP_SCOPE,
      tokens,
      logger,
      retry: { attempts: 2, baseDelayMs: 10, maxDelayMs: 50 },
    });
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxh-agent-it-'));
    const runner = new JobRunner({
      controlPlane,
      source: new SourceConnector({
        pg: {
          host: pgHost,
          port: 5432,
          database: 'app',
          user: 'exporter',
          sslMode: 'disable',
        },
        tokens,
      }),
      providers,
      logger,
      workDir,
      agentName: 'aks-it-data-export-agent',
      agentVersion: '0.1.0',
      clusterName: 'aks-it',
    });
    agent = new Agent({
      controlPlane,
      runner,
      providers,
      logger,
      agentName: 'aks-it-data-export-agent',
      version: '0.1.0',
      clusterInfo: async () => ({}),
      shutdownGraceMs: 10_000,
    });
    cp.destinationsToCheck = [
      { id: 'dest-sftp', type: 'SFTP', configuration: sftpConfig() },
    ];
    agent.start();
  });

  afterAll(async () => {
    await agent?.stop();
    await cp?.stop();
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    removeOurContainers();
  });

  const job = (jobId: string, overrides: Parameters<typeof makeJob>[0]) => {
    const j = makeJob({
      jobId,
      destination: {
        id: 'dest-sftp',
        type: 'SFTP',
        configuration: sftpConfig(),
      },
      ...overrides,
    });
    j.outputPrefix = `tenant/tenant-a/exports/nightly/2026/10/20/${jobId}`;
    return j;
  };

  let firstWatermark: string;

  it('reports a healthy SFTP destination check in a heartbeat', async () => {
    const check = await waitFor('destination check', async () => {
      const hb = cp.heartbeats.find(h => h.destinationChecks?.length);
      if (!hb) throw new Error('pending');
      return hb.destinationChecks![0];
    });
    expect(check).toMatchObject({
      destinationId: 'dest-sftp',
      status: 'HEALTHY',
    });
    expect(cp.unauthorized).toEqual([]);
  });

  it('exports all rows to Parquet over SFTP on the first INCREMENTAL run', async () => {
    cp.queue.push(
      job('it-job-1', {
        profile: {
          exportMode: 'INCREMENTAL',
          watermarkStrategy: 'GREATER_THAN',
          fileFormat: 'PARQUET',
          compression: 'SNAPPY',
        },
        dataset: {
          datasetId: 'accounts',
          sqlTemplate:
            'SELECT id, name, balance, active, updated_at, tags FROM accounts;',
          watermarkColumn: 'updated_at',
        },
        watermark: { lastSuccessValue: null },
      }),
    );
    const { complete, fail } = await cp.waitForResult('it-job-1');
    expect(fail).toBeUndefined();
    expect(complete!.rowsExported).toBe(5);
    expect(complete!.watermarkValue).toBe('2026-10-01 00:05:00.000006+00');
    firstWatermark = complete!.watermarkValue!;
    expect(complete!.files.map(f => f.name)).toEqual([
      'accounts.parquet',
      'checksum.sha256',
      'manifest.json',
    ]);
    const dir = '/upload/tenant/tenant-a/exports/nightly/2026/10/20/it-job-1';
    expect(complete!.files.map(f => f.path)).toEqual([
      `${dir}/accounts.parquet`,
      `${dir}/checksum.sha256`,
      `${dir}/manifest.json`,
    ]);
    expect(
      cp.progress.filter(p => p.jobId === 'it-job-1').map(p => p.status),
    ).toEqual(['RUNNING', 'UPLOADING']);

    const parquet = await download(`${dir}/accounts.parquet`);
    const checksum = (await download(`${dir}/checksum.sha256`)).toString();
    const manifest = JSON.parse(
      (await download(`${dir}/manifest.json`)).toString(),
    );
    const sha = createHash('sha256').update(parquet).digest('hex');
    expect(parseChecksumContent(checksum).get('accounts.parquet')).toBe(sha);
    expect(complete!.files[0].sha256).toBe(sha);
    expect(manifest).toEqual(complete!.manifest);
    expect(manifest).toMatchObject({
      records: 5,
      exportMode: 'INCREMENTAL',
      format: 'PARQUET',
      watermark: { column: 'updated_at', from: null, to: firstWatermark },
    });

    const local = path.join(workDir, 'downloaded.parquet');
    fs.writeFileSync(local, parquet);
    const reader = await ParquetReader.openFile(local);
    const cursor = reader.getCursor();
    const rows: any[] = [];
    for (let r = await cursor.next(); r; r = await cursor.next()) rows.push(r);
    await reader.close();
    expect(rows).toHaveLength(5);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'active',
      'balance',
      'id',
      'name',
      'tags',
      'updated_at',
    ]);
    expect(rows[0]).toMatchObject({
      id: 1,
      name: 'acct-1',
      balance: '1000.25',
      active: false,
      tags: '{"n":1}',
    });
    expect(rows[4].updated_at).toEqual(new Date('2026-10-01T00:05:00.000Z'));
    // No temp files left behind.
    expect(fs.readdirSync(workDir)).toEqual(['downloaded.parquet']);
  });

  it('exports only new rows to gzipped CSV on the next INCREMENTAL run and advances the watermark', async () => {
    const c = pgClient();
    await c.connect();
    await c.query(`
      INSERT INTO accounts (name, balance, active, updated_at, tags)
      SELECT 'new-' || i, i, true, '2026-10-02 00:00:00+00'::timestamptz + (i || ' seconds')::interval, NULL
      FROM generate_series(1, 3) AS i`);
    await c.end();

    cp.queue.push(
      job('it-job-2', {
        profile: {
          exportMode: 'INCREMENTAL',
          watermarkStrategy: 'GREATER_THAN',
          fileFormat: 'CSV',
          compression: 'GZIP',
        },
        dataset: {
          datasetId: 'accounts',
          sqlTemplate: 'SELECT id, name, balance, updated_at FROM accounts',
          watermarkColumn: 'updated_at',
        },
        watermark: { lastSuccessValue: firstWatermark },
      }),
    );
    const { complete, fail } = await cp.waitForResult('it-job-2');
    expect(fail).toBeUndefined();
    expect(complete!.rowsExported).toBe(3);
    expect(complete!.watermarkValue).toBe('2026-10-02 00:00:03+00');
    expect(complete!.manifest.watermark).toEqual({
      column: 'updated_at',
      from: firstWatermark,
      to: '2026-10-02 00:00:03+00',
    });

    const dir = '/upload/tenant/tenant-a/exports/nightly/2026/10/20/it-job-2';
    const gz = await download(`${dir}/accounts.csv.gz`);
    const csv = zlib.gunzipSync(gz).toString().split('\r\n').filter(Boolean);
    expect(csv[0]).toBe('id,name,balance,updated_at');
    expect(csv.slice(1).map(l => l.split(',')[1])).toEqual([
      'new-1',
      'new-2',
      'new-3',
    ]);
    const checksum = (await download(`${dir}/checksum.sha256`)).toString();
    expect(parseChecksumContent(checksum).get('accounts.csv.gz')).toBe(
      createHash('sha256').update(gz).digest('hex'),
    );
  });

  it('cannot write through a data-modifying CTE: the read-only guardrail stops it', async () => {
    cp.queue.push(
      job('it-job-3', {
        dataset: {
          datasetId: 'evil',
          sqlTemplate:
            "WITH x AS (INSERT INTO accounts (name, updated_at) VALUES ('evil', now()) RETURNING id) SELECT * FROM x",
        },
      }),
    );
    const { complete, fail } = await cp.waitForResult('it-job-3');
    expect(complete).toBeUndefined();
    expect(fail).toMatchObject({
      retryable: false,
      errorMessage: expect.stringMatching(/read-only transaction/),
    });
    const c = pgClient();
    await c.connect();
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM accounts WHERE name = 'evil'",
    );
    await c.end();
    expect(rows[0].n).toBe(0);
  });

  it('refuses an SFTP server whose host key does not match', async () => {
    cp.queue.push(
      job('it-job-4', {
        destination: {
          id: 'dest-bad',
          type: 'SFTP',
          configuration: {
            ...sftpConfig(),
            hostKeyFingerprint: `SHA256:${'A'.repeat(43)}`,
          },
        },
      }),
    );
    const { complete, fail } = await cp.waitForResult('it-job-4');
    expect(complete).toBeUndefined();
    expect(fail).toMatchObject({
      retryable: false,
      errorMessage: expect.stringMatching(/host key verification failed/),
    });
  });

  it('heartbeats as ONLINE/DEGRADED with capabilities', () => {
    const hb = cp.heartbeats[0];
    expect(hb).toMatchObject({
      protocolVersion: 1,
      agentName: 'aks-it-data-export-agent',
      capabilities: {
        providers: ['ADLS_GEN2', 'SFTP'],
        formats: ['PARQUET', 'CSV', 'TSV', 'JSON'],
      },
    });
  });
});
