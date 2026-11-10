/**
 * In-memory fake of the GitHub REST/GraphQL and Terraform Cloud API surface
 * used by AKS execution tracking and submission gates. It answers through the
 * FetchLike interface ReadOnlyHttpClient uses, records every request, and is
 * mutated by tests to simulate external state changes. No network access.
 */

import type { FetchLike, FetchResponseLike } from '../services/readOnlyHttp';

export interface RecordedCall {
  method: string;
  url: string;
  body?: string;
}

export interface FakeTfcRun {
  id: string;
  status: string;
  createdAt: string;
  confirmable?: boolean;
  timestamps?: Record<string, string>;
  commitSha?: string | null;
  isDestroy?: boolean;
  planOnly?: boolean;
  hasChanges?: boolean;
  plan?: { status: string; add: number; change: number; destroy: number };
  apply?: { status: string; add: number; change: number; destroy: number };
}

export interface FakeWorkspace {
  id: string;
  name: string;
  createdAt: string;
  projectName: string;
  workingDirectory: string;
  vcsRepo: string;
  vcsBranch: string;
  autoApply?: boolean;
}

export interface FakeState {
  pulls: Record<
    number,
    {
      state: 'open' | 'closed';
      merged: boolean;
      mergedAt?: string | null;
      mergeCommitSha?: string | null;
      headSha: string;
      draft?: boolean;
    }
  >;
  reviews: Record<number, Array<{ login: string; state: string }>>;
  reviewDecision: Record<number, string | null>;
  /** check runs by head sha */
  checkRuns: Record<
    string,
    Array<{
      status: string;
      conclusion: string | null;
      appId?: number;
      startedAt?: string;
    }>
  >;
  statuses: Record<string, Array<{ context: string; state: string }>>;
  /** `${ref}:${path}` → file content */
  files: Record<string, string>;
  mainSha: string;
  tree: Record<string, { paths: string[]; truncated?: boolean }>;
  repoAccess: Record<string, { push: boolean; archived: boolean }>;
  workspaces: Record<string, FakeWorkspace>;
  /** workspace id → runs (any order) */
  runs: Record<string, FakeTfcRun[]>;
  stateVersions: Record<
    string,
    { id: string; createdAt: string; runId: string | null }
  >;
  outputs: Record<
    string,
    Array<{ name: string; sensitive: boolean; value: unknown }>
  >;
  /** Force a failure for matching URLs. */
  fail?: (url: string) => number | 'timeout' | 'network' | undefined;
}

export function emptyFakeState(): FakeState {
  return {
    pulls: {},
    reviews: {},
    reviewDecision: {},
    checkRuns: {},
    statuses: {},
    files: {},
    mainSha: 'main0000',
    tree: {},
    repoAccess: {},
    workspaces: {},
    runs: {},
    stateVersions: {},
    outputs: {},
  };
}

function response(status: number, body: unknown): FetchResponseLike {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => text,
  };
}

const notFound = () => response(404, { message: 'Not Found' });

function runResource(run: FakeTfcRun) {
  return {
    id: run.id,
    type: 'runs',
    attributes: {
      status: run.status,
      'created-at': run.createdAt,
      'status-timestamps': run.timestamps ?? {},
      'has-changes': run.hasChanges ?? true,
      'is-destroy': Boolean(run.isDestroy),
      'plan-only': Boolean(run.planOnly),
      actions: { 'is-confirmable': Boolean(run.confirmable) },
      message: `run ${run.id}`,
    },
    relationships: {
      'configuration-version': {
        data: { id: `cv-${run.id}`, type: 'configuration-versions' },
      },
      plan: { data: { id: `plan-${run.id}`, type: 'plans' } },
      apply: { data: { id: `apply-${run.id}`, type: 'applies' } },
    },
  };
}

function runIncluded(run: FakeTfcRun) {
  const included: any[] = [
    {
      id: `cv-${run.id}`,
      type: 'configuration-versions',
      attributes: {},
      relationships: {
        'ingress-attributes': {
          data: { id: `ia-${run.id}`, type: 'ingress-attributes' },
        },
      },
    },
    {
      id: `ia-${run.id}`,
      type: 'ingress-attributes',
      attributes: { 'commit-sha': run.commitSha ?? null },
    },
  ];
  if (run.plan) {
    included.push({
      id: `plan-${run.id}`,
      type: 'plans',
      attributes: {
        status: run.plan.status,
        'resource-additions': run.plan.add,
        'resource-changes': run.plan.change,
        'resource-destructions': run.plan.destroy,
      },
    });
  }
  if (run.apply) {
    included.push({
      id: `apply-${run.id}`,
      type: 'applies',
      attributes: {
        status: run.apply.status,
        'resource-additions': run.apply.add,
        'resource-changes': run.apply.change,
        'resource-destructions': run.apply.destroy,
      },
    });
  }
  return included;
}

