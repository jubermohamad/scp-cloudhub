/**
 * Read-only GitHub and Terraform Cloud readers for AKS execution tracking and
 * submission preflight. Every call goes through ReadOnlyHttpClient, which can
 * only send GET (plus validated read queries), so nothing here can create,
 * merge, approve, dispatch, confirm, apply or modify anything.
 */

import {
  AKS_TFC_ORGANIZATION,
  AKS_TFC_WORKSPACE_MANAGER,
  aksTfcProjectForWorkspace,
  findAksWorkspaceEntry,
} from '@internal/plugin-platform-common/backend';
import {
  ExternalServiceError,
  ReadOnlyHttpClient,
  baseUrlFor,
  type FetchLike,
} from './readOnlyHttp';
import {
  GITHUB_ACTIONS_APP_ID,
  QUALITY_GATE_CHECK_NAME,
  mapQualityGate,
  mapRunStatus,
  type OutputFacts,
  type PullRequestFacts,
  type ReviewDecision,
  type TfcRunFacts,
  type WorkspaceFacts,
  type WorkspaceMappingFacts,
} from './aksExecutionStatus';

const GITHUB_API = 'https://api.github.com';
const TFC_API = 'https://app.terraform.io/api/v2';
const TFC_APP = 'https://app.terraform.io/app';

function splitRepository(repository: string): [string, string] {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!match) throw new Error(`Invalid repository '${repository}'`);
  return [match[1], match[2]];
}

const enc = encodeURIComponent;

// ─── GitHub ──────────────────────────────────────────────────────────────────

interface GithubPull {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft?: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { sha: string };
}

interface GithubReview {
  user: { login: string } | null;
  state: string;
  submitted_at?: string;
}

interface GithubCheckRun {
  status: string;
  conclusion: string | null;
  html_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  app?: { id: number } | null;
}

export class GithubReader {
  readonly client: ReadOnlyHttpClient;

  constructor(client: ReadOnlyHttpClient) {
    this.client = client;
  }

