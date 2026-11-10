import fs from 'fs';
import path from 'path';
import {
  ExternalServiceError,
  ReadOnlyHttpClient,
  ReadOnlyViolationError,
  baseUrlFor,
  type FetchLike,
} from '../services/readOnlyHttp';

function recordingFetch(status = 200, body: unknown = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, body: init.body });
    return {
      status,
      ok: status < 300,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  };
  return { fetch, calls };
}

function client(fetchImpl: FetchLike, timeoutMs?: number) {
  return new ReadOnlyHttpClient({
    service: 'github',
    baseUrl: 'https://api.github.com',
    headers: { Authorization: 'Bearer t' },
    queryEndpoints: { '/graphql': 'graphql' },
    fetchImpl,
    timeoutMs,
  });
}

describe('ReadOnlyHttpClient', () => {
  it('sends GET for reads and parses JSON', async () => {
    const { fetch, calls } = recordingFetch(200, { ok: 1 });
    await expect(client(fetch).get('/repos/a/b')).resolves.toEqual({ ok: 1 });
    expect(calls).toEqual([
      {
        method: 'GET',
        url: 'https://api.github.com/repos/a/b',
        body: undefined,
      },
    ]);
  });

  it.each([
    [
      'a mutation',
      {
        query: 'mutation { mergePullRequest(input: {}) { clientMutationId } }',
      },
    ],
    ['a mutation after a query', { query: 'query { a } mutation { b }' }],
    ['a subscription', { query: 'subscription { x }' }],
    ['an anonymous shorthand', { query: '{ viewer { login } }' }],
    ['an extra body key', { query: 'query { a }', operationName: 'x' }],
    ['no query', { variables: {} }],
  ])('refuses GraphQL %s without sending it', async (_label, body) => {
    const { fetch, calls } = recordingFetch();
    await expect(
      client(fetch).readQuery('/graphql', body),
    ).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(calls).toHaveLength(0);
  });

  it('refuses POST to any endpoint not registered as a read query', async () => {
    const { fetch, calls } = recordingFetch();
    await expect(
      client(fetch).readQuery('/repos/a/b/pulls/1/merge', {
        query: 'query { a }',
      }),
    ).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(calls).toHaveLength(0);
  });

  it('refuses absolute URLs on another origin (token exfiltration)', async () => {
    const { fetch, calls } = recordingFetch();
    await expect(
      client(fetch).get('https://evil.example/x'),
    ).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(calls).toHaveLength(0);
  });

  it('validates Resource Graph bodies', async () => {
    const { fetch, calls } = recordingFetch(200, { data: [] });
    const arm = new ReadOnlyHttpClient({
      service: 'azure',
      baseUrl: 'https://management.azure.com',
      headers: () => ({}),
      queryEndpoints: { '/rg': 'resource-graph' },
      fetchImpl: fetch,
    });
    await arm.readQuery('/rg', { query: 'Resources | take 1', options: {} });
    await expect(
      arm.readQuery('/rg', { query: 'x', properties: {} }),
    ).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(calls).toHaveLength(1);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [502, 'unavailable'],
    [422, 'http'],
  ])('classifies HTTP %s as %s', async (status, kind) => {
    const { fetch } = recordingFetch(status);
    await expect(client(fetch).get('/x')).rejects.toMatchObject({
      service: 'github',
      kind,
      status,
    });
  });

  it('turns a hung request into a timeout error', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      );
    const error = (await client(hang, 15)
      .get('/x')
      .catch(e => e)) as ExternalServiceError;
    expect(error).toBeInstanceOf(ExternalServiceError);
    expect(error.kind).toBe('timeout');
  });

  it('ignores base URL overrides in production', () => {
    expect(
      baseUrlFor('X_URL', 'https://real', {
        X_URL: 'http://stub',
        NODE_ENV: 'production',
      }),
    ).toBe('https://real');
    expect(
      baseUrlFor('X_URL', 'https://real', {
        X_URL: 'http://stub',
        NODE_ENV: 'development',
      }),
    ).toBe('http://stub');
  });

  it('is the only transport of the tracking and gate modules, and sends no other method', () => {
    const dir = path.resolve(__dirname, '../services');
    const files = [
      'readOnlyHttp.ts',
      'aksExternalReaders.ts',
      'AksExecutionTracker.ts',
      'aksExecutionStatus.ts',
      'aksSubmissionGates.ts',
      'aksReadOnlyIntegrations.ts',
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      // No Octokit, no write client, no other HTTP library.
      expect(source).not.toMatch(
        /@octokit|InfrastructureProvisioningService|JumpboxAccessProvisioningService|terraformCloudService|axios|node-fetch/,
      );
      // No HTTP method other than GET / POST-for-queries anywhere.
      expect(source).not.toMatch(/['"](PUT|PATCH|DELETE)['"]/);
    }
    // Only the transport itself calls fetch or chooses a method.
    for (const file of files.filter(f => f !== 'readOnlyHttp.ts')) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      expect(source).not.toMatch(/fetch\(|method:/);
    }
  });
});
