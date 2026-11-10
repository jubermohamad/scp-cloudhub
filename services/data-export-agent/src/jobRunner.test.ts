import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  FakeControlPlane,
  FakeProvider,
  FakeSourceClient,
  makeJob,
} from './__fixtures__/fakes';
import { JobRunner } from './jobRunner';
import { silentLogger } from './logger';
import { parseChecksumContent } from './manifest';
import { ProviderRegistry } from './providers/registry';
import { WATERMARK_COLUMN_ALIAS } from './sql/queryBuilder';
import { applyGuardrails, SourceConnector } from './sql/source';
import { PG_OID } from './writers/parquetWriter';
import { sha256Hex } from './writers/hashingSink';

const fields = [
  { name: 'id', dataTypeID: PG_OID.int4 },
  { name: 'name', dataTypeID: 25 },
];
const rows = [
  { id: 1, name: 'a' },
  { id: 2, name: 'b' },
  { id: 3, name: 'c' },
];

let workDir: string;
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxh-runner-'));
});
afterEach(() => fs.rmSync(workDir, { recursive: true, force: true }));

function setup(
  options: {
    rows?: any[];
    fields?: any[];
    client?: FakeSourceClient;
    progressIntervalMs?: number;
  } = {},
) {
  const controlPlane = new FakeControlPlane();
  const provider = new FakeProvider('SFTP');
  const client =
    options.client ??
    new FakeSourceClient(options.rows ?? rows, options.fields ?? fields);
  // The real connector (guardrails included) over a fake pg client.
  const source = new SourceConnector({
    pg: { host: 'h', port: 5432, database: 'd', user: 'u', sslMode: 'disable' },
    tokens: { getToken: async () => 'token' },
    clientFactory: () => client,
  });
  const connect = jest.spyOn(source, 'connect');
  const runner = new JobRunner({
    controlPlane,
    source,
    providers: new ProviderRegistry([provider]),
    logger: silentLogger,
    workDir,
    agentName: 'aks-1-data-export-agent',
    agentVersion: '0.1.0',
    clusterName: 'aks-1',
    progressIntervalMs: options.progressIntervalMs,
  });
  return { controlPlane, provider, client, connect, runner };
}