export function createFakeExternalApis(state: FakeState): {
  fetch: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  /** TFC current-run: the workspace's newest non-speculative run. */
  const currentRun = (workspaceId: string) => {
    const newest = [...(state.runs[workspaceId] ?? [])]
      .filter(run => !run.planOnly)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return { data: newest ? { id: newest.id, type: 'runs' } : null };
  };

  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, body: init.body });
    const forced = state.fail?.(url);
    if (forced === 'timeout') {
      // Never resolves on its own; the client's abort must end it.
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    }
    if (forced === 'network') throw new Error('ECONNREFUSED');
    if (typeof forced === 'number')
      return response(forced, { message: 'forced' });

    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    const query = parsed.searchParams;

    // ── GitHub ──
    if (parsed.hostname === 'api.github.com') {
      if (init.method === 'POST' && path === '/graphql') {
        const body = JSON.parse(init.body ?? '{}');
        const decision = state.reviewDecision[body.variables?.number] ?? null;
        return response(200, {
          data: { repository: { pullRequest: { reviewDecision: decision } } },
        });
      }
      if (init.method !== 'GET') return response(405, {});
      let m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/.exec(path);
      if (m) {
        const pull = state.pulls[Number(m[3])];
        if (!pull) return notFound();
        return response(200, {
          number: Number(m[3]),
          html_url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`,
          state: pull.state,
          merged: pull.merged,
          draft: Boolean(pull.draft),
          merged_at: pull.mergedAt ?? null,
          merge_commit_sha: pull.mergeCommitSha ?? null,
          head: { sha: pull.headSha },
        });
      }
      m = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/reviews$/.exec(path);
      if (m) {
        return response(
          200,
          (state.reviews[Number(m[1])] ?? []).map(r => ({
            user: { login: r.login },
            state: r.state,
          })),
        );
      }
      m = /^\/repos\/[^/]+\/[^/]+\/commits\/([^/]+)\/check-runs$/.exec(path);
      if (m) {
        const name = query.get('check_name');
        return response(200, {
          check_runs: (state.checkRuns[m[1]] ?? []).map(c => ({
            name,
            status: c.status,
            conclusion: c.conclusion,
            html_url: `https://github.com/checks/${m![1]}`,
            started_at: c.startedAt ?? '2026-10-13T00:00:00Z',
            completed_at:
              c.status === 'completed' ? '2026-10-13T00:05:00Z' : null,
            app: { id: c.appId ?? 15368 },
          })),
        });
      }
      m = /^\/repos\/[^/]+\/[^/]+\/commits\/([^/]+)\/status$/.exec(path);
      if (m) {
        return response(200, {
          statuses: (state.statuses[m[1]] ?? []).map(s => ({
            ...s,
            target_url: null,
          })),
        });
      }
      m = /^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/.exec(path);
      if (m) {
        const content = state.files[`${query.get('ref')}:${m[1]}`];
        if (content === undefined) return notFound();
        return response(200, {
          content: Buffer.from(content).toString('base64'),
          encoding: 'base64',
        });
      }
      m = /^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/.exec(path);
      if (m) return response(200, { object: { sha: state.mainSha } });
      m = /^\/repos\/[^/]+\/[^/]+\/git\/trees\/([^/]+)$/.exec(path);
      if (m) {
        const tree = state.tree[m[1]];
        if (!tree) return notFound();
        return response(200, {
          tree: tree.paths.map(p => ({ path: p, type: 'blob' })),
          truncated: Boolean(tree.truncated),
        });
      }
      m = /^\/repos\/([^/]+\/[^/]+)$/.exec(path);
      if (m) {
        const access = state.repoAccess[m[1]];
        if (!access) return notFound();
        return response(200, {
          archived: access.archived,
          default_branch: 'main',
          permissions: { push: access.push },
        });
      }
      return notFound();
    }

    // ── Terraform Cloud ──
    if (parsed.hostname === 'app.terraform.io') {
      if (init.method !== 'GET') return response(405, {});
      let m = /^\/api\/v2\/organizations\/[^/]+\/workspaces\/([^/]+)$/.exec(
        path,
      );
      if (m) {
        const ws = state.workspaces[m[1]];
        if (!ws) return notFound();
        return response(200, {
          data: {
            id: ws.id,
            type: 'workspaces',
            attributes: {
              name: ws.name,
              'created-at': ws.createdAt,
              'auto-apply': Boolean(ws.autoApply),
              'working-directory': ws.workingDirectory,
              'vcs-repo': { identifier: ws.vcsRepo, branch: ws.vcsBranch },
            },
            relationships: {
              project: { data: { id: `prj-${ws.id}`, type: 'projects' } },
              'current-run': currentRun(ws.id),
              'current-state-version': state.stateVersions[ws.id]
                ? {
                    data: {
                      id: state.stateVersions[ws.id].id,
                      type: 'state-versions',
                    },
                  }
                : { data: null },
            },
          },
          included: [
            {
              id: `prj-${ws.id}`,
              type: 'projects',
              attributes: { name: ws.projectName },
            },
          ],
        });
      }
      m = /^\/api\/v2\/workspaces\/([^/]+)\/runs$/.exec(path);
      if (m) {
        const runs = [...(state.runs[m[1]] ?? [])].sort(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
        );
        return response(200, {
          data: runs.map(runResource),
          included: runs.flatMap(runIncluded),
        });
      }
      m = /^\/api\/v2\/runs\/([^/]+)$/.exec(path);
      if (m) {
        const run = Object.values(state.runs)
          .flat()
          .find(r => r.id === m![1]);
        if (!run) return notFound();
        return response(200, {
          data: runResource(run),
          included: runIncluded(run),
        });
      }
      m = /^\/api\/v2\/workspaces\/([^/]+)\/current-state-version$/.exec(path);
      if (m) {
        const sv = state.stateVersions[m[1]];
        if (!sv) return notFound();
        return response(200, {
          data: {
            id: sv.id,
            type: 'state-versions',
            attributes: { 'created-at': sv.createdAt },
            relationships: {
              run: { data: sv.runId ? { id: sv.runId, type: 'runs' } : null },
            },
          },
        });
      }
      m =
        /^\/api\/v2\/workspaces\/([^/]+)\/current-state-version-outputs$/.exec(
          path,
        );
      if (m) {
        return response(200, {
          data: (state.outputs[m[1]] ?? []).map((o, i) => ({
            id: `wsout-${i}`,
            type: 'state-version-outputs',
            attributes: o,
          })),
        });
      }
      return notFound();
    }

    return notFound();
  };

  return { fetch, calls };
}

