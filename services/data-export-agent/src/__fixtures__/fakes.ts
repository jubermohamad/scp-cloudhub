/**
 * Test doubles shared by the unit tests. Excluded from the build.
 */
import { Readable } from 'stream';
import type { ControlPlane } from '../controlPlaneClient';
import type {
  CompleteRequest,
  DeliveredFile,
  FailRequest,
  HeartbeatRequest,
  HeartbeatResponse,
  JobSpec,
  ProgressRequest,
} from '../protocol';
import type { SourceClient, FieldInfo } from '../sql/source';
import type {
  DestinationProvider,
  HealthCheckResult,
  UploadContext,
} from '../providers/types';
import type { WrittenFile } from '../writers/types';
import fs from 'fs';

export function makeJob(
  overrides: {
    profile?: Partial<JobSpec['profile']>;
    dataset?: Partial<JobSpec['dataset']>;
    watermark?: JobSpec['watermark'];
    destination?: Partial<JobSpec['destination']>;
    packageReports?: JobSpec['packageReports'];
    jobId?: string;
    attempt?: number;
  } = {},
): JobSpec {
  return {
    jobId: overrides.jobId ?? 'job-1',
    attempt: overrides.attempt ?? 1,
    tenantId: 'tenant-a',
    scheduledTime: '2026-10-20T00:00:00.000Z',
    profile: {
      id: 'profile-1',
      name: 'Nightly',
      exportMode: 'FULL',
      fileFormat: 'CSV',
      compression: 'NONE',
      retentionDays: null,
      watermarkStrategy: null,
      namespace: null,
      ...overrides.profile,
    },
    dataset: {
      id: 'ds-uuid',
      datasetId: 'accounts',
      sqlTemplate: 'SELECT id, name FROM accounts',
      watermarkColumn: null,
      primaryKeys: ['id'],
      ...overrides.dataset,
    },
    watermark: overrides.watermark ?? { lastSuccessValue: null },
    packageReports: overrides.packageReports,
    destination: {
      id: 'dest-1',
      type: 'SFTP',
      configuration: {},
      ...overrides.destination,
    },
    outputPrefix: 'tenant/tenant-a/exports/nightly/2026/10/20/job-1',
    profilePrefix: 'tenant/tenant-a/exports/nightly',
  };
}

type Call =
  | { op: 'heartbeat'; body: HeartbeatRequest }
  | { op: 'claim' }
  | { op: 'progress'; jobId: string; body: ProgressRequest }
  | { op: 'complete'; jobId: string; body: CompleteRequest }
  | { op: 'fail'; jobId: string; body: FailRequest };

/** In-memory control plane recording every call. */
export class FakeControlPlane implements ControlPlane {
  calls: Call[] = [];
  jobs: JobSpec[] = [];
  /** Answer for the Nth progress call (0-based); default continue:true. */
  progressAnswers: boolean[] = [];
  heartbeatResponse: HeartbeatResponse = {
    agentId: 'agent-1',
    clusterId: 'cluster-1',
    clusterName: 'aks-test',
    tenantId: 'tenant-a',
    heartbeatIntervalSeconds: 60,
    pollIntervalSeconds: 15,
    destinationsToCheck: [],
  };
  failHeartbeat?: Error;

  async heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse> {
    this.calls.push({ op: 'heartbeat', body });
    if (this.failHeartbeat) throw this.failHeartbeat;
    return this.heartbeatResponse;
  }
  async claim(): Promise<JobSpec | null> {
    this.calls.push({ op: 'claim' });
    return this.jobs.shift() ?? null;
  }
  async progress(jobId: string, body: ProgressRequest) {
    const index = this.calls.filter(c => c.op === 'progress').length;
    this.calls.push({ op: 'progress', jobId, body });
    return { continue: this.progressAnswers[index] ?? true };
  }
  async complete(jobId: string, body: CompleteRequest) {
    this.calls.push({ op: 'complete', jobId, body });
  }
  async fail(jobId: string, body: FailRequest) {
    this.calls.push({ op: 'fail', jobId, body });
    return { willRetry: body.retryable };
  }
  ops(): string[] {
    return this.calls.map(c => c.op);
  }
  last<T extends Call['op']>(op: T): Extract<Call, { op: T }> | undefined {
    return [...this.calls].reverse().find(c => c.op === op) as
      | Extract<Call, { op: T }>
      | undefined;
  }
}

/** Provider that copies uploaded files into memory. */
export class FakeProvider implements DestinationProvider {
  readonly type: string;
  uploads: Array<{ name: string; content: Buffer; outputPrefix: string }> = [];
  retentionCalls: Array<{ prefix: string; days: number }> = [];
  uploadError?: Error;
  validateProblems: string[] = [];
  health: HealthCheckResult = { status: 'HEALTHY', message: 'ok' };

  constructor(type = 'SFTP') {
    this.type = type;
  }
  validate(): string[] {
    return this.validateProblems;
  }
  async upload(
    files: WrittenFile[],
    ctx: UploadContext,
  ): Promise<DeliveredFile[]> {
    if (this.uploadError) throw this.uploadError;
    return files.map(f => {
      this.uploads.push({
        name: f.name,
        content: fs.readFileSync(f.localPath),
        outputPrefix: ctx.outputPrefix,
      });
      return {
        name: f.name,
        path: `/out/${ctx.outputPrefix}/${f.name}`,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256,
        ...(f.records !== undefined ? { records: f.records } : {}),
      };
    });
  }
  async healthCheck(): Promise<HealthCheckResult> {
    return this.health;
  }
  async applyRetention(prefix: string, days: number): Promise<number> {
    this.retentionCalls.push({ prefix, days });
    return 2;
  }
}

/**
 * Fake pg client. Plain `query(text)` calls are recorded and answered from
 * `answers`; `query(QueryStream)` returns a readable of `rows` carrying the
 * field metadata the way pg-query-stream exposes it.
 */
export class FakeSourceClient implements SourceClient {
  statements: Array<{ text: string; values?: unknown[] }> = [];
  ended = false;
  readOnly = 'on';
  streamError?: Error;

  constructor(
    private readonly rows: Record<string, unknown>[] = [],
    private readonly fields: FieldInfo[] = [],
  ) {}

  async connect(): Promise<void> {}

  query(arg: any, values?: unknown[]): any {
    if (typeof arg === 'string') {
      this.statements.push({ text: arg, values });
      if (/^SHOW transaction_read_only/i.test(arg)) {
        return Promise.resolve({
          rows: [{ transaction_read_only: this.readOnly }],
        });
      }
      return Promise.resolve({ rows: [] });
    }
    this.statements.push({
      text: arg.cursor?.text ?? '<stream>',
      values: arg.cursor?.values,
    });
    const error = this.streamError;
    const rows = this.rows;
    const stream = Readable.from(
      (async function* gen() {
        for (const row of rows) yield row;
        if (error) throw error;
      })(),
      { objectMode: true },
    );
    (stream as any).cursor = { _result: { fields: this.fields } };
    return stream;
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}
