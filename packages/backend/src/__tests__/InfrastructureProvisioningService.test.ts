import fs from 'fs';
import nodePath from 'path';
import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  AKS_FLAVOR_POOLS,
  deriveAksNames,
  normalizeAksClusterRequest,
  renderAksValuesFile,
  type AksClusterRequest,
} from '@internal/plugin-platform-common/backend';
import {
  INFRA_REPOSITORY,
  InfrastructureProvisioningService,
  insertAksWorkspaceEntry,
} from '../services/InfrastructureProvisioningService';

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

function validRequest(
  overrides: Record<string, unknown> = {},
): AksClusterRequest {
  return normalizeAksClusterRequest({
    customer: 'Contoso',
    businessUnit: 'Retail',
    owner: 'owner@contoso.com',
    costCentre: 'P64358',
    changeTicket: 'SCP-1234',
    clusterProfile: 'single-region',
    env: 'dev',
    location: 'australiaeast',
    tenancy: 'st',
    tenantId: 'contoso',
    kubernetesVersion: '1.36.2',
    addressSpace: '10.230.0.0/16',
    ...AKS_FLAVOR_POOLS.medium,
    ...overrides,
  });
}

/** Verbatim excerpt of workspacemanager/workspaces.tfvars on main (6bc941b). */
const WORKSPACES_FIXTURE = `workspaces = {
  # ==============================================================================
  # azure-front-door
  # ==============================================================================
  "azure-front-door" = {
    "afd-nr-bal" = {}
  }

  # ==============================================================================
  # azure-kubernetes-service-standard - SINGLE CLUSTER, NON-EDB SETUP
  # ==============================================================================
  "azure-kubernetes-service-standard" = {
    "aks-scp-prd-cnc-st-manu"      = {}
    "aks-scp-prd-uks-st-mcard"     = {}
    "aks-scp-dev-plc-st-intdemo02" = {}

    "aks-scp-prd-argocd-frc-scp" = {
      project_name_override = "SCP-PRD-INFRASTRUCTURE"
    }
    "aks-scp-dev-frc-st-df02" = {
      vcs_branch = "feature/cloudhub-iac"
    }



  }


  # ==============================================================================
  # azure-kubernetes-service-legacy - LEGACY AKS CLUSTERS, DO NOT ADD NEW CLUSTERS HERE
  # ==============================================================================
  "azure-kubernetes-service-legacy" = {
    "uss-enterprise" = {}
  }
}
`;

