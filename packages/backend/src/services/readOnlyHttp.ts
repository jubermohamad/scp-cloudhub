/**
 * Read-only HTTP access to GitHub, Terraform Cloud and Azure Resource Manager
 * for AKS execution tracking and submission preflight.
 *
 * This is the only transport those features use, and it cannot write:
 *  - `get()` always sends GET.
 *  - `readQuery()` sends POST only to endpoints registered as query-only at
 *    construction (GitHub GraphQL, Azure Resource Graph) and validates the
 *    body: GraphQL documents must be a single `query` operation (no mutation
 *    or subscription); Resource Graph bodies may carry only a KQL query and
 *    its scope/options.
 * There is no way to issue PUT, PATCH or DELETE, or a POST anywhere else.
 */

export type ExternalService = 'github' | 'terraform-cloud' | 'azure';

export type ExternalErrorKind =
  | 'not_configured'
  | 'timeout'
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'http'
  | 'invalid_response';

export class ExternalServiceError extends Error {
  readonly service: ExternalService;
  readonly kind: ExternalErrorKind;
  readonly status?: number;

  constructor(
    service: ExternalService,
    kind: ExternalErrorKind,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'ExternalServiceError';
    this.service = service;
    this.kind = kind;
    this.status = status;
  }
}

/** Raised (and never sent) when code attempts a non-read request. */
export class ReadOnlyViolationError extends Error {
  constructor(detail: string) {
    super(`Read-only client refused a write-capable request: ${detail}`);
    this.name = 'ReadOnlyViolationError';
  }
}

export interface FetchResponseLike {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export type QueryKind = 'graphql' | 'resource-graph';

export interface ReadOnlyHttpOptions {
  service: ExternalService;
  /** Origin + optional path prefix, e.g. https://app.terraform.io/api/v2 */
  baseUrl: string;
  /** Resolved per request so short-lived tokens can be refreshed. */
  headers:
    | Record<string, string>
    | (() => Promise<Record<string, string>> | Record<string, string>);
  /** Paths (relative to baseUrl, query string included) that accept read queries. */
  queryEndpoints?: Partial<Record<string, QueryKind>>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const RESOURCE_GRAPH_BODY_KEYS = new Set([
  'query',
  'subscriptions',
  'managementGroups',
  'options',
]);

/** Validate a GraphQL document: exactly one operation, and it is a query. */
export function assertGraphqlQueryOnly(body: Record<string, unknown>): void {
  const query = body.query;
  if (typeof query !== 'string') {
    throw new ReadOnlyViolationError('GraphQL body has no query string');
  }
  const stripped = query.replace(/#[^\n]*/g, '').trim();
  if (!/^query\b/.test(stripped)) {
    throw new ReadOnlyViolationError(
      'GraphQL document must start with the `query` keyword',
    );
  }
  if (/\b(mutation|subscription)\b/i.test(stripped)) {
    throw new ReadOnlyViolationError(
      'GraphQL document contains a mutation or subscription',
    );
  }
  for (const key of Object.keys(body)) {
    if (key !== 'query' && key !== 'variables') {
      throw new ReadOnlyViolationError(`GraphQL body key '${key}' not allowed`);
    }
  }
}

export function assertResourceGraphQuery(body: Record<string, unknown>): void {
  if (typeof body.query !== 'string' || !body.query.trim()) {
    throw new ReadOnlyViolationError('Resource Graph body has no query');
  }
  for (const key of Object.keys(body)) {
    if (!RESOURCE_GRAPH_BODY_KEYS.has(key)) {
      throw new ReadOnlyViolationError(
        `Resource Graph body key '${key}' not allowed`,
      );
    }
  }
}

export class ReadOnlyHttpClient {
  readonly service: ExternalService;
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly headers: ReadOnlyHttpOptions['headers'];
  private readonly queryEndpoints: Partial<Record<string, QueryKind>>;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: ReadOnlyHttpOptions) {
    this.service = options.service;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.origin = new URL(this.baseUrl).origin;
    this.headers = options.headers;
    this.queryEndpoints = options.queryEndpoints ?? {};
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** GET a path relative to baseUrl (or an absolute URL on the same origin). */
  async get<T>(pathOrUrl: string): Promise<T> {
    return this.send<T>('GET', this.resolve(pathOrUrl));
  }

  /**
   * POST a read-only query to a registered query endpoint. The body is
   * validated before anything is sent.
   */
  async readQuery<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const kind = this.queryEndpoints[path];
    if (!kind) {
      throw new ReadOnlyViolationError(
        `POST to ${path} is not a registered read-query endpoint`,
      );
    }
    if (kind === 'graphql') assertGraphqlQueryOnly(body);
    else assertResourceGraphQuery(body);
    return this.send<T>('POST', this.resolve(path), JSON.stringify(body));
  }

  private resolve(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      if (new URL(pathOrUrl).origin !== this.origin) {
        throw new ReadOnlyViolationError(
          `URL ${pathOrUrl} is outside ${this.origin}`,
        );
      }
      return pathOrUrl;
    }
    if (!pathOrUrl.startsWith('/')) {
      throw new ReadOnlyViolationError(
        `Path must start with '/': ${pathOrUrl}`,
      );
    }
    return `${this.baseUrl}${pathOrUrl}`;
  }

  private async send<T>(
    method: 'GET' | 'POST',
    url: string,
    body?: string,
  ): Promise<T> {
    const headers = {
      ...(typeof this.headers === 'function'
        ? await this.headers()
        : this.headers),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: FetchResponseLike;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ExternalServiceError(
          this.service,
          'timeout',
          `${this.service} did not respond within ${this.timeoutMs} ms`,
        );
      }
      throw new ExternalServiceError(
        this.service,
        'unavailable',
        `${this.service} request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new ExternalServiceError(
        this.service,
        classifyStatus(response),
        `${this.service} responded ${response.status} for ${method} ${
          new URL(url).pathname
        }`,
        response.status,
      );
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ExternalServiceError(
        this.service,
        'invalid_response',
        `${this.service} returned a non-JSON response`,
        response.status,
      );
    }
  }
}

function classifyStatus(response: FetchResponseLike): ExternalErrorKind {
  const { status } = response;
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 403) {
    return response.headers.get('x-ratelimit-remaining') === '0'
      ? 'rate_limited'
      : 'forbidden';
  }
  if (status === 404) return 'not_found';
  if (status >= 500) return 'unavailable';
  return 'http';
}

/**
 * Base URL overrides exist only so non-production environments (local smoke
 * tests) can point the readers at a stub server. Production always talks to
 * the real services, so a misconfigured variable cannot redirect tokens.
 */
export function baseUrlFor(
  envVar: string,
  productionUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[envVar]?.trim();
  if (override && env.NODE_ENV !== 'production') return override;
  return productionUrl;
}
