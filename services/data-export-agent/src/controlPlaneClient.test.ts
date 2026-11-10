import { ControlPlaneClient } from './controlPlaneClient';
import { HttpError } from './errors';
import { silentLogger } from './logger';

function response(status: number, body?: unknown) {
  return new Response(
    status === 204 ? null : body === undefined ? '' : JSON.stringify(body),
    { status },
  );
}

function client(fetchImpl: jest.Mock, getToken = jest.fn(async () => 'tok')) {
  return new ControlPlaneClient({
    baseUrl: 'https://cloudhub.example.com/',
    scope: 'api://cloudhub-data-export/.default',
    tokens: { getToken },
    logger: silentLogger,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    retry: { attempts: 4, baseDelayMs: 1, maxDelayMs: 2 },
  });
}

describe('ControlPlaneClient', () => {
  it('posts JSON with a bearer token for the configured scope', async () => {
    const fetchImpl = jest.fn(async () => response(200, { continue: true }));
    const getToken = jest.fn(async () => 'tok');
    const res = await client(fetchImpl, getToken).progress('job/1', {
      status: 'RUNNING',
      rowsExported: 3,
    });
    expect(res).toEqual({ continue: true });
    expect(getToken).toHaveBeenCalledWith('api://cloudhub-data-export/.default');
    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(url).toBe(
      'https://cloudhub.example.com/api/data-export/agent/jobs/job%2F1/progress',
    );
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({
      status: 'RUNNING',
      rowsExported: 3,
    });
    expect(init.signal).toBeDefined();
  });

  it('returns null from claim on 204 and the job on 200', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(200, { job: { jobId: 'j1' } }));
    const c = client(fetchImpl);
    expect(await c.claim()).toBeNull();
    expect(await c.claim()).toEqual({ jobId: 'j1' });
  });

  it('reads continue:false', async () => {
    const fetchImpl = jest.fn(async () => response(200, { continue: false }));
    expect(
      await client(fetchImpl).progress('j', { status: 'UPLOADING' }),
    ).toEqual({ continue: false });
  });

  it('retries 5xx, 429 and network errors', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(503, { error: 'down' }))
      .mockResolvedValueOnce(response(429))
      .mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNRESET' },
        }),
      )
      .mockResolvedValueOnce(response(200, { willRetry: true }));
    expect(
      await client(fetchImpl).fail('j', { errorMessage: 'x', retryable: true }),
    ).toEqual({ willRetry: true });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not retry 4xx', async () => {
    const fetchImpl = jest.fn(async () =>
      response(403, { error: 'unknown agent' }),
    );
    await expect(client(fetchImpl).claim()).rejects.toBeInstanceOf(HttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
