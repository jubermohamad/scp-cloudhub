import {
  HttpError,
  JobCancelledError,
  NonRetryableError,
  RetryableError,
  isRetryable,
} from './errors';
import { backoffDelay, withRetry } from './retry';

function withCode(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

describe('isRetryable', () => {
  it.each([
    ['ECONNRESET', withCode('ECONNRESET')],
    ['ETIMEDOUT', withCode('ETIMEDOUT')],
    ['EAI_AGAIN', withCode('EAI_AGAIN')],
    [
      'fetch failed with cause',
      Object.assign(new TypeError('fetch failed'), {
        cause: withCode('ECONNREFUSED'),
      }),
    ],
    ['HTTP 503', new HttpError(503, 'unavailable')],
    ['HTTP 429', new HttpError(429, 'slow down')],
    ['Azure RestError 500', Object.assign(new Error('x'), { statusCode: 500 })],
    ['statement timeout 57014', withCode('57014')],
    ['replica restart 57P01', withCode('57P01')],
    ['connection exception 08006', withCode('08006')],
    ['serialization failure', withCode('40001')],
    ['TimeoutError', Object.assign(new Error('t'), { name: 'TimeoutError' })],
    [
      'ssh socket',
      Object.assign(new Error('socket'), { level: 'client-socket' }),
    ],
    ['timeout message', new Error('Timed out while waiting for handshake')],
    ['RetryableError', new RetryableError('x')],
  ])('%s is retryable', (_name, err) => {
    expect(isRetryable(err)).toBe(true);
  });

  it.each([
    ['syntax error 42601', withCode('42601')],
    ['permission denied 42501', withCode('42501')],
    ['undefined table 42P01', withCode('42P01')],
    ['read-only violation 25006', withCode('25006')],
    ['auth failed 28P01', withCode('28P01')],
    ['HTTP 400', new HttpError(400, 'bad')],
    ['HTTP 403', new HttpError(403, 'forbidden')],
    ['Azure 404', Object.assign(new Error('x'), { statusCode: 404 })],
    ['NonRetryableError', new NonRetryableError('bad config')],
    ['cancelled', new JobCancelledError()],
    ['unknown error', new Error('something odd')],
    ['non-error', 'string'],
  ])('%s is not retryable', (_name, err) => {
    expect(isRetryable(err)).toBe(false);
  });
});

describe('withRetry', () => {
  it('retries transient failures with backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce(withCode('ECONNRESET'))
      .mockRejectedValueOnce(new HttpError(502, 'bad gateway'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, {
      attempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      random: () => 1,
      sleep: async ms => {
        sleeps.push(ms);
      },
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('does not retry permanent failures', async () => {
    const fn = jest.fn().mockRejectedValue(new HttpError(400, 'bad'));
    await expect(
      withRetry(fn, {
        attempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 1,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new HttpError(503, 'down'));
    await expect(
      withRetry(fn, {
        attempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
        sleep: async () => {},
      }),
    ).rejects.toThrow('HTTP 503');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('caps and jitters the delay', () => {
    expect(backoffDelay(10, 500, 30_000, () => 0.999)).toBeLessThan(30_000);
    expect(backoffDelay(1, 500, 30_000, () => 0)).toBe(0);
    expect(backoffDelay(3, 500, 30_000, () => 0.5)).toBe(1000);
  });
});
