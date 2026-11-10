import { GitHubAuthorizationService } from '../services/githubAuthorizationService';
import type { LoggerService, RootConfigService } from '@backstage/backend-plugin-api';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as LoggerService;

function createMockConfig(values: Record<string, unknown>): RootConfigService {
  return {
    getOptionalConfig: jest.fn(key => {
      const path = String(key).split('.');
      let current: unknown = values;
      for (const segment of path) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[segment];
        } else {
          return undefined;
        }
      }
      if (current === undefined || current === null) return undefined;
      return createMockConfig(current as Record<string, unknown>);
    }),
    getOptionalStringArray: jest.fn(key => {
      const path = String(key).split('.');
      let current: unknown = values;
      for (const segment of path) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[segment];
        } else {
          return undefined;
        }
      }
      return Array.isArray(current) ? current : undefined;
    }),
    getOptionalBoolean: jest.fn(key => {
      const path = String(key).split('.');
      let current: unknown = values;
      for (const segment of path) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[segment];
        } else {
          return undefined;
        }
      }
      return typeof current === 'boolean' ? current : undefined;
    }),
  } as unknown as RootConfigService;
}

describe('GitHubAuthorizationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('denies everyone when provisioning is disabled', async () => {
    const config = createMockConfig({
      github: {
        repositoryProvisioning: { enabled: false, authorizedGroups: ['CloudHub-GitHub-RepoCreators'] },
      },
    });
    const service = new GitHubAuthorizationService({ logger: mockLogger, config });
    expect(service.isEnabled()).toBe(false);

    const result = await service.authorize({
      groups: ['group:default/CloudHub-GitHub-RepoCreators'],
      actorRef: 'user:default/test',
    });
    expect(result.authorized).toBe(false);
    expect(result.enabled).toBe(false);
  });

  it('authorizes users in configured groups from token claims', async () => {
    const config = createMockConfig({
      github: {
        repositoryProvisioning: {
          enabled: true,
          authorizedGroups: ['CloudHub-GitHub-RepoCreators'],
        },
      },
    });
    const service = new GitHubAuthorizationService({ logger: mockLogger, config });
    expect(service.isEnabled()).toBe(true);
    expect(service.getAuthorizedGroups()).toEqual(['CloudHub-GitHub-RepoCreators']);

    const result = await service.authorize({
      groups: ['group:default/CloudHub-GitHub-RepoCreators'],
      actorRef: 'user:default/test',
    });
    expect(result.authorized).toBe(true);
    expect(result.enabled).toBe(true);
    expect(result.source).toBe('token');
  });

  it('denies users not in configured groups', async () => {
    const config = createMockConfig({
      github: {
        repositoryProvisioning: {
          enabled: true,
          authorizedGroups: ['CloudHub-GitHub-RepoCreators'],
        },
      },
    });
    const service = new GitHubAuthorizationService({ logger: mockLogger, config });
    const result = await service.authorize({
      groups: ['group:default/other-group'],
      actorRef: 'user:default/test',
    });
    expect(result.authorized).toBe(false);
    expect(result.enabled).toBe(true);
  });

  it('treats missing authorized groups as unconfigured', async () => {
    const config = createMockConfig({
      github: {
        repositoryProvisioning: { enabled: true },
      },
    });
    const service = new GitHubAuthorizationService({ logger: mockLogger, config });
    const result = await service.authorize({
      groups: ['group:default/CloudHub-GitHub-RepoCreators'],
      actorRef: 'user:default/test',
    });
    expect(result.authorized).toBe(false);
    expect(result.source).toBe('unconfigured');
  });
});
