import { Router, json as expressJson } from 'express';
import { execFile } from 'node:child_process';
import type { LoggerService } from '@backstage/backend-plugin-api';

export interface K8sHealthCheckRouterDeps {
  logger: LoggerService;
  runCommand?: (
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<{ stdout: string; stderr: string }>;
}

type TestCaseId =
  | 'api-reachable'
  | 'nodes-ready'
  | 'system-pods-ready'
  | 'argocd-apps-synced'
  | 'ootb-apps-present';

interface HealthCheckCase {
  id: TestCaseId;
  name: string;
  description: string;
  command: string;
  args: string[];
  timeoutMs: number;
}

interface RunResult {
  id: TestCaseId;
  name: string;
  status: 'passed' | 'failed' | 'preview';
  durationMs: number;
  command: string;
  stdout: string;
  stderr: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 90_000;

const TEST_CASES: HealthCheckCase[] = [
  {
    id: 'api-reachable',
    name: 'Kubernetes API Reachability',
    description: 'Verifies the target cluster API can be queried via kubectl.',
    command: 'kubectl',
    args: ['version', '--short'],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  {
    id: 'nodes-ready',
    name: 'All Nodes Ready',
    description: 'Fails if one or more nodes are not in Ready status.',
    command: 'kubectl',
    args: ['get', 'nodes', '--no-headers'],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  {
    id: 'system-pods-ready',
    name: 'Core System Pods Healthy',
    description: 'Checks kube-system pods are running or completed.',
    command: 'kubectl',
    args: ['get', 'pods', '-n', 'kube-system', '--no-headers'],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  {
    id: 'argocd-apps-synced',
    name: 'Argo CD Applications Synced',
    description: 'Checks Argo CD applications are Synced and Healthy.',
    command: 'kubectl',
    args: [
      'get',
      'applications.argoproj.io',
      '-n',
      'argocd',
      '-o',
      'jsonpath={range .items[*]}{.metadata.name}{"|"}{.status.sync.status}{"|"}{.status.health.status}{"\\n"}{end}',
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  {
    id: 'ootb-apps-present',
    name: 'Out-of-the-Box App Footprint',
    description:
      'Validates baseline namespaces/apps expected after cluster bootstrap.',
    command: 'kubectl',
    args: ['get', 'deployments', '-A', '--no-headers'],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
];

function sanitizeOutput(text: string): string {
  return text.length > 12_000
    ? `${text.slice(0, 12_000)}\n... truncated ...`
    : text;
}

function runExec(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject({ error, stdout, stderr });
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function evaluateResult(
  testCase: HealthCheckCase,
  stdout: string,
): { status: 'passed' | 'failed'; reason?: string } {
  const lines = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (testCase.id === 'nodes-ready') {
    const nonReady = lines.filter(line => !line.includes(' Ready '));
    return nonReady.length > 0
      ? {
          status: 'failed',
          reason: `Found ${nonReady.length} non-ready node(s)`,
        }
      : { status: 'passed' };
  }

  if (testCase.id === 'system-pods-ready') {
    const bad = lines.filter(
      line => !line.includes(' Running ') && !line.includes(' Completed '),
    );
    return bad.length > 0
      ? {
          status: 'failed',
          reason: `Found ${bad.length} unhealthy kube-system pod(s)`,
        }
      : { status: 'passed' };
  }

  if (testCase.id === 'argocd-apps-synced') {
    const bad = lines.filter(line => {
      const parts = line.split('|');
      const syncStatus = parts[1] ?? '';
      const healthStatus = parts[2] ?? '';
      return syncStatus !== 'Synced' || healthStatus !== 'Healthy';
    });
    return bad.length > 0
      ? {
          status: 'failed',
          reason: `Found ${bad.length} out-of-sync/unhealthy Argo CD app(s)`,
        }
      : { status: 'passed' };
  }

  if (testCase.id === 'ootb-apps-present') {
    const expectedNamespaces = [
      'argocd',
      'ingress-nginx',
      'monitoring',
      'external-secrets',
    ];
    const missing = expectedNamespaces.filter(
      ns => !lines.some(line => line.startsWith(`${ns} `)),
    );
    return missing.length > 0
      ? {
          status: 'failed',
          reason: `Missing expected baseline namespaces: ${missing.join(', ')}`,
        }
      : { status: 'passed' };
  }

  return { status: 'passed' };
}

async function runCase(
  testCase: HealthCheckCase,
  runner: (
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<{ stdout: string; stderr: string }>,
  clusterContext?: string,
): Promise<RunResult> {
  const started = Date.now();
  const args = clusterContext
    ? ['--context', clusterContext, ...testCase.args]
    : [...testCase.args];
  const commandText = `${testCase.command} ${args.join(' ')}`;

  try {
    const { stdout, stderr } = await runner(
      testCase.command,
      args,
      testCase.timeoutMs,
    );
    const evaluation = evaluateResult(testCase, stdout);
    return {
      id: testCase.id,
      name: testCase.name,
      status: evaluation.status,
      durationMs: Date.now() - started,
      command: commandText,
      stdout: sanitizeOutput(stdout),
      stderr: sanitizeOutput(stderr),
      error: evaluation.reason,
    };
  } catch (failure: any) {
    const error = failure?.error;
    const message =
      error instanceof Error
        ? error.message
        : String(error ?? 'Unknown execution error');
    return {
      id: testCase.id,
      name: testCase.name,
      status: 'failed',
      durationMs: Date.now() - started,
      command: commandText,
      stdout: sanitizeOutput(String(failure?.stdout ?? '')),
      stderr: sanitizeOutput(String(failure?.stderr ?? '')),
      error: message,
    };
  }
}

export function createK8sHealthCheckRouter(
  deps: K8sHealthCheckRouterDeps,
): Router {
  const { logger } = deps;
  const runner = deps.runCommand ?? runExec;
  const router = Router();
  router.use(expressJson());

  router.get('/api/k8s-health-check/test-cases', (_req, res) => {
    res.json({
      testCases: TEST_CASES.map(({ id, name, description }) => ({
        id,
        name,
        description,
      })),
    });
  });

  router.post('/api/k8s-health-check/run', async (req, res) => {
    const selectedIds = Array.isArray(req.body?.testCaseIds)
      ? (req.body.testCaseIds as string[])
      : [];
    const clusterContext =
      typeof req.body?.clusterContext === 'string'
        ? req.body.clusterContext.trim()
        : '';
    const dryRun = req.body?.dryRun === true;

    if (selectedIds.length === 0) {
      res
        .status(400)
        .json({ error: 'At least one test case must be selected' });
      return;
    }

    const selectedCases = TEST_CASES.filter(tc => selectedIds.includes(tc.id));
    if (selectedCases.length === 0) {
      res.status(400).json({ error: 'Selected test cases are invalid' });
      return;
    }

    logger.info(
      `[k8s-health-check] ${dryRun ? 'Previewing' : 'Running'} ${
        selectedCases.length
      } test(s)` + `${clusterContext ? ` for context ${clusterContext}` : ''}`,
    );

    if (dryRun) {
      const preview = selectedCases.map(testCase => {
        const args = clusterContext
          ? ['--context', clusterContext, ...testCase.args]
          : [...testCase.args];
        return {
          id: testCase.id,
          name: testCase.name,
          description: testCase.description,
          command: testCase.command,
          args,
          timeoutMs: testCase.timeoutMs,
          commandText: `${testCase.command} ${args.join(' ')}`,
        };
      });

      res.json({
        summary: {
          total: preview.length,
          passed: 0,
          failed: 0,
          mode: 'dry-run',
          startedAt: new Date().toISOString(),
        },
        preview,
        results: [],
      });
      return;
    }

    const results: RunResult[] = [];
    for (const testCase of selectedCases) {
      // Run sequentially so cluster/API load stays controlled and logs stay readable.
      // eslint-disable-next-line no-await-in-loop
      const result = await runCase(
        testCase,
        runner,
        clusterContext || undefined,
      );
      results.push(result);
    }

    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.length - passed;

    res.json({
      summary: {
        total: results.length,
        passed,
        failed,
        startedAt: new Date().toISOString(),
      },
      results,
    });
  });

  return router;
}