/** Paths that would mutate GitHub or Terraform Cloud if ever requested. */
export const WRITE_ENDPOINT_PATTERNS: RegExp[] = [
  /\/merge$/,
  /\/reviews\/\d+\/(events|dismissals)$/,
  /\/actions\/workflows\/.+\/dispatches$/,
  /\/dispatches$/,
  /\/runs\/[^/]+\/actions\/(apply|discard|cancel|force-cancel|force-execute)$/,
  /\/api\/v2\/runs$/,
  /\/workspaces\/[^/]+\/actions\//,
  /\/configuration-versions$/,
  /\/git\/refs$/,
  /\/pulls$/,
];

/** Assert every recorded call was a read. */
export function assertReadOnly(calls: RecordedCall[]): void {
  for (const call of calls) {
    const path = new URL(call.url).pathname;
    if (call.method === 'GET') {
      if (WRITE_ENDPOINT_PATTERNS.some(p => p.test(path))) {
        throw new Error(`GET to a write endpoint path: ${call.url}`);
      }
      continue;
    }
    if (call.method === 'POST' && path === '/graphql') {
      const body = JSON.parse(call.body ?? '{}');
      if (!/^\s*query\b/.test(body.query) || /\bmutation\b/i.test(body.query)) {
        throw new Error(`Non-query GraphQL request: ${body.query}`);
      }
      continue;
    }
    if (
      call.method === 'POST' &&
      path === '/providers/Microsoft.ResourceGraph/resources'
    ) {
      continue;
    }
    throw new Error(`Write-capable request: ${call.method} ${call.url}`);
  }
}
