import type { LoggerService } from '@backstage/backend-plugin-api';

const mockGetToken = jest.fn();

jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn().mockImplementation(() => ({
    getToken: mockGetToken,
  })),
}));

import { GpuAuthorizationService } from '../services/gpuAuthorizationService';

const GROUP_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_GROUP_ID = '22222222-2222-2222-2222-222222222222';

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis() as any,
};

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NODE_ENV = 'test';
  delete process.env.GPU_ENTRA_GROUP_ID;
  delete process.env.GPU_ADMIN_GROUP_ID;
  delete process.env.GPU_GRAPH_ENABLED;
  delete process.env.CLOUDHUB_TFC_TOKEN;
  delete process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID;
  delete process.env.CLOUDHUB_GITHUB_TOKEN;
  delete process.env.AZURE_TENANT_ID;
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_CLIENT_SECRET;
  delete process.env.PLATFORM_AZURE_TENANT_ID;
  delete process.env.PLATFORM_AZURE_CLIENT_ID;
  delete process.env.PLATFORM_AZURE_CLIENT_SECRET;
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('GpuAuthorizationService', () => {
  it('denies everyone when GPU_ENTRA_GROUP_ID is not configured (fail closed)', async () => {
    const service = new GpuAuthorizationService(mockLogger);
    const result = await service.isGpuAuthorized({
      groups: [`group:default/${GROUP_ID}`],
      actorRef: 'user:default/jane',
    });
    expect(result.authorized).toBe(false);
    expect(result.role).toBe('NONE');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('GPU_ENTRA_GROUP_ID is not configured'),
    );
  });

  it('authorizes a user whose token groups include the configured group id', async () => {
    process.env.GPU_ENTRA_GROUP_ID = GROUP_ID;
    const service = new GpuAuthorizationService(mockLogger);
    const result = await service.isGpuAuthorized({
      groups: [`group:default/${GROUP_ID}`],
      actorRef: 'user:default/jane',
    });
    expect(result.authorized).toBe(true);
    expect(result.role).toBe('GPU_USER');
    expect(result.source).toBe('token');
  });

  it('grants GPU_ADMIN when the admin group id matches', async () => {
    process.env.GPU_ENTRA_GROUP_ID = GROUP_ID;
    process.env.GPU_ADMIN_GROUP_ID = ADMIN_GROUP_ID;
    const service = new GpuAuthorizationService(mockLogger);
    const role = await service.getUserGpuRole({
      groups: [`group:default/${ADMIN_GROUP_ID}`],
      actorRef: 'user:default/jane',
    });
    expect(role).toBe('GPU_ADMIN');
  });

  it('authorizes platform-admin users even when they are not in the GPU group', async () => {
    const service = new GpuAuthorizationService(mockLogger);
    const result = await service.isGpuAuthorized({
      groups: ['group:default/cloudhubplatformowners'],
      actorRef: 'user:default/jubermohamad@symphonysensa.com',
    });
    expect(result.authorized).toBe(true);
    expect(result.role).toBe('GPU_ADMIN');
  });

  it('does not grant platform access from the user name without a matching group', async () => {
    const service = new GpuAuthorizationService(mockLogger);
    const result = await service.isGpuAuthorized({
      groups: [],
      actorRef: 'user:default/juber.mohamad@symphonysensa.com',
    });
    expect(result.authorized).toBe(false);
    expect(result.role).toBe('NONE');
  });

  it('authorizes local development users when CloudHub provisioning credentials are present', async () => {
    process.env.NODE_ENV = 'development';
    process.env.CLOUDHUB_TFC_TOKEN = 'tfc-token';
    process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID = 'oauth-token-id';
    process.env.CLOUDHUB_GITHUB_TOKEN = 'gh-token';

    const service = new GpuAuthorizationService(mockLogger);
    const result = await service.isGpuAuthorized({
      groups: [],
      actorRef: 'user:default/local.dev',
    });

    expect(result.authorized).toBe(true);
    expect(result.role).toBe('GPU_ADMIN');
    expect(result.source).toBe('token');
  });

  it('denies a user whose token groups do not include the configured group', async () => {
    process.env.GPU_ENTRA_GROUP_ID = GROUP_ID;
    const service = new GpuAuthorizationService(mockLogger);
    const result = await service.isGpuAuthorized({
      groups: ['group:default/some-other-group'],
      actorRef: 'user:default/jane',
    });
    expect(result.authorized).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('GPU authorization denied'),
    );
  });

  it('falls back to Microsoft Graph when the token did not grant a GPU role', async () => {
    process.env.GPU_ENTRA_GROUP_ID = GROUP_ID;
    process.env.GPU_GRAPH_ENABLED = 'true';
    process.env.AZURE_TENANT_ID = 'd0fec9dd-9219-4514-a1d8-1a872244bf6e';
    process.env.AZURE_CLIENT_ID = '73b2043b-6230-480a-8a9a-fd37f68af1b2';
    process.env.AZURE_CLIENT_SECRET = 'secret-123';
    mockGetToken.mockResolvedValue({ token: 'app-token' });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ value: [GROUP_ID] }),
    });

    const service = new GpuAuthorizationService(mockLogger);
    const result = await service.isGpuAuthorized({
      groups: [],
      actorRef: 'user:default/jane.doe',
    });

    expect(result.authorized).toBe(true);
    expect(result.source).toBe('graph');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/users/jane.doe/checkMemberGroups'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // Catalog ownership refs never carry the raw Entra object id, so unrelated
  // group claims must not suppress the Graph check.
  it('still checks Graph when the caller has unrelated catalog group claims', async () => {
    process.env.GPU_ENTRA_GROUP_ID = GROUP_ID;
    process.env.GPU_GRAPH_ENABLED = 'true';
    process.env.AZURE_TENANT_ID = 'd0fec9dd-9219-4514-a1d8-1a872244bf6e';
    process.env.AZURE_CLIENT_ID = '73b2043b-6230-480a-8a9a-fd37f68af1b2';
    process.env.AZURE_CLIENT_SECRET = 'secret-123';
    mockGetToken.mockResolvedValue({ token: 'app-token' });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ value: [GROUP_ID] }),
    });

    const service = new GpuAuthorizationService(mockLogger);
    const result = await service.isGpuAuthorized({
      groups: ['group:default/cloudhub-platform'],
      actorRef: 'user:default/38d56dd8-74ec-48d4-b812-6099ed685f8c',
    });

    expect(result.authorized).toBe(true);
    expect(result.source).toBe('graph');
  });

  it('uses only the canonical AZURE_* credentials for the Graph membership check', async () => {
    process.env.GPU_ENTRA_GROUP_ID = GROUP_ID;
    process.env.GPU_GRAPH_ENABLED = 'true';
    process.env.AZURE_TENANT_ID = 'd0fec9dd-9219-4514-a1d8-1a872244bf6e';
    process.env.AZURE_CLIENT_ID = '73b2043b-6230-480a-8a9a-fd37f68af1b2';
    process.env.AZURE_CLIENT_SECRET = 'auth-secret';
    process.env.PLATFORM_AZURE_TENANT_ID = 'ignored-tenant';
    process.env.PLATFORM_AZURE_CLIENT_ID = 'ignored-client';
    process.env.PLATFORM_AZURE_CLIENT_SECRET = 'platform-secret';
    mockGetToken.mockResolvedValue({ token: 'app-token' });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ value: [GROUP_ID] }),
    });

    const { ClientSecretCredential } = jest.requireMock('@azure/identity');
    const service = new GpuAuthorizationService(mockLogger);
    await service.isGpuAuthorized({
      groups: [],
      actorRef: 'user:default/jane.doe',
    });

    expect(ClientSecretCredential).toHaveBeenCalledWith(
      'd0fec9dd-9219-4514-a1d8-1a872244bf6e',
      '73b2043b-6230-480a-8a9a-fd37f68af1b2',
      'auth-secret',
      expect.anything(),
    );
  });

  it('does not call Graph when the fallback is disabled', async () => {
    process.env.GPU_ENTRA_GROUP_ID = GROUP_ID;
    const service = new GpuAuthorizationService(mockLogger);
    await service.isGpuAuthorized({
      groups: ['group:default/some-other-group'],
      actorRef: 'user:default/jane',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
