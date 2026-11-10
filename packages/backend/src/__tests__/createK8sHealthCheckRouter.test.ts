import express from 'express';
import request from 'supertest';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { patchSupertestIpv4 } from '../test-utils/patchSupertestIpv4';
import { createK8sHealthCheckRouter } from '../createK8sHealthCheckRouter';

patchSupertestIpv4();

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

function createApp(
  runCommand?: (
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<{ stdout: string; stderr: string }>,
) {
  const app = express();
  app.use(
    createK8sHealthCheckRouter({
      logger: makeLogger(),
      runCommand,
    }),
  );
  return app;
}

describe('k8s health check router', () => {
  it('lists available test cases', async () => {
    const res = await request(createApp()).get(
      '/api/k8s-health-check/test-cases',
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.testCases)).toBe(true);
    expect(res.body.testCases.length).toBeGreaterThan(0);
    expect(res.body.testCases[0]).toHaveProperty('id');
    expect(res.body.testCases[0]).toHaveProperty('name');
  });

  it('returns 400 when no test case is selected', async () => {
    const res = await request(createApp())
      .post('/api/k8s-health-check/run')
      .send({ testCaseIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/At least one test case/i);
  });

  it('returns dry-run preview with full command details and does not execute', async () => {
    const runner = jest.fn(async () => ({ stdout: '', stderr: '' }));

    const res = await request(createApp(runner))
      .post('/api/k8s-health-check/run')
      .send({
        testCaseIds: ['api-reachable', 'nodes-ready'],
        clusterContext: 'aks-prod-eastus-001',
        dryRun: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.summary.mode).toBe('dry-run');
    expect(res.body.summary.total).toBe(2);
    expect(res.body.results).toEqual([]);
    expect(res.body.preview).toHaveLength(2);
    expect(res.body.preview[0].commandText).toContain(
      '--context aks-prod-eastus-001',
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it('executes selected checks and returns pass/fail summary', async () => {
    const runner = jest.fn(async (_command: string, args: string[]) => {
      if (args.includes('version')) {
        return {
          stdout: 'Client Version: v1.29.0\nServer Version: v1.29.1',
          stderr: '',
        };
      }

      if (args.includes('nodes')) {
        return {
          stdout: 'aks-nodepool-01 NotReady agent 20d v1.29.1',
          stderr: '',
        };
      }

      return { stdout: '', stderr: '' };
    });

    const res = await request(createApp(runner))
      .post('/api/k8s-health-check/run')
      .send({
        testCaseIds: ['api-reachable', 'nodes-ready'],
      });

    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(2);
    expect(res.body.summary.passed).toBe(1);
    expect(res.body.summary.failed).toBe(1);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].status).toBe('passed');
    expect(res.body.results[1].status).toBe('failed');
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
