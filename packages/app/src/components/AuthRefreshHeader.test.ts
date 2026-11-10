import { MicrosoftAuth } from '@backstage/core-app-api';
import { ConfigReader } from '@backstage/config';

describe('MicrosoftAuth client refresh headers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends X-Requested-With: XMLHttpRequest and credentials: include on session refresh', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        providerInfo: {
          accessToken: 'mock-access-token',
          expiresInSeconds: 3600,
          scope: 'openid profile email User.Read',
        },
        backstageIdentity: {
          token: 'mock-backstage-token',
          expiresInSeconds: 3600,
          identity: {
            type: 'user',
            userEntityRef: 'user:default/test.user',
            ownershipEntityRefs: ['user:default/test.user'],
          },
        },
      }),
    });

    global.fetch = fetchMock as any;

    const configApi = new ConfigReader({
      app: { baseUrl: 'https://cloudhub.symphonyai.cloud' },
      backend: { baseUrl: 'https://cloudhub.symphonyai.cloud' },
    });

    const discoveryApi = {
      getBaseUrl: jest.fn().mockResolvedValue('https://cloudhub.symphonyai.cloud/api/auth'),
    };

    const oauthRequestApi = {
      createAuthRequester: jest.fn().mockReturnValue(jest.fn()),
      authRequest$: jest.fn() as any,
    };

    const microsoftAuth = MicrosoftAuth.create({
      configApi,
      discoveryApi,
      oauthRequestApi,
      environment: 'production',
    });

    const identity = await microsoftAuth.getBackstageIdentity({ optional: true });

    expect(identity).toBeDefined();
    expect(identity?.token).toBe('mock-backstage-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];

    expect(calledUrl).toContain('https://cloudhub.symphonyai.cloud/api/auth/microsoft/refresh');
    expect(calledInit).toMatchObject({
      credentials: 'include',
      headers: {
        'x-requested-with': 'XMLHttpRequest',
      },
    });
  });
});
