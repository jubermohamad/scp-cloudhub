import {
  CLOUDHUB_LOGIN_ALLOW_GROUP_ID,
  CLOUDHUB_PLATFORM_OWNERS_GROUP_ID,
  CLOUDHUB_DATA_EXPORT_GROUP_ID,
  SYMPHONY_EMAIL_DOMAIN,
  SYMPHONY_USER_NAMESPACE,
  symphonyMicrosoftSignInResolver,
} from '../symphonyMicrosoftSignInResolver';

jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn().mockImplementation(() => ({
    getToken: jest.fn().mockResolvedValue({ token: 'graph-token' }),
  })),
}));

describe('symphonyMicrosoftSignInResolver', () => {
  const findCatalogUser = jest.fn();
  const issueToken = jest.fn();
  const resolver = symphonyMicrosoftSignInResolver();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AZURE_TENANT_ID = 'd0fec9dd-9219-4514-a1d8-1a872244bf6e';
    process.env.AZURE_CLIENT_ID = '73b2043b-6230-480a-8a9a-fd37f68af1b2';
    process.env.AZURE_CLIENT_SECRET = 'platform-secret';
    findCatalogUser.mockResolvedValue({
      entity: {
        kind: 'User',
        metadata: { namespace: 'symphonysensa', name: 'jubermohamad' },
      },
    });
    issueToken.mockResolvedValue({ token: 'backstage-token' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          CLOUDHUB_LOGIN_ALLOW_GROUP_ID,
          CLOUDHUB_PLATFORM_OWNERS_GROUP_ID,
          CLOUDHUB_DATA_EXPORT_GROUP_ID,
        ],
      }),
    }) as jest.Mock;
  });

  afterEach(() => {
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CLIENT_SECRET;
  });

  it('requires login-allow and issues platform-admin entitlement only for verified owners', async () => {
    const result = await resolver(
      {
        profile: {},
        result: {
          fullProfile: {
            id: 'entra-user-object-id',
            provider: 'microsoft',
            emails: [{ type: 'work', value: 'JuberMohamad@symphonysensa.com' }],
            _json: {
              userPrincipalName: 'JuberMohamad@symphonysensa.com',
              mail: null,
            },
          },
        },
      } as never,
      { findCatalogUser, issueToken } as never,
    );

    expect(SYMPHONY_USER_NAMESPACE).toBe('symphonysensa');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/users/entra-user-object-id/checkMemberGroups',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          groupIds: [
            CLOUDHUB_LOGIN_ALLOW_GROUP_ID,
            CLOUDHUB_PLATFORM_OWNERS_GROUP_ID,
            CLOUDHUB_DATA_EXPORT_GROUP_ID,
          ],
        }),
      }),
    );
    expect(findCatalogUser).toHaveBeenCalledWith({
      entityRef: 'user:symphonysensa/jubermohamad',
    });
    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:symphonysensa/jubermohamad',
        ent: [
          'user:symphonysensa/jubermohamad',
          'group:default/cloudhub-login-allow',
          'group:default/cloudhubplatformowners',
          'group:default/grp-cloudhub-data-export',
        ],
      },
    });
    expect(result).toEqual({ token: 'backstage-token' });
  });

  it('issues the Data Export entitlement only for verified group members', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [CLOUDHUB_LOGIN_ALLOW_GROUP_ID, CLOUDHUB_DATA_EXPORT_GROUP_ID],
      }),
    });

    await resolver(
      {
        profile: {},
        result: {
          fullProfile: {
            id: 'entra-user-id',
            email: 'export-user@symphonysensa.com',
          },
        },
      } as never,
      { findCatalogUser, issueToken } as never,
    );

    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:symphonysensa/export-user',
        ent: [
          'user:symphonysensa/export-user',
          'group:default/cloudhub-login-allow',
          'group:default/grp-cloudhub-data-export',
        ],
      },
    });
  });

  it('allows login-allow members without granting platform-admin entitlement', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ value: [CLOUDHUB_LOGIN_ALLOW_GROUP_ID] }),
    });

    await resolver(
      {
        profile: {},
        result: {
          fullProfile: {
            id: 'entra-user-id',
            email: 'reader@symphonysensa.com',
          },
        },
      } as never,
      { findCatalogUser, issueToken } as never,
    );

    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:symphonysensa/reader',
        ent: [
          'user:symphonysensa/reader',
          'group:default/cloudhub-login-allow',
        ],
      },
    });
  });

  it('rejects users who are not members of login-allow', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ value: [CLOUDHUB_PLATFORM_OWNERS_GROUP_ID] }),
    });

    await expect(
      resolver(
        {
          profile: {},
          result: {
            fullProfile: {
              id: 'entra-user-id',
              email: 'owner@symphonysensa.com',
            },
          },
        } as never,
        { findCatalogUser, issueToken } as never,
      ),
    ).rejects.toThrow(/membership in the Entra group cloudhub-login-allow/);
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('rejects accounts outside the Symphony Sensa Entra domain before calling Graph', async () => {
    await expect(
      resolver(
        {
          profile: {},
          result: { fullProfile: { email: 'person@example.com' } },
        } as never,
        { findCatalogUser, issueToken } as never,
      ),
    ).rejects.toThrow(
      `Sign-in requires an @${SYMPHONY_EMAIL_DOMAIN} Entra account`,
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('uses the email profile when UPN and mail are absent', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ value: [CLOUDHUB_LOGIN_ALLOW_GROUP_ID] }),
    });

    await resolver(
      {
        profile: {},
        result: { fullProfile: { email: 'juber.mohamad@symphonysensa.com' } },
      } as never,
      { findCatalogUser, issueToken } as never,
    );

    expect(findCatalogUser).toHaveBeenCalledWith({
      entityRef: 'user:symphonysensa/juber-mohamad',
    });
  });

  it('fails closed when Graph cannot verify membership', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
    });

    await expect(
      resolver(
        {
          profile: {},
          result: {
            fullProfile: {
              id: 'entra-user-id',
              email: 'user@symphonysensa.com',
            },
          },
        } as never,
        { findCatalogUser, issueToken } as never,
      ),
    ).rejects.toThrow(/admin consent.*GroupMember\.Read\.All/i);
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('does not use Microsoft OAuth credentials for Graph membership', async () => {
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CLIENT_SECRET;
    process.env.AUTH_MICROSOFT_TENANT_ID =
      'd0fec9dd-9219-4514-a1d8-1a872244bf6e';
    process.env.AUTH_MICROSOFT_CLIENT_ID = 'oauth-client-id';
    process.env.AUTH_MICROSOFT_CLIENT_SECRET = 'oauth-secret';

    await expect(
      resolver(
        {
          profile: {},
          result: {
            fullProfile: {
              id: 'entra-user-id',
              email: 'user@symphonysensa.com',
            },
          },
        } as never,
        { findCatalogUser, issueToken } as never,
      ),
    ).rejects.toThrow(/AZURE_CLIENT_ID/);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(issueToken).not.toHaveBeenCalled();
  });
});
