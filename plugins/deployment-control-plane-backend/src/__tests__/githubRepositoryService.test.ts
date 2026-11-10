import { GitHubRepositoryService } from '../services/githubRepositoryService';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Pool } from 'pg';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as LoggerService;

function createMockPool(): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  } as unknown as Pool;
}

function createMockOctokit(overrides: {
  repoExists?: boolean;
  createFails?: boolean;
} = {}) {
  const mockRepoGet = jest.fn().mockImplementation(async () => {
    if (overrides.repoExists) {
      return { data: { name: 'platform-orders-api', html_url: 'https://github.com/SymphonySensa/platform-orders-api' } };
    }
    const error = new Error('Not Found') as Error & { status: number };
    error.status = 404;
    throw error;
  });

  const mockCreateInOrg = jest.fn().mockResolvedValue({
    data: {
      name: 'platform-orders-api',
      html_url: 'https://github.com/SymphonySensa/platform-orders-api',
    },
  });

  const mockAddOrUpdateRepoPermissions = jest.fn().mockResolvedValue({});
  const mockUpdateBranchProtection = jest.fn().mockResolvedValue({});
  const mockCreateOrUpdateFileContents = jest.fn().mockResolvedValue({});

  return {
    rest: {
      repos: {
        get: mockRepoGet,
        createInOrg: mockCreateInOrg,
        updateBranchProtection: mockUpdateBranchProtection,
        createOrUpdateFileContents: mockCreateOrUpdateFileContents,
      },
      teams: {
        addOrUpdateRepoPermissionsInOrg: mockAddOrUpdateRepoPermissions,
      },
    },
  } as any;
}

describe('GitHubRepositoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('validates repository names', () => {
    const service = new GitHubRepositoryService({ logger: mockLogger, token: 'fake-token' });

    expect(service.validateRepositoryName('platform-orders-api').valid).toBe(true);
    expect(service.validateRepositoryName('platform-orders-api').valid).toBe(true);
    expect(service.validateRepositoryName('OrdersAPI').valid).toBe(false);
    expect(service.validateRepositoryName('orders_api').valid).toBe(false);
    expect(service.validateRepositoryName('orders api').valid).toBe(false);
    expect(service.validateRepositoryName('ab').valid).toBe(false);
    expect(service.validateRepositoryName('a'.repeat(101)).valid).toBe(false);
  });

  it('returns success response when repository is created', async () => {
    const octokit = createMockOctokit();
    const service = new GitHubRepositoryService({
      logger: mockLogger,
      token: 'fake-token',
      organization: 'SymphonySensa',
      pool: createMockPool(),
    });
    (service as any).octokit = octokit;

    const result = await service.createRepository(
      {
        repositoryName: 'platform-orders-api',
        description: 'Orders Domain API',
        visibility: 'private',
        ownerTeam: 'cloud-engineering',
        templateName: 'Empty',
        enableBranchProtection: true,
        enableCodeOwners: true,
        enableDependabot: true,
      },
      'user:default/test',
    );

    expect(result.success).toBe(true);
    expect(result.repositoryName).toBe('platform-orders-api');
    expect(result.repositoryUrl).toBe('https://github.com/SymphonySensa/platform-orders-api');
    expect(result.ownerTeam).toBe('cloud-engineering');
    expect(octokit.rest.repos.createInOrg).toHaveBeenCalled();
    expect(octokit.rest.teams.addOrUpdateRepoPermissionsInOrg).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'admin' }),
    );
    expect(octokit.rest.repos.updateBranchProtection).toHaveBeenCalled();
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(2);
  });

  it('returns failure when repository already exists', async () => {
    const octokit = createMockOctokit({ repoExists: true });
    const service = new GitHubRepositoryService({
      logger: mockLogger,
      token: 'fake-token',
      organization: 'SymphonySensa',
    });
    (service as any).octokit = octokit;

    const result = await service.createRepository(
      {
        repositoryName: 'platform-orders-api',
        visibility: 'private',
        ownerTeam: 'cloud-engineering',
        enableBranchProtection: false,
        enableCodeOwners: false,
        enableDependabot: false,
      },
      'user:default/test',
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
    expect(octokit.rest.repos.createInOrg).not.toHaveBeenCalled();
  });

  it('returns failure for invalid repository names', async () => {
    const service = new GitHubRepositoryService({ logger: mockLogger, token: 'fake-token' });

    const result = await service.createRepository(
      {
        repositoryName: 'OrdersApi',
        visibility: 'private',
        ownerTeam: 'cloud-engineering',
        enableBranchProtection: false,
        enableCodeOwners: false,
        enableDependabot: false,
      },
      'user:default/test',
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('lowercase');
  });

  it('lists available templates', async () => {
    const service = new GitHubRepositoryService({ logger: mockLogger, token: 'fake-token' });
    const templates = await service.listTemplates();
    expect(templates).toContain('Empty');
    expect(templates).toContain('node-api-template');
  });
});