  static create(options: {
    token: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  }): GithubReader {
    return new GithubReader(
      new ReadOnlyHttpClient({
        service: 'github',
        baseUrl: baseUrlFor('CLOUDHUB_AKS_GITHUB_API_URL', GITHUB_API),
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'cloudhub-aks-tracking',
        },
        queryEndpoints: { '/graphql': 'graphql' },
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }),
    );
  }

  async readPullRequest(
    repository: string,
    number: number,
    now: string,
  ): Promise<PullRequestFacts> {
    const [owner, repo] = splitRepository(repository);
    const base = `/repos/${enc(owner)}/${enc(repo)}`;
    const pull = await this.client.get<GithubPull>(`${base}/pulls/${number}`);

    const reviews = await this.client.get<GithubReview[]>(
      `${base}/pulls/${number}/reviews?per_page=100`,
    );
    // Latest decisive review per reviewer (COMMENTED does not change it).
    const latest = new Map<string, string>();
    for (const review of reviews ?? []) {
      const login = review.user?.login;
      if (!login) continue;
      if (
        ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)
      ) {
        latest.set(login, review.state);
      }
    }
    const approvedBy = [...latest]
      .filter(([, s]) => s === 'APPROVED')
      .map(([l]) => l);
    const changesRequestedBy = [...latest]
      .filter(([, s]) => s === 'CHANGES_REQUESTED')
      .map(([l]) => l);

    // reviewDecision applies the branch rules (required CODEOWNERS review).
    const graph = await this.client.readQuery<{
      data?: {
        repository?: {
          pullRequest?: { reviewDecision?: ReviewDecision | null };
        };
      };
    }>('/graphql', {
      query:
        'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewDecision } } }',
      variables: { owner, name: repo, number },
    });
    const reviewDecision =
      graph?.data?.repository?.pullRequest?.reviewDecision ?? null;

    const checks = await this.client.get<{ check_runs: GithubCheckRun[] }>(
      `${base}/commits/${enc(pull.head.sha)}/check-runs?check_name=${enc(
        QUALITY_GATE_CHECK_NAME,
      )}&per_page=50`,
    );
    // Only the GitHub Actions check satisfies the ruleset; ignore look-alikes.
    const gate =
      (checks?.check_runs ?? [])
        .filter(run => run.app?.id === GITHUB_ACTIONS_APP_ID)
        .sort(
          (a, b) =>
            Date.parse(b.started_at ?? '') - Date.parse(a.started_at ?? ''),
        )[0] ?? null;

    const combined = await this.client.get<{
      statuses: Array<{
        context: string;
        state: string;
        target_url: string | null;
      }>;
    }>(`${base}/commits/${enc(pull.head.sha)}/status`);
    const speculativePlans = (combined?.statuses ?? [])
      .filter(status => status.context.startsWith('Terraform Cloud/'))
      .map(status => ({
        context: status.context,
        state: status.state,
        url: status.target_url,
      }));

    return {
      repository,
      number: pull.number,
      url: pull.html_url,
      state: pull.state,
      merged: Boolean(pull.merged),
      draft: Boolean(pull.draft),
      mergedAt: pull.merged_at,
      mergeCommitSha: pull.merge_commit_sha,
      headSha: pull.head.sha,
      reviewDecision,
      approvedBy,
      changesRequestedBy,
      qualityGate: mapQualityGate(gate),
      speculativePlans,
      observedAt: now,
    };
  }

  /** File contents at a ref, or null when the file does not exist there. */
  async readFile(
    repository: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    const [owner, repo] = splitRepository(repository);
    try {
      const file = await this.client.get<{
        content?: string;
        encoding?: string;
      }>(
        `/repos/${enc(owner)}/${enc(repo)}/contents/${path
          .split('/')
          .map(enc)
          .join('/')}?ref=${enc(ref)}`,
      );
      if (!file?.content) return '';
      return Buffer.from(file.content, 'base64').toString('utf8');
    } catch (error) {
      if (error instanceof ExternalServiceError && error.kind === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Confirm from the merged commit what workspacemanager will create: the
   * workspaces.tfvars entry (and any reviewer-added overrides) and the values
   * file the workspace's TF_CLI_ARGS will point at.
   */
  async readMergedMapping(input: {
    repository: string;
    commitSha: string;
    workspacesFile: string;
    valuesFile: string;
    workspaceName: string;
    now: string;
  }): Promise<WorkspaceMappingFacts> {
    const workspaces = await this.readFile(
      input.repository,
      input.workspacesFile,
      input.commitSha,
    );
    const values = await this.readFile(
      input.repository,
      input.valuesFile,
      input.commitSha,
    );
    const entry =
      workspaces === null
        ? null
        : findAksWorkspaceEntry(workspaces, input.workspaceName);
    const projectNameOverride =
      entry?.body?.match(/project_name_override\s*=\s*"([^"]+)"/)?.[1] ?? null;
    const vcsBranchOverride =
      entry?.body?.match(/vcs_branch\s*=\s*"([^"]+)"/)?.[1] ?? null;
    return {
      commitSha: input.commitSha,
      workspacesFileHasEntry: Boolean(entry),
      valuesFilePresent: values !== null,
      entryOverrides: entry?.body ?? null,
      projectNameOverride,
      vcsBranchOverride,
      expectedProject: aksTfcProjectForWorkspace(
        input.workspaceName,
        projectNameOverride,
      ),
      observedAt: input.now,
    };
  }

  async repositoryAccess(repository: string): Promise<{
    push: boolean;
    archived: boolean;
    defaultBranch: string;
  }> {
    const [owner, repo] = splitRepository(repository);
    const data = await this.client.get<{
      archived: boolean;
      default_branch: string;
      permissions?: { push?: boolean };
    }>(`/repos/${enc(owner)}/${enc(repo)}`);
    return {
      push: Boolean(data.permissions?.push),
      archived: Boolean(data.archived),
      defaultBranch: data.default_branch,
    };
  }

  async branchHead(repository: string, branch: string): Promise<string> {
    const [owner, repo] = splitRepository(repository);
    const ref = await this.client.get<{ object: { sha: string } }>(
      `/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${enc(branch)}`,
    );
    return ref.object.sha;
  }

  async listTree(
    repository: string,
    sha: string,
  ): Promise<{ paths: string[]; truncated: boolean }> {
    const [owner, repo] = splitRepository(repository);
    const tree = await this.client.get<{
      tree: Array<{ path: string; type: string }>;
      truncated: boolean;
    }>(`/repos/${enc(owner)}/${enc(repo)}/git/trees/${enc(sha)}?recursive=1`);
    return {
      paths: tree.tree
        .filter(item => item.type === 'blob')
        .map(item => item.path),
      truncated: tree.truncated,
    };
  }
}

