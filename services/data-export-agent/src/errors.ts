/**
 * Error types and the retry classification shared by the control plane client
 * and the job runner.
 *
 * The control plane re-queues a failed job only when the agent says the failure
 * was transient, so the classification here decides whether a broken export is
 * retried automatically (network blip, replica restart) or surfaced to a human
 * straight away (bad SQL, missing grant, wrong destination config).
 */

/** A failure the agent knows the class of. */
export class AgentError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AgentError';
    this.retryable = retryable;
  }
}

/** Configuration, validation or SQL problems that another attempt cannot fix. */
export class NonRetryableError extends AgentError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, false, options);
    this.name = 'NonRetryableError';
  }
}

/** Transient infrastructure problems that another attempt may well get past. */
export class RetryableError extends AgentError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, true, options);
    this.name = 'RetryableError';
  }
}

/**
 * The control plane answered `continue: false`: the job was cancelled or
 * reassigned. The runner discards output and reports nothing further.
 */
export class JobCancelledError extends Error {
  constructor(message = 'Job cancelled by the control plane') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

/** A non-2xx answer from the control plane. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, message?: string) {
    super(message ?? `HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** Node / libuv socket error codes that indicate a transient network problem. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTDOWN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'REQUEST_SEND_ERROR',
]);

/**
 * PostgreSQL SQLSTATE classes / codes that are worth another attempt. Everything
 * else coming from the server (42xxx syntax and permission errors, 22xxx data
 * errors, 25006 read-only violations, 28xxx authentication) is non-retryable.
 */
const TRANSIENT_SQLSTATE_CLASSES = ['08', '53', '57P', '58'];
const TRANSIENT_SQLSTATE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled (statement_timeout)
  '57P01', // admin_shutdown (replica restart / failover)
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '72000', // snapshot_too_old
]);
const SQLSTATE = /^[0-9A-Z]{5}$/;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** True for HTTP statuses that a retry can reasonably fix. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Decides whether an error is transient. Walks the `cause` chain so wrapped SDK
 * errors are classified by their root cause. Unknown errors are treated as
 * non-retryable unless their message clearly says "timeout": retrying a bug in
 * a loop only hides it.
 */
export function isRetryable(err: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (err instanceof AgentError) return err.retryable;
  if (err instanceof JobCancelledError) return false;
  if (err instanceof HttpError) return isRetryableStatus(err.status);

  const rec = asRecord(err);
  if (!rec) return false;

  const name = typeof rec.name === 'string' ? rec.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;

  const code = typeof rec.code === 'string' ? rec.code : undefined;
  if (code) {
    if (TRANSIENT_NETWORK_CODES.has(code)) return true;
    if (SQLSTATE.test(code)) {
      return (
        TRANSIENT_SQLSTATE_CODES.has(code) ||
        TRANSIENT_SQLSTATE_CLASSES.some(prefix => code.startsWith(prefix))
      );
    }
  }

  // Azure SDK RestError and friends carry statusCode.
  const statusCode =
    typeof rec.statusCode === 'number'
      ? rec.statusCode
      : typeof rec.status === 'number'
      ? rec.status
      : undefined;
  if (statusCode !== undefined) return isRetryableStatus(statusCode);

  // ssh2 tags socket-level failures with level 'client-socket' / 'client-timeout'.
  if (rec.level === 'client-socket' || rec.level === 'client-timeout') {
    return true;
  }

  if (rec.cause !== undefined && isRetryable(rec.cause, depth + 1)) return true;

  const message = typeof rec.message === 'string' ? rec.message : '';
  return /\b(timed? ?out|timeout|ECONNRESET|socket hang up|throttl)/i.test(
    message,
  );
}

/** Message text safe to send to the control plane. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
