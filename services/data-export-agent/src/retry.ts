/**
 * Exponential backoff with full jitter. Seventy agents restarting together
 * after a control plane outage must not retry in lockstep, hence the jitter.
 */
import { isRetryable } from './errors';

export interface RetryOptions {
  /** Total attempts including the first one. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Decides whether a failure is worth another attempt. */
  shouldRetry?: (err: unknown) => boolean;
  /** Called before each wait; useful for logging. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  signal?: AbortSignal;
}

export const DEFAULT_RETRY: Pick<
  RetryOptions,
  'attempts' | 'baseDelayMs' | 'maxDelayMs'
> = {
  attempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/** Delay before retry number `attempt` (1-based): uniform in [0, min(max, base * 2^(attempt-1))]. */
export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(
    maxDelayMs,
    baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  return Math.floor(random() * ceiling);
}

/** Sleeps for `ms`, resolving early (without error) when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let timer: NodeJS.Timeout | undefined = undefined;
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runs `fn` until it succeeds, a non-retryable error occurs, or attempts run out. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const shouldRetry = options.shouldRetry ?? isRetryable;
  const wait = options.sleep ?? sleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (
        attempt === options.attempts ||
        !shouldRetry(err) ||
        options.signal?.aborted
      ) {
        throw err;
      }
      const delay = backoffDelay(
        attempt,
        options.baseDelayMs,
        options.maxDelayMs,
        options.random,
      );
      options.onRetry?.(err, attempt, delay);
      await wait(delay, options.signal);
    }
  }
  throw lastError;
}

/**
 * Resolves with `promise`, or with `onTimeout()` after `ms`. The timer is
 * cleared either way so a pending race never keeps the process alive.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