describe('JobRunner', () => {
  it('runs a FULL job end to end', async () => {
    const { runner, controlPlane, provider, client } = setup();
    const outcome = await runner.run(
      makeJob({ profile: { retentionDays: 30 } }),
    );

    expect(outcome).toEqual({
      status: 'COMPLETED',
      rows: 3,
      bytes: expect.any(Number),
      watermarkValue: null,
    });
    expect(controlPlane.ops()).toEqual(['progress', 'progress', 'complete']);
    expect(controlPlane.calls[0]).toMatchObject({
      body: { status: 'RUNNING' },
    });
    expect(controlPlane.calls[1]).toMatchObject({
      body: { status: 'UPLOADING', rowsExported: 3 },
    });

    // Upload order: data, checksum, manifest last.
    expect(provider.uploads.map(u => u.name)).toEqual([
      'accounts.csv',
      'checksum.sha256',
      'manifest.json',
    ]);
    const [data, checksum, manifest] = provider.uploads;
    expect(data.content.toString()).toBe('id,name\r\n1,a\r\n2,b\r\n3,c\r\n');
    expect(
      parseChecksumContent(checksum.content.toString()).get('accounts.csv'),
    ).toBe(sha256Hex(data.content));
    const manifestJson = JSON.parse(manifest.content.toString());
    expect(manifestJson).toMatchObject({
      records: 3,
      runId: 'job-1',
      status: 'COMPLETED',
      format: 'CSV',
    });

    const complete = controlPlane.last('complete')!.body;
    expect(complete.files.map(f => f.name)).toEqual([
      'accounts.csv',
      'checksum.sha256',
      'manifest.json',
    ]);
    expect(complete.manifest).toEqual(manifestJson);
    expect(complete.rowsExported).toBe(3);
    expect(complete.watermarkValue).toBeNull();
    expect(complete.logs).toMatch(/Job claimed/);

    // Guardrails ran before the dataset query.
    expect(client.statements.map(s => s.text)).toEqual([
      'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;',
      "SET statement_timeout='7200s';",
      'SHOW transaction_read_only',
      'SELECT id, name FROM accounts',
    ]);
    expect(client.ended).toBe(true);
    expect(provider.retentionCalls).toEqual([
      { prefix: 'tenant/tenant-a/exports/nightly', days: 30 },
    ]);
    expect(fs.readdirSync(workDir)).toEqual([]);
  });

  it('tracks the watermark for INCREMENTAL and drops the helper column', async () => {
    const incRows = [
      { id: 5, name: 'e', [WATERMARK_COLUMN_ALIAS]: '5' },
      { id: 9, name: 'i', [WATERMARK_COLUMN_ALIAS]: '9' },
      { id: null, name: 'n', [WATERMARK_COLUMN_ALIAS]: null },
    ];
    const { runner, controlPlane, provider, client } = setup({
      rows: incRows,
      fields: [...fields, { name: WATERMARK_COLUMN_ALIAS, dataTypeID: 25 }],
    });
    const job = makeJob({
      profile: {
        exportMode: 'INCREMENTAL',
        watermarkStrategy: 'GREATER_THAN',
        fileFormat: 'JSON',
      },
      dataset: { watermarkColumn: 'id' },
      watermark: { lastSuccessValue: '4' },
    });
    const outcome = await runner.run(job);
    expect(outcome).toMatchObject({ status: 'COMPLETED', watermarkValue: '9' });
    const query = client.statements[3];
    expect(query.text).toContain('WHERE src."id" > $1');
    expect(query.values).toEqual(['4']);
    const lines = provider.uploads[0].content
      .toString()
      .trim()
      .split('\n')
      .map(l => JSON.parse(l));
    expect(lines[0]).toEqual({ id: 5, name: 'e' });
    const complete = controlPlane.last('complete')!.body;
    expect(complete.watermarkValue).toBe('9');
    expect(complete.manifest.watermark).toEqual({
      column: 'id',
      from: '4',
      to: '9',
    });
  });

  it('leaves the watermark unchanged when an incremental run finds nothing new', async () => {
    const { runner, controlPlane } = setup({
      rows: [],
      fields: [...fields, { name: WATERMARK_COLUMN_ALIAS, dataTypeID: 25 }],
    });
    await runner.run(
      makeJob({
        profile: { exportMode: 'INCREMENTAL' },
        dataset: { watermarkColumn: 'id' },
        watermark: { lastSuccessValue: '9' },
      }),
    );
    const complete = controlPlane.last('complete')!.body;
    expect(complete.rowsExported).toBe(0);
    expect(complete.watermarkValue).toBeNull();
    expect(complete.manifest.watermark).toEqual({
      column: 'id',
      from: '9',
      to: '9',
    });
  });

  it('generates TSV files and packages into export.zip for a package export', async () => {
    const { runner, provider } = setup({
      rows: [
        { id: 101, name: 'note-1' },
        { id: 102, name: 'note-2' },
      ],
    });
    const job = makeJob({
      profile: {
        packageCode: 'workflow-audit',
        packageName: 'Workflow Actions, Notes & Audit Trail',
        fileFormat: 'TSV',
      },
      packageReports: [
        {
          id: 'ds-1',
          datasetId: 'NR_WORKFLOW_NOTE',
          sqlTemplate: 'SELECT id, name FROM nr_workflow_note',
          watermarkColumn: null,
          primaryKeys: ['id'],
        },
        {
          id: 'ds-2',
          datasetId: 'NR_WORKFLOW_ACTIONS',
          sqlTemplate: 'SELECT id, name FROM nr_workflow_actions',
          watermarkColumn: null,
          primaryKeys: ['id'],
        },
      ],
    });

    const outcome = await runner.run(job);
    expect(outcome.status).toBe('COMPLETED');
    expect(provider.uploads.map(u => u.name)).toEqual([
      'export.zip',
      'manifest.json',
    ]);
    const manifestJson = JSON.parse(provider.uploads[1].content.toString());
    expect(manifestJson).toMatchObject({
      customer: 'tenant-a',
      package: 'workflow-audit',
      status: 'COMPLETED',
    });
  });

  it('runs SNAPSHOT inside a repeatable read, read-only transaction', async () => {
    const { runner, client } = setup();
    await runner.run(
      makeJob({
        profile: {
          exportMode: 'SNAPSHOT',
          fileFormat: 'PARQUET',
          compression: 'SNAPPY',
        },
      }),
    );
    expect(client.statements.slice(3).map(s => s.text)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'SELECT id, name FROM accounts',
      'COMMIT',
    ]);
  });

  it('stops without reporting when the first progress answers continue:false', async () => {
    const { runner, controlPlane, provider, connect } = setup();
    controlPlane.progressAnswers = [false];
    expect(await runner.run(makeJob())).toEqual({ status: 'CANCELLED' });
    expect(controlPlane.ops()).toEqual(['progress']);
    expect(connect).not.toHaveBeenCalled();
    expect(provider.uploads).toEqual([]);
  });

  it('discards output when cancelled before upload', async () => {
    const { runner, controlPlane, provider } = setup();
    controlPlane.progressAnswers = [true, false];
    expect(await runner.run(makeJob())).toEqual({ status: 'CANCELLED' });
    expect(controlPlane.ops()).toEqual(['progress', 'progress']);
    expect(provider.uploads).toEqual([]);
    expect(fs.readdirSync(workDir)).toEqual([]);
  });

  it('sends throttled RUNNING progress with row counts during the extract and honours cancellation there', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `n${i}`,
    }));
    const { runner, controlPlane, provider } = setup({
      rows: many,
      progressIntervalMs: 0,
    });
    controlPlane.progressAnswers = [true, true, true, false];
    expect(await runner.run(makeJob())).toEqual({ status: 'CANCELLED' });
    const progress = controlPlane.calls.filter(
      c => c.op === 'progress',
    ) as any[];
    expect(progress).toHaveLength(4);
    expect(progress[1].body).toMatchObject({
      status: 'RUNNING',
      rowsExported: 1,
    });
    expect(progress[3].body).toMatchObject({
      status: 'RUNNING',
      rowsExported: 3,
    });
    expect(controlPlane.ops()).not.toContain('fail');
    expect(provider.uploads).toEqual([]);
  });

  it('fails non-retryable on SQL errors', async () => {
    const client = new FakeSourceClient(rows, fields);
    client.streamError = Object.assign(
      new Error('permission denied for table accounts'),
      { code: '42501' },
    );
    const { runner, controlPlane } = setup({ client });
    const outcome = await runner.run(makeJob());
    expect(outcome).toMatchObject({ status: 'FAILED', retryable: false });
    const fail = controlPlane.last('fail')!.body;
    expect(fail).toMatchObject({
      errorMessage: 'permission denied for table accounts',
      retryable: false,
    });
    expect(fail.logs).toMatch(/Job failed/);
    expect(controlPlane.ops()).not.toContain('complete');
    expect(client.ended).toBe(true);
  });

  it('fails retryable on transient upload errors', async () => {
    const { runner, controlPlane, provider } = setup();
    provider.uploadError = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
    });
    expect(await runner.run(makeJob())).toMatchObject({
      status: 'FAILED',
      retryable: true,
    });
    expect(controlPlane.last('fail')!.body.retryable).toBe(true);
    expect(fs.readdirSync(workDir)).toEqual([]);
  });

  it('fails non-retryable for an unknown destination type without touching the database', async () => {
    const { runner, controlPlane, connect } = setup();
    await runner.run(makeJob({ destination: { type: 'SNOWFLAKE' as any } }));
    expect(controlPlane.last('fail')!.body).toMatchObject({
      retryable: false,
      errorMessage: expect.stringMatching(/SNOWFLAKE.*not supported/),
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('fails non-retryable for invalid destination config, bad SQL or bad format', async () => {
    const a = setup();
    a.provider.validateProblems = ['host is required'];
    await a.runner.run(makeJob());
    expect(a.controlPlane.last('fail')!.body).toMatchObject({
      retryable: false,
      errorMessage: expect.stringMatching(/host is required/),
    });

    const b = setup();
    await b.runner.run(
      makeJob({ dataset: { sqlTemplate: 'DELETE FROM accounts' } }),
    );
    expect(b.controlPlane.last('fail')!.body.retryable).toBe(false);

    const c = setup();
    await c.runner.run(
      makeJob({ profile: { fileFormat: 'CSV', compression: 'SNAPPY' } }),
    );
    expect(c.controlPlane.last('fail')!.body.errorMessage).toMatch(/SNAPPY/);
  });

  it('refuses to export when the session is not read-only', async () => {
    const client = new FakeSourceClient(rows, fields);
    const controlPlane = new FakeControlPlane();
    const runner = new JobRunner({
      controlPlane,
      source: {
        connect: async () => {
          client.readOnly = 'off';
          await applyGuardrails(client);
          return client;
        },
      },
      providers: new ProviderRegistry([new FakeProvider()]),
      logger: silentLogger,
      workDir,
      agentName: 'a',
      agentVersion: '0',
      clusterName: 'c',
    });
    await runner.run(makeJob());
    expect(controlPlane.last('fail')!.body).toMatchObject({
      retryable: false,
      errorMessage: expect.stringMatching(/not read-only/),
    });
    expect(client.statements.map(s => s.text)).not.toContain(
      'SELECT id, name FROM accounts',
    );
  });

  it('reports a shutdown abort as retryable', async () => {
    const { runner, controlPlane } = setup();
    const abort = new AbortController();
    abort.abort();
    expect(await runner.run(makeJob(), abort.signal)).toMatchObject({
      status: 'FAILED',
      retryable: true,
    });
    expect(controlPlane.last('fail')!.body.errorMessage).toMatch(
      /shutting down/,
    );
  });

  it('treats retention failures as non-fatal', async () => {
    const { runner, controlPlane, provider } = setup();
    provider.applyRetention = async () => {
      throw new Error('boom');
    };
    expect(
      await runner.run(makeJob({ profile: { retentionDays: 7 } })),
    ).toMatchObject({ status: 'COMPLETED' });
    expect(controlPlane.ops()).toEqual(['progress', 'progress', 'complete']);
  });
});
