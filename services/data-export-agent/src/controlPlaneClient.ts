/**
 * HTTP client for the agent endpoints of the control plane (see protocol.ts).
 * Each call gets a fresh bearer token from the token provider, a timeout, and
 * retries with backoff on network errors and 5xx/429 answers.
 */
import { HttpError } from './errors';
import type { Logger } from './logger';
import type {
  ClaimResponse,
  CompleteRequest,
  FailRequest,
  FailResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  JobSpec,
  ProgressRequest,
  ProgressResponse,
} from './protocol';
import { DEFAULT_RETRY, RetryOptions, withRetry } from './retry';
import type { TokenProvider } from './auth';

export const AGENT_API_PATH = '/api/data-export/agent';

/** The control plane operations the runner and the agent loop depend on. */
export interface ControlPlane {
  heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse>;
  /** Resolves to null when no job is waiting (HTTP 204). */
  claim(): Promise<JobSpec | null>;
  progress(jobId: string, body: ProgressRequest): Promise<ProgressResponse>;
  complete(jobId: string, body: CompleteRequest): Promise<void>;
  fail(jobId: string, body: FailRequest): Promise<FailResponse>;
}

export interface ControlPlaneClientOptions {
  baseUrl: string;
  scope: string;
  tokens: TokenProvider;
  logger: Logger;
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export class ControlPlaneClient implements ControlPlane {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly retry: RetryOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ControlPlaneClientOptions) {
    this.base = `${options.baseUrl.replace(/\/+$/, '')}${AGENT_API_PATH}`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse> {
    return this.post<HeartbeatResponse>(
      '/heartbeat',
      body,
    ) as Promise<HeartbeatResponse>;
  }

  async claim(): Promise<JobSpec | null> {
    const res = await this.post<ClaimResponse>('/jobs/claim', {});
    return res?.job ?? null;
  }

  async progress(
    jobId: string,
    body: ProgressRequest,
  ): Promise<ProgressResponse> {
    const res = await this.post<ProgressResponse>(
      `/jobs/${encodeURIComponent(jobId)}/progress`,
      body,
    );
    return { continue: res?.continue !== false };
  }

  async complete(jobId: string, body: CompleteRequest): Promise<void> {
    await this.post(`/jobs/${encodeURIComponent(jobId)}/complete`, body);
  }

  async fail(jobId: string, body: FailRequest): Promise<FailResponse> {
    const res = await this.post<FailResponse>(
      `/jobs/${encodeURIComponent(jobId)}/fail`,
      body,
    );
    return { willRetry: res?.willRetry === true };
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    const url = `${this.base}${path}`;
    const payload = JSON.stringify(body);
    return withRetry(
      async () => {
        const token = await this.options.tokens.getToken(this.options.scope);
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': this.options.userAgent ?? 'data-export-agent',
          },
          body: payload,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status === 204) return null;
        const text = await res.text();
        if (!res.ok)
          throw new HttpError(
            res.status,
            text,
            `POST ${path} failed with HTTP ${res.status}: ${text.slice(
              0,
              300,
            )}`,
          );
        if (!text) return null;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new HttpError(
            res.status,
            text,
            `POST ${path} returned invalid JSON`,
          );
        }
      },
      {
        ...this.retry,
        onRetry: (err, attempt, delayMs) =>
          this.options.logger.warn('Control plane call failed, retrying', {
            path,
            attempt,
            delayMs,
            error: err,
          }),
      },
    );
  }
}