// ─── Terraform Cloud ─────────────────────────────────────────────────────────

interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, any>;
  relationships?: Record<
    string,
    { data?: { id: string; type: string } | null }
  >;
}

interface JsonApiDocument<T> {
  data: T;
  included?: JsonApiResource[];
}

/**
 * Non-sensitive outputs of azure-kubernetes-service-standard/outputs.tf that
 * CloudHub records. kube_config (sensitive) and diagnostic logs are never read.
 */
export const AKS_RECORDED_OUTPUTS = [
  'aks_cluster_id',
  'cluster_fqdn',
  'default_node_pool',
  'extra_node_pools',
  'identity_principal_id',
  'kubelet_identity_object_id',
  'velero_storage_account_name',
  'velero_storage_container_name',
  'netapp_account_name',
  'netapp_pool_name',
  'des_id',
  'des_principal_id',
  'uami_id',
];

export class TerraformCloudReader {
  readonly client: ReadOnlyHttpClient;
  readonly organization: string;

  constructor(client: ReadOnlyHttpClient, organization = AKS_TFC_ORGANIZATION) {
    this.client = client;
    this.organization = organization;
  }

  static create(options: {
    token: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  }): TerraformCloudReader {
    return new TerraformCloudReader(
      new ReadOnlyHttpClient({
        service: 'terraform-cloud',
        baseUrl: baseUrlFor('CLOUDHUB_AKS_TFC_API_URL', TFC_API),
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.api+json',
        },
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }),
    );
  }

  workspaceUrl(name: string): string {
    return `${TFC_APP}/${this.organization}/workspaces/${name}`;
  }

  runUrl(workspaceName: string, runId: string): string {
    return `${this.workspaceUrl(workspaceName)}/runs/${runId}`;
  }

  /** The workspace, or null when it does not exist (404). */
  async findWorkspace(
    name: string,
    now: string,
    expected?: {
      project: string;
      workingDirectory: string;
      repository: string;
      branch: string;
    },
  ): Promise<WorkspaceFacts | null> {
    let doc: JsonApiDocument<JsonApiResource>;
    try {
      doc = await this.client.get(
        `/organizations/${enc(this.organization)}/workspaces/${enc(
          name,
        )}?include=project`,
      );
    } catch (error) {
      if (error instanceof ExternalServiceError && error.kind === 'not_found') {
        return null;
      }
      throw error;
    }
    const attrs = doc.data.attributes;
    const projectId = doc.data.relationships?.project?.data?.id;
    const project = doc.included?.find(
      item => item.type === 'projects' && item.id === projectId,
    );
    const facts: WorkspaceFacts = {
      id: doc.data.id,
      name: attrs.name,
      url: this.workspaceUrl(attrs.name),
      createdAt: attrs['created-at'],
      projectName: project?.attributes?.name ?? null,
      workingDirectory: attrs['working-directory'] ?? null,
      vcsRepo: attrs['vcs-repo']?.identifier ?? null,
      vcsBranch: attrs['vcs-repo']?.branch || null,
      autoApply: Boolean(attrs['auto-apply']),
      currentRunId: doc.data.relationships?.['current-run']?.data?.id ?? null,
      currentStateVersionId:
        doc.data.relationships?.['current-state-version']?.data?.id ?? null,
      mismatches: [],
      observedAt: now,
    };
    if (expected) {
      if (facts.projectName !== expected.project) {
        facts.mismatches.push(
          `project is ${facts.projectName ?? 'unknown'}, expected ${
            expected.project
          }`,
        );
      }
      if (facts.workingDirectory !== expected.workingDirectory) {
        facts.mismatches.push(
          `working directory is ${
            facts.workingDirectory ?? 'unset'
          }, expected ${expected.workingDirectory}`,
        );
      }
      if (facts.vcsRepo !== expected.repository) {
        facts.mismatches.push(
          `VCS repository is ${facts.vcsRepo ?? 'unset'}, expected ${
            expected.repository
          }`,
        );
      }
      // An empty branch means the repository default branch (main).
      if ((facts.vcsBranch ?? 'main') !== expected.branch) {
        facts.mismatches.push(
          `VCS branch is ${facts.vcsBranch}, expected ${expected.branch}`,
        );
      }
      if (facts.autoApply) {
        facts.mismatches.push(
          'auto-apply is enabled; the agreed process requires operator confirmation',
        );
      }
    }
    return facts;
  }

  async workspaceId(name: string): Promise<string | null> {
    const ws = await this.findWorkspace(name, new Date().toISOString());
    return ws?.id ?? null;
  }

  private toRun(
    resource: JsonApiResource,
    workspaceName: string,
    included: JsonApiResource[],
    now: string,
  ): TfcRunFacts {
    const attrs = resource.attributes;
    const statusTimestamps = (attrs['status-timestamps'] ?? {}) as Record<
      string,
      string
    >;
    const isConfirmable = Boolean(attrs.actions?.['is-confirmable']);
    const cvId = resource.relationships?.['configuration-version']?.data?.id;
    const cv = included.find(
      item => item.type === 'configuration-versions' && item.id === cvId,
    );
    const ingressId = cv?.relationships?.['ingress-attributes']?.data?.id;
    const ingress = included.find(
      item => item.type === 'ingress-attributes' && item.id === ingressId,
    );
    const counts = (type: string, rel: string) => {
      const id = resource.relationships?.[rel]?.data?.id;
      const item = included.find(i => i.type === type && i.id === id);
      return item
        ? {
            status: item.attributes.status ?? null,
            additions: item.attributes['resource-additions'] ?? null,
            changes: item.attributes['resource-changes'] ?? null,
            destructions: item.attributes['resource-destructions'] ?? null,
          }
        : null;
    };
    return {
      id: resource.id,
      workspaceName,
      url: this.runUrl(workspaceName, resource.id),
      status: attrs.status,
      phase: mapRunStatus({
        status: attrs.status,
        isConfirmable,
        statusTimestamps,
      }),
      isConfirmable,
      hasChanges:
        typeof attrs['has-changes'] === 'boolean' ? attrs['has-changes'] : null,
      isDestroy: Boolean(attrs['is-destroy']),
      createdAt: attrs['created-at'],
      statusTimestamps,
      commitSha: ingress?.attributes?.['commit-sha'] ?? null,
      message: attrs.message ?? null,
      plan: counts('plans', 'plan'),
      apply: counts('applies', 'apply'),
      observedAt: now,
    };
  }

  /** Recent runs (newest first), excluding plan-only (speculative) runs. */
  async listRuns(
    workspaceId: string,
    workspaceName: string,
    now: string,
  ): Promise<TfcRunFacts[]> {
    const doc = await this.client.get<JsonApiDocument<JsonApiResource[]>>(
      `/workspaces/${enc(
        workspaceId,
      )}/runs?page%5Bsize%5D=20&include=configuration_version.ingress_attributes`,
    );
    const included = doc.included ?? [];
    return (doc.data ?? [])
      .filter(run => !run.attributes['plan-only'])
      .map(run => this.toRun(run, workspaceName, included, now));
  }

  async readRun(
    runId: string,
    workspaceName: string,
    now: string,
  ): Promise<TfcRunFacts> {
    const doc = await this.client.get<JsonApiDocument<JsonApiResource>>(
      `/runs/${enc(
        runId,
      )}?include=plan,apply,configuration_version.ingress_attributes`,
    );
    return this.toRun(doc.data, workspaceName, doc.included ?? [], now);
  }

  /**
   * Current state outputs (allow-listed, non-sensitive), or null when the
   * workspace has no state yet. Needs only the "read state outputs"
   * permission: the state version itself is never fetched.
   */
  async readOutputs(
    workspace: WorkspaceFacts,
    now: string,
  ): Promise<OutputFacts | null> {
    if (!workspace.currentStateVersionId) return null;
    const outputs = await this.client.get<JsonApiDocument<JsonApiResource[]>>(
      `/workspaces/${enc(workspace.id)}/current-state-version-outputs`,
    );
    const values: Record<string, unknown> = {};
    const omitted: string[] = [];
    for (const output of outputs.data ?? []) {
      const { name, sensitive, value } = output.attributes;
      if (sensitive || !AKS_RECORDED_OUTPUTS.includes(name)) {
        omitted.push(name);
        continue;
      }
      values[name] = value ?? null;
    }
    return {
      stateVersionId: workspace.currentStateVersionId,
      runId: workspace.currentRunId,
      values,
      omitted: omitted.sort(),
      observedAt: now,
    };
  }
}

export const WORKSPACE_MANAGER_WORKSPACE = AKS_TFC_WORKSPACE_MANAGER;
