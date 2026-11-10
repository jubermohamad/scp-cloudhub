/**
 * Connections to the cluster's PostgreSQL read replica.
 *
 * Authentication is an Entra access token for the managed identity, used as
 * the password. pg calls the password function on every new connection, so a
 * fresh (or cached-but-valid) token is used each time and nothing is stored.
 *
 * Every connection runs the guardrails before any dataset query and refuses to
 * continue unless the session reports `transaction_read_only = on`.
 */
import fs from 'fs';
import type { ConnectionOptions } from 'tls';
import { Client, ClientConfig } from 'pg';
import QueryStream from 'pg-query-stream';
import { NonRetryableError } from '../errors';
import type { PgConfig } from '../config';
import { POSTGRES_AAD_SCOPE, TokenProvider } from '../auth';

/** Statements run, in order, on every source connection before anything else. */
export const GUARDRAIL_STATEMENTS = [
  'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;',
  "SET statement_timeout='7200s';",
] as const;

/** Enforces that agent never connects to writer or primary PostgreSQL endpoints. */
export function validateReadOnlyHost(host: string): void {
  const lowered = host.toLowerCase();
  if (
    lowered.includes('postgres-rw') ||
    lowered.includes('-rw.') ||
    lowered.includes('.rw.') ||
    lowered.includes('-writer') ||
    lowered.includes('.writer') ||
    lowered.includes('primary') ||
    lowered.includes('master')
  ) {
    throw new NonRetryableError(
      `Forbidden: Agent is strictly prohibited from connecting to writer/primary endpoints (${host}). Only read-only/reporting replicas (e.g. postgres-ro) are permitted.`,
    );
  }
}

/** The subset of pg.Client the agent uses, so tests can pass a fake. */
export interface SourceClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  query<T extends QueryStream>(stream: T): T;
  end(): Promise<void>;
  on?(event: 'error', listener: (err: Error) => void): unknown;
}

export type SourceClientFactory = (config: ClientConfig) => SourceClient;

/** Maps libpq-style PGSSLMODE to node-postgres TLS options. */
export function sslOptions(
  config: Pick<PgConfig, 'sslMode' | 'sslRootCertPath'>,
  readFile: (p: string) => string = p => fs.readFileSync(p, 'utf8'),
): false | ConnectionOptions {
  const ca = config.sslRootCertPath
    ? readFile(config.sslRootCertPath)
    : undefined;
  switch (config.sslMode) {
    case 'disable':
      return false;
    case 'require':
      // libpq semantics: encrypted, server certificate not verified.
      return { rejectUnauthorized: false };
    case 'verify-ca':
      return {
        rejectUnauthorized: true,
        ca,
        checkServerIdentity: () => undefined,
      };
    case 'verify-full':
    default:
      return { rejectUnauthorized: true, ca };
  }
}

/** Runs the guardrail statements and verifies the session is read-only. */
export async function applyGuardrails(client: SourceClient): Promise<void> {
  for (const statement of GUARDRAIL_STATEMENTS) {
    await client.query(statement);
  }
  const res = await client.query('SHOW transaction_read_only');
  const value = res.rows?.[0]?.transaction_read_only;
  if (value !== 'on') {
    throw new NonRetryableError(
      `Refusing to run: source session is not read-only (transaction_read_only=${String(
        value,
      )})`,
    );
  }
}

export interface SourceConnectorOptions {
  pg: PgConfig;
  tokens: TokenProvider;
  /** Overrides the scope (tests use a fake provider that returns a password). */
  tokenScope?: string;
  clientFactory?: SourceClientFactory;
  applicationName?: string;
}

/** Opens guardrailed connections to the source database. */
export class SourceConnector {
  constructor(private readonly options: SourceConnectorOptions) {}

  /** Connects and applies the guardrails. The caller must `end()` the client. */
  async connect(): Promise<SourceClient> {
    const { pg, tokens } = this.options;
    validateReadOnlyHost(pg.host);
    const scope = this.options.tokenScope ?? POSTGRES_AAD_SCOPE;
    const config: ClientConfig = {
      host: pg.host,
      port: pg.port,
      database: pg.database,
      user: pg.user,
      password: () => tokens.getToken(scope),
      ssl: sslOptions(pg),
      application_name: this.options.applicationName ?? 'data-export-agent',
      connectionTimeoutMillis: 30_000,
      keepAlive: true,
    };
    const factory =
      this.options.clientFactory ??
      (c => new Client(c) as unknown as SourceClient);
    const client = factory(config);
    // An idle-connection error must not crash the process; the next query fails instead.
    client.on?.('error', () => {});
    await client.connect();
    try {
      await applyGuardrails(client);
    } catch (err) {
      await client.end().catch(() => {});
      throw err;
    }
    return client;
  }
}

export interface FieldInfo {
  name: string;
  dataTypeID: number;
}

/**
 * Starts a streaming query. Rows arrive in batches through a server-side
 * cursor; nothing is buffered beyond the stream's high-water mark.
 */
export function streamQuery(
  client: SourceClient,
  text: string,
  values: unknown[],
  batchSize = 1000,
): QueryStream {
  return client.query(
    new QueryStream(text, values, { batchSize, highWaterMark: batchSize }),
  );
}

/** Field metadata of a running stream (available once the RowDescription arrived). */
export function streamFields(stream: QueryStream): FieldInfo[] | undefined {
  const fields = (
    stream as unknown as { cursor?: { _result?: { fields?: FieldInfo[] } } }
  ).cursor?._result?.fields;
  if (!fields || fields.length === 0) return undefined;
  return fields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID }));
}