describe('InfrastructureProvisioningService', () => {
  const saved = {
    actions: process.env.GITHUB_ACTIONS_TOKEN,
    token: process.env.GITHUB_TOKEN,
    autoMerge: process.env.CLOUDHUB_AUTO_MERGE_ENABLED,
  };

  afterEach(() => {
    for (const [key, value] of [
      ['GITHUB_ACTIONS_TOKEN', saved.actions],
      ['GITHUB_TOKEN', saved.token],
      ['CLOUDHUB_AUTO_MERGE_ENABLED', saved.autoMerge],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function makeService(): InfrastructureProvisioningService {
    return new InfrastructureProvisioningService(makeLogger());
  }

  it('targets SymphonySensa/scp-infra-as-code by default', () => {
    expect(INFRA_REPOSITORY).toBe('SymphonySensa/scp-infra-as-code');
  });

  describe('mode', () => {
    it('is sim when GitHub tokens are not set', () => {
      delete process.env.GITHUB_ACTIONS_TOKEN;
      delete process.env.GITHUB_TOKEN;
      expect(makeService().mode).toBe('sim');
    });

    it('is real when a GitHub token is set', () => {
      process.env.GITHUB_TOKEN = 'ghp_dummy_token_for_tests';
      expect(makeService().mode).toBe('real');
    });
  });

  describe('request model', () => {
    it('derives names and paths from the shared model', () => {
      const service = makeService();
      const request = validRequest();
      expect(service.buildClusterName(request)).toBe(
        'aks-scp-dev-ae-st-contoso',
      );
      expect(service.tfvarsFilePath(request)).toBe(
        'azure-kubernetes-service-standard/values/aks-scp-dev-ae-st-contoso.tfvars',
      );
    });

    it('reports field errors as messages', () => {
      const result = makeService().validateRequest(
        validRequest({ env: 'prod', addressSpace: '10.0.0.0/16' }),
      );
      expect(result.fieldErrors).toHaveProperty('env');
      expect(result.fieldErrors).toHaveProperty('addressSpace');
      expect(result.errors).toHaveLength(2);
    });

    it('does not invent resource counts or cost', () => {
      const plan = makeService().estimatePlan(validRequest());
      expect(plan).toMatchObject({
        resourcesToCreate: 0,
        monthlyCost: 0,
        errors: [],
      });
      expect(plan.warnings[0]).toMatch(/Terraform Cloud/);
    });

    it('generates exactly the shared values file', () => {
      const request = validRequest();
      expect(makeService().generateTfvars(request, '2026-10-13')).toBe(
        renderAksValuesFile(request, { created: '2026-10-13' }),
      );
    });
  });

  describe('insertAksWorkspaceEntry', () => {
    it('adds a single aligned line to the standard block only', () => {
      const out = insertAksWorkspaceEntry(
        WORKSPACES_FIXTURE,
        'aks-scp-dev-ae-st-contoso',
      );
      const added = out
        .split('\n')
        .filter(line => !WORKSPACES_FIXTURE.split('\n').includes(line));
      expect(added).toEqual(['    "aks-scp-dev-ae-st-contoso"    = {}']);
      expect(out.indexOf('aks-scp-dev-ae-st-contoso')).toBeLessThan(
        out.indexOf('azure-kubernetes-service-legacy'),
      );
    });

    it('re-aligns the whole run when the new key is the longest', () => {
      const out = insertAksWorkspaceEntry(
        WORKSPACES_FIXTURE,
        'aks-scp-prd-wcus-mt-verylongtenantname',
      );
      expect(out).toContain(
        '    "aks-scp-prd-cnc-st-manu"                = {}\n',
      );
      expect(out).toContain(
        '    "aks-scp-prd-wcus-mt-verylongtenantname" = {}\n',
      );
      // Multi-line entries are untouched.
      expect(out).toContain(
        '    "aks-scp-prd-argocd-frc-scp" = {\n      project_name_override',
      );
    });

    it('refuses to register an existing workspace', () => {
      expect(() =>
        insertAksWorkspaceEntry(WORKSPACES_FIXTURE, 'aks-scp-prd-uks-st-mcard'),
      ).toThrow(/already registered/);
      expect(() =>
        insertAksWorkspaceEntry(WORKSPACES_FIXTURE, 'aks-scp-dev-frc-st-df02'),
      ).toThrow(/already registered/);
    });

    it('fails when the standard block is missing', () => {
      expect(() =>
        insertAksWorkspaceEntry('workspaces = {\n}\n', 'aks-scp-dev-ae-st-x'),
      ).toThrow(/no "azure-kubernetes-service-standard" block/);
    });
  });

  describe('GitHub operations', () => {
    function makeOctokit(
      opts: {
        valuesExists?: boolean;
        /** Branch left by an earlier attempt, with these files on it. */
        branch?: { values?: string; workspaces?: string };
        existingPrs?: Array<{
          number: number;
          state: string;
          merged_at?: string | null;
        }>;
      } = {},
    ) {
      const notFound = Object.assign(new Error('Not Found'), { status: 404 });
      const file = (content: string, sha: string) => ({
        data: { content: Buffer.from(content).toString('base64'), sha },
      });
      return {
        repos: {
          get: jest.fn().mockResolvedValue({ data: {} }),
          getContent: jest.fn(
            async ({ path, ref }: { path: string; ref: string }) => {
              const onBranch = ref !== 'main';
              if (path.endsWith('.tfvars') && path.includes('/values/')) {
                if (!onBranch && opts.valuesExists) return file('', 'v');
                if (onBranch && opts.branch?.values !== undefined) {
                  return file(opts.branch.values, 'v-sha');
                }
                throw notFound;
              }
              return file(
                onBranch && opts.branch?.workspaces !== undefined
                  ? opts.branch.workspaces
                  : WORKSPACES_FIXTURE,
                'ws-sha',
              );
            },
          ),
          createOrUpdateFileContents: jest
            .fn()
            .mockResolvedValue({ data: { commit: { sha: 'abcdef123456' } } }),
        },
        git: {
          getRef: jest.fn(async ({ ref }: { ref: string }) => {
            if (ref === 'heads/main') {
              return { data: { object: { sha: 'main-sha' } } };
            }
            if (opts.branch) return { data: { object: { sha: 'branch-sha' } } };
            throw notFound;
          }),
          createRef: jest.fn().mockResolvedValue({ data: {} }),
        },
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: (opts.existingPrs ?? []).map(pr => ({
              ...pr,
              html_url: `https://github.com/SymphonySensa/scp-infra-as-code/pull/${pr.number}`,
            })),
          }),
          create: jest.fn().mockResolvedValue({
            data: {
              number: 42,
              html_url:
                'https://github.com/SymphonySensa/scp-infra-as-code/pull/42',
              node_id: 'PR_node_42',
            },
          }),
        },
        graphql: jest.fn().mockResolvedValue({}),
      } as any;
    }

    function serviceWith(octokit: any) {
      process.env.GITHUB_TOKEN = 'ghp_dummy_token_for_tests';
      const service = makeService();
      (service as any).octokit = octokit;
      return service;
    }

    it('commits the values file and workspace entry on a ticketed feature branch', async () => {
      const octokit = makeOctokit();
      const request = validRequest();
      const result = await serviceWith(octokit).prepareFeatureBranch(request);

      expect(result.featureBranch).toBe(
        'feature/SCP-1234-create-aks-aks-scp-dev-ae-st-contoso',
      );
      expect(octokit.git.createRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'refs/heads/feature/SCP-1234-create-aks-aks-scp-dev-ae-st-contoso',
          sha: 'main-sha',
        }),
      );
      const [valuesCommit, workspaceCommit] =
        octokit.repos.createOrUpdateFileContents.mock.calls.map(
          (call: any[]) => call[0],
        );
      expect(valuesCommit.path).toBe(deriveAksNames(request).valuesFilePath);
      expect(Buffer.from(valuesCommit.content, 'base64').toString('utf8')).toBe(
        renderAksValuesFile(request, {
          created: new Date().toISOString().slice(0, 10),
        }),
      );
      expect(workspaceCommit.path).toBe('workspacemanager/workspaces.tfvars');
      expect(workspaceCommit.sha).toBe('ws-sha');
      expect(
        Buffer.from(workspaceCommit.content, 'base64').toString('utf8'),
      ).toContain('"aks-scp-dev-ae-st-contoso"    = {}');
      expect(valuesCommit.message).toBe(
        'SCP-1234: create AKS cluster aks-scp-dev-ae-st-contoso',
      );
    });

    it('never overwrites an existing cluster definition', async () => {
      const octokit = makeOctokit({ valuesExists: true });
      await expect(
        serviceWith(octokit).prepareFeatureBranch(validRequest()),
      ).rejects.toThrow(/already exists on main/);
      expect(octokit.git.createRef).not.toHaveBeenCalled();
      expect(octokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    });

    it('refuses an invalid request before any GitHub call', async () => {
      const octokit = makeOctokit();
      await expect(
        serviceWith(octokit).prepareFeatureBranch(
          validRequest({ tenantId: 'x' }),
        ),
      ).rejects.toThrow(/Invalid provisioning request/);
      expect(octokit.git.getRef).not.toHaveBeenCalled();
    });

    it('opens a PR into main describing the approved configuration, without dispatching any workflow', async () => {
      const octokit = makeOctokit();
      const result = await serviceWith(octokit).createPullRequest(
        validRequest(),
        'feature/SCP-1234-create-aks-aks-scp-dev-ae-st-contoso',
        {
          requestId: 'INFRA-1',
          configFingerprint: 'sha256:abc',
          approvals: [
            {
              role: 'Platform Team',
              approver: 'user:default/alice',
              decidedAt: '2026-10-13T10:00:00Z',
            },
          ],
        },
      );

      expect(result.prNumber).toBe(42);
      const pr = octokit.pulls.create.mock.calls[0][0];
      expect(pr.base).toBe('main');
      expect(pr.title).toBe(
        'SCP-1234: create AKS cluster aks-scp-dev-ae-st-contoso',
      );
      expect(pr.body).toContain('INFRA-1');
      expect(pr.body).toContain('sha256:abc');
      expect(pr.body).toContain('user:default/alice');
      // octokit.actions does not exist on the mock: any dispatch would throw.
      expect(octokit.actions).toBeUndefined();
    });

    it('never enables auto-merge or merges, whatever the environment says', async () => {
      process.env.CLOUDHUB_AUTO_MERGE_ENABLED = 'true';
      process.env.CLOUDHUB_AUTO_MERGE_METHOD = 'squash';
      const octokit = makeOctokit();
      (octokit.pulls as any).merge = jest.fn();
      await serviceWith(octokit).createPullRequest(validRequest(), 'feature/x');
      expect(octokit.graphql).not.toHaveBeenCalled();
      expect(octokit.pulls.merge).not.toHaveBeenCalled();
      delete process.env.CLOUDHUB_AUTO_MERGE_METHOD;
    });

    it('has no merge or auto-merge code path at all', () => {
      const source = fs.readFileSync(
        nodePath.resolve(
          __dirname,
          '../services/InfrastructureProvisioningService.ts',
        ),
        'utf8',
      );
      expect(source).not.toMatch(
        /enablePullRequestAutoMerge|mergePullRequest|pulls\.merge|autoMerge|AUTO_MERGE/,
      );
    });

    it('resumes an existing branch without committing again', async () => {
      const request = validRequest();
      const octokit = makeOctokit({
        branch: {
          // Rendered on an earlier day: only the created tag differs.
          values: renderAksValuesFile(request, { created: '2026-01-01' }),
          workspaces: insertAksWorkspaceEntry(
            WORKSPACES_FIXTURE,
            deriveAksNames(request).clusterName,
          ),
        },
      });
      const result = await serviceWith(octokit).prepareFeatureBranch(request);
      expect(result.reused).toBe(true);
      expect(octokit.git.createRef).not.toHaveBeenCalled();
      expect(octokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    });

    it('completes a partially prepared branch', async () => {
      const request = validRequest();
      const octokit = makeOctokit({
        branch: {
          values: renderAksValuesFile(request, { created: '2026-01-01' }),
        },
      });
      await serviceWith(octokit).prepareFeatureBranch(request);
      expect(octokit.git.createRef).not.toHaveBeenCalled();
      const paths = octokit.repos.createOrUpdateFileContents.mock.calls.map(
        (call: any[]) => call[0].path,
      );
      expect(paths).toEqual(['workspacemanager/workspaces.tfvars']);
    });

    it('refuses a branch whose values file differs from the approved configuration', async () => {
      const request = validRequest();
      const octokit = makeOctokit({
        branch: {
          values: renderAksValuesFile(
            { ...request, kubernetesVersion: '1.35.0' },
            { created: '2026-01-01' },
          ),
        },
      });
      await expect(
        serviceWith(octokit).prepareFeatureBranch(request),
      ).rejects.toThrow(/differs from the approved configuration/);
      expect(octokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    });

    it.each([
      [[{ number: 7, state: 'open' }], 7],
      [[{ number: 8, state: 'closed', merged_at: '2026-10-13T00:00:00Z' }], 8],
    ])(
      'adopts an existing PR (%j) instead of opening another',
      async (prs, number) => {
        const octokit = makeOctokit({ existingPrs: prs });
        const result = await serviceWith(octokit).createPullRequest(
          validRequest(),
          'feature/x',
        );
        expect(result).toMatchObject({ prNumber: number, reused: true });
        expect(octokit.pulls.create).not.toHaveBeenCalled();
      },
    );

    it('does not replace a PR that was closed without merging', async () => {
      const octokit = makeOctokit({
        existingPrs: [{ number: 9, state: 'closed', merged_at: null }],
      });
      await expect(
        serviceWith(octokit).createPullRequest(validRequest(), 'feature/x'),
      ).rejects.toThrow(/closed without merging/);
      expect(octokit.pulls.create).not.toHaveBeenCalled();
    });

    it('preflight only needs repository and main access', async () => {
      const octokit = makeOctokit();
      await expect(serviceWith(octokit).preflight()).resolves.toEqual({
        ok: true,
        mode: 'real',
      });
    });
  });
});
