import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  JumpboxAccessProvisioningService,
  TAILSCALE_NOREPLY_EMAIL,
  applyJumpboxPolicy,
  deriveJumpboxName,
  githubUserToTailscale,
  normalizeAdministrators,
  parseHujson,
  serializeHujson,
  validateJumpboxPolicy,
} from '../services/JumpboxAccessProvisioningService';

function makeLogger(): LoggerService {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  } as unknown as LoggerService;
  (logger.child as jest.Mock).mockReturnValue(logger);
  return logger;
}

const BASE_POLICY = `// Tailscale ACL policy
{
  "tagOwners": {
    "tag:session-recorder": ["autogroup:admin"],
  },
  "groups": {},
  /* default allow */
  "acls": [
    { "action": "accept", "src": ["*"], "dst": ["*:*"] },
  ],
  "ssh": [],
}
`;

describe('JumpboxAccessProvisioningService helpers', () => {
  describe('normalizeAdministrators', () => {
    it('trims, drops empties and de-duplicates case-insensitively', () => {
      const { valid, invalid } = normalizeAdministrators([
        ' octocat ',
        'Octocat',
        'hubot',
        '',
      ]);
      expect(valid).toEqual(['octocat', 'hubot']);
      expect(invalid).toEqual([]);
    });

    it('rejects invalid GitHub usernames', () => {
      const { valid, invalid } = normalizeAdministrators([
        'good-user',
        'bad user',
        '-nope-',
      ]);
      expect(valid).toEqual(['good-user']);
      expect(invalid).toEqual(['bad user', '-nope-']);
    });
  });

  describe('deriveJumpboxName', () => {
    it('replaces the aks- prefix with jumpbox-', () => {
      expect(deriveJumpboxName('aks-visa-qa-aue')).toBe('jumpbox-visa-qa-aue');
    });

    it('prepends jumpbox- when there is no aks- prefix', () => {
      expect(deriveJumpboxName('contoso-dev')).toBe('jumpbox-contoso-dev');
    });
  });

  describe('parseHujson', () => {
    it('parses HUJSON with comments and trailing commas', () => {
      const parsed = parseHujson(BASE_POLICY);
      expect(parsed.tagOwners['tag:session-recorder']).toEqual([
        'autogroup:admin',
      ]);
      expect(Array.isArray(parsed.acls)).toBe(true);
    });

    it('does not corrupt string literals containing // or /*', () => {
      const parsed = parseHujson('{ "note": "http://example.com/*x*/" }');
      expect(parsed.note).toBe('http://example.com/*x*/');
    });
  });

  describe('applyJumpboxPolicy', () => {
    it('adds tag, group, ACL and SSH rules', () => {
      const policy = parseHujson(BASE_POLICY);
      applyJumpboxPolicy(policy, {
        jumpboxName: 'jumpbox-visa-qa-aue',
        administrators: ['octocat', 'hubot'],
      });

      expect(policy.tagOwners['tag:jumpbox-visa-qa-aue']).toBeDefined();
      expect(policy.groups['group:jumpbox-visa-qa-aue']).toEqual([
        'octocat@github',
        'hubot@github',
      ]);
      const acl = policy.acls.find((a: any) =>
        a.dst?.includes('tag:jumpbox-visa-qa-aue:22'),
      );
      expect(acl?.src).toEqual(['group:jumpbox-visa-qa-aue']);
      const ssh = policy.ssh.find((s: any) =>
        s.dst?.includes('tag:jumpbox-visa-qa-aue'),
      );
      expect(ssh?.users).toEqual(['aksuser']);
      expect(ssh?.enforceRecorder).toBe(true);
      expect(ssh?.recorder).toEqual(['tag:session-recorder']);
    });

    it('is idempotent for ACL/SSH and refreshes group membership', () => {
      const policy = parseHujson(BASE_POLICY);
      applyJumpboxPolicy(policy, {
        jumpboxName: 'jumpbox-x',
        administrators: ['a'],
      });
      applyJumpboxPolicy(policy, {
        jumpboxName: 'jumpbox-x',
        administrators: ['a', 'b'],
      });

      const acls = policy.acls.filter((x: any) =>
        x.dst?.includes('tag:jumpbox-x:22'),
      );
      const sshRules = policy.ssh.filter((x: any) =>
        x.dst?.includes('tag:jumpbox-x'),
      );
      expect(acls).toHaveLength(1);
      expect(sshRules).toHaveLength(1);
      expect(policy.groups['group:jumpbox-x']).toEqual([
        'a@github',
        'b@github',
      ]);
    });
  });

  describe('validateJumpboxPolicy', () => {
    it('passes for a correctly updated policy', () => {
      const policy = parseHujson(BASE_POLICY);
      applyJumpboxPolicy(policy, {
        jumpboxName: 'jumpbox-x',
        administrators: ['octocat'],
      });
      const result = validateJumpboxPolicy(serializeHujson(policy), {
        jumpboxName: 'jumpbox-x',
        administrators: ['octocat'],
      });
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('flags a missing administrator', () => {
      const policy = parseHujson(BASE_POLICY);
      applyJumpboxPolicy(policy, {
        jumpboxName: 'jumpbox-x',
        administrators: ['octocat'],
      });
      const result = validateJumpboxPolicy(serializeHujson(policy), {
        jumpboxName: 'jumpbox-x',
        administrators: ['octocat', 'missing'],
      });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('missing@github');
    });

    it('reports invalid HUJSON', () => {
      const result = validateJumpboxPolicy('{ not json', {
        jumpboxName: 'jumpbox-x',
        administrators: ['octocat'],
      });
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('valid HUJSON');
    });
  });

  it('githubUserToTailscale appends @github', () => {
    expect(githubUserToTailscale('octocat')).toBe('octocat@github');
  });
});

describe('JumpboxAccessProvisioningService (GitHub operations)', () => {
  const originalToken = process.env.GITHUB_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  });

  function makeFakeOctokit() {
    const committed: {
      content?: string;
      message?: string;
      author?: { name: string; email: string };
      committer?: { name: string; email: string };
    } = {};
    const pr: { title?: string; body?: string; head?: string; base?: string } =
      {};
    const octokit = {
      repos: {
        getContent: jest.fn().mockResolvedValue({
          data: {
            content: Buffer.from(BASE_POLICY, 'utf8').toString('base64'),
            sha: 'file-sha',
          },
        }),
        createOrUpdateFileContents: jest
          .fn()
          .mockImplementation(async (args: any) => {
            committed.content = Buffer.from(args.content, 'base64').toString(
              'utf8',
            );
            committed.message = args.message;
            committed.author = args.author;
            committed.committer = args.committer;
            return { data: {} };
          }),
        get: jest.fn().mockResolvedValue({ data: {} }),
      },
      git: {
        getRef: jest
          .fn()
          .mockResolvedValue({ data: { object: { sha: 'base-sha' } } }),
        createRef: jest.fn().mockResolvedValue({ data: {} }),
      },
      pulls: {
        create: jest.fn().mockImplementation(async (args: any) => {
          pr.title = args.title;
          pr.body = args.body;
          pr.head = args.head;
          pr.base = args.base;
          return {
            data: {
              number: 42,
              html_url: 'https://github.com/SymphonySensa/tailscale/pull/42',
              node_id: 'PR_node_42',
            },
          };
        }),
        get: jest.fn().mockResolvedValue({
          data: { state: 'closed', merged_at: '2024-01-01T00:00:00Z' },
        }),
      },
      users: {
        getAuthenticated: jest.fn().mockResolvedValue({
          data: { id: 583231, login: 'cloudhub-bot', name: 'CloudHub Bot' },
        }),
      },
      graphql: jest.fn().mockResolvedValue({}),
    };
    return { octokit, committed, pr };
  }

  function makeRealService(autoMergeEnabled = false) {
    process.env.GITHUB_TOKEN = 'ghp_dummy_token_for_tests';
    process.env.CLOUDHUB_AUTO_MERGE_ENABLED = autoMergeEnabled
      ? 'true'
      : 'false';
    return new JumpboxAccessProvisioningService(makeLogger(), {
      repo: 'tailscale',
    });
  }

  it('opens a validated Tailscale PR with the correct title and commit message', async () => {
    const service = makeRealService();
    const { octokit, committed, pr } = makeFakeOctokit();
    (service as any).octokit = octokit;

    const result = await service.provisionAccess({
      clusterName: 'aks-visa-qa-aue',
      jumpboxName: 'jumpbox-visa-qa-aue',
      clusterAdministrators: ['octocat', 'Octocat', 'hubot'],
    });

    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toContain('/pull/42');
    expect(result.administrators).toEqual(['octocat', 'hubot']);
    expect(committed.message).toBe(
      'chore: grant jumpbox access for aks-visa-qa-aue',
    );
    expect(pr.title).toBe('chore: add jumpbox access for aks-visa-qa-aue');
    expect(pr.base).toBe('main');

    // The committed policy must contain the group + validated rules.
    const policy = parseHujson(committed.content ?? '');
    expect(policy.groups['group:jumpbox-visa-qa-aue']).toEqual([
      'octocat@github',
      'hubot@github',
    ]);
    expect(octokit.pulls.create).toHaveBeenCalledTimes(1);
    expect(octokit.graphql).not.toHaveBeenCalled();
    // Ruleset: "Users must use GitHub noreply address".
    expect(committed.author).toEqual({
      name: 'CloudHub Bot',
      email: '583231+cloudhub-bot@users.noreply.github.com',
    });
    expect(committed.committer).toEqual(committed.author);
    expect(committed.author!.email).toMatch(TAILSCALE_NOREPLY_EMAIL);
  });

  it('uses a configured noreply author', async () => {
    process.env.GITHUB_TOKEN = 'ghp_dummy_token_for_tests';
    const service = new JumpboxAccessProvisioningService(makeLogger(), {
      commitAuthorName: 'CloudHub',
      commitAuthorEmail: '1+cloudhub@users.noreply.github.com',
    });
    const { octokit, committed } = makeFakeOctokit();
    (service as any).octokit = octokit;
    await service.provisionAccess({
      clusterName: 'aks-visa-qa-aue',
      jumpboxName: 'jumpbox-visa-qa-aue',
      clusterAdministrators: ['octocat'],
    });
    expect(committed.author!.email).toBe('1+cloudhub@users.noreply.github.com');
    expect(octokit.users.getAuthenticated).not.toHaveBeenCalled();
  });

  it('refuses a non-noreply author before creating any branch', async () => {
    process.env.GITHUB_TOKEN = 'ghp_dummy_token_for_tests';
    const service = new JumpboxAccessProvisioningService(makeLogger(), {
      commitAuthorEmail: 'bot@symphonyai.com',
    });
    const { octokit } = makeFakeOctokit();
    (service as any).octokit = octokit;
    await expect(
      service.provisionAccess({
        clusterName: 'aks-visa-qa-aue',
        jumpboxName: 'jumpbox-visa-qa-aue',
        clusterAdministrators: ['octocat'],
      }),
    ).rejects.toThrow(/noreply author email/);
    expect(octokit.git.createRef).not.toHaveBeenCalled();
    expect(octokit.pulls.create).not.toHaveBeenCalled();
  });

  it('enables auto-merge when configured', async () => {
    process.env.CLOUDHUB_AUTO_MERGE_METHOD = 'squash';
    const service = makeRealService(true);
    const { octokit } = makeFakeOctokit();
    (service as any).octokit = octokit;

    await service.provisionAccess({
      clusterName: 'aks-visa-qa-aue',
      jumpboxName: 'jumpbox-visa-qa-aue',
      clusterAdministrators: ['octocat'],
    });

    expect(octokit.graphql).toHaveBeenCalledTimes(1);
  });

  it('rejects when no valid administrators are supplied', async () => {
    const service = makeRealService();
    const { octokit } = makeFakeOctokit();
    (service as any).octokit = octokit;

    await expect(
      service.provisionAccess({
        clusterName: 'aks-x',
        jumpboxName: 'jumpbox-x',
        clusterAdministrators: [],
      }),
    ).rejects.toThrow(/at least one cluster administrator/i);
    expect(octokit.pulls.create).not.toHaveBeenCalled();
  });

  it('rejects invalid GitHub usernames before any Git operation', async () => {
    const service = makeRealService();
    const { octokit } = makeFakeOctokit();
    (service as any).octokit = octokit;

    await expect(
      service.provisionAccess({
        clusterName: 'aks-x',
        jumpboxName: 'jumpbox-x',
        clusterAdministrators: ['bad user'],
      }),
    ).rejects.toThrow(/invalid github usernames/i);
    expect(octokit.git.createRef).not.toHaveBeenCalled();
  });

  it('getPullRequestStatus reports merged PRs', async () => {
    const service = makeRealService();
    const { octokit } = makeFakeOctokit();
    (service as any).octokit = octokit;

    const status = await service.getPullRequestStatus(42);
    expect(status).toEqual({ state: 'closed', merged: true });
  });

  it('is sim mode without a token and throws on provisionAccess', async () => {
    delete process.env.GITHUB_TOKEN;
    const service = new JumpboxAccessProvisioningService(makeLogger());
    expect(service.mode).toBe('sim');
    await expect(
      service.provisionAccess({
        clusterName: 'aks-x',
        jumpboxName: 'jumpbox-x',
        clusterAdministrators: ['octocat'],
      }),
    ).rejects.toThrow(/GITHUB_TOKEN/);
  });
});
