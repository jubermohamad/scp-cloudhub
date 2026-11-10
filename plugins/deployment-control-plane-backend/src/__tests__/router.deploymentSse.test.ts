import express from 'express';
import request from 'supertest';
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { patchSupertestIpv4 } from 'backend/src/test-utils/patchSupertestIpv4';
import { createControlPlaneRouter } from '../router';

patchSupertestIpv4();

function buildSseApp() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const events = new Map<string, any[]>();
  const status = new Map<string, any>();
  const service = {
    getPortalDeployment: jest.fn(async (id: string) => ({ id })),
    getPortalDeploymentEvents: jest.fn(async (id: string) => events.get(id) ?? []),
    getPortalDeploymentStatus: jest.fn(async (id: string) => status.get(id)),
    onDeploymentEvent: jest.fn((id: string, listener: (event: any) => void) => {
      const set = listeners.get(id) ?? new Set();
      set.add(listener);
      listeners.set(id, set);
      return () => set.delete(listener);
    }),
  } as any;
  const auth = {
    credentials: jest.fn(async () => ({ principal: { type: 'user' }, groups: ['group:default/cloudhubappeng'] })),
  } as any;
  const userInfo = {
    getUserInfo: jest.fn(async () => ({ userEntityRef: 'user:default/test', ownershipEntityRefs: ['group:default/cloudhubappeng'] })),
  } as any;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() } as any;
  const router = createControlPlaneRouter({
    logger,
    httpAuth: auth,
    userInfo,
    service,
    gitHubAuthorizationService: {} as any,
    gitHubRepositoryService: {} as any,
  });
  const app = express();
  app.use(router);
  return {
    app,
    service,
    emit(id: string, event: any) {
      events.set(id, [...(events.get(id) ?? []), event]);
      for (const listener of listeners.get(id) ?? []) listener(event);
    },
    seed(id: string, initialEvents: any[], currentStatus: any) {
      events.set(id, initialEvents);
      status.set(id, currentStatus);
    },
  };
}

async function connect(app: express.Express, id: string, waitFor?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const test = request(app)
      .get(`/deployments/${id}/logs/stream`)
      .set('x-groups', 'group:default/cloudhubappeng')
      .buffer(false)
      .parse((response, callback) => {
        let body = '';
        response.on('data', chunk => {
          body += chunk.toString();
          if (!settled && body.includes('\n\n') && (!waitFor || body.includes(waitFor))) {
            settled = true;
            (response as any).destroy();
            callback(null, body);
            resolve(body);
          }
        });
        response.on('error', error => {
          if (!settled) reject(error);
        });
      });
    test.end(error => {
      if (error && !settled) reject(error);
    });
  });
}

describe('deployment SSE reconnect and isolation', () => {
  it('reconnects with current state and subsequent events', async () => {
    const fixture = buildSseApp();
    fixture.seed('a', [{ id: 'a-1', eventType: 'log', note: 'initial-a' }], {
      deploymentId: 'a', workflowRunId: null, status: 'PENDING_APPROVAL', currentStep: 'Awaiting approval',
      workflowRunUrl: null, statusMessage: null, failureReason: null, updatedAt: new Date().toISOString(), completedAt: null, commitSha: null, mode: 'github-api',
    });
    const first = await connect(fixture.app, 'a');
    expect(first).toContain('initial-a');
    setTimeout(() => fixture.emit('a', { id: 'a-2', eventType: 'log', note: 'after-reconnect' }), 10);
    const second = await connect(fixture.app, 'a', 'after-reconnect');
    expect(second).toContain('after-reconnect');
    expect(fixture.service.onDeploymentEvent).toHaveBeenCalledWith('a', expect.any(Function));
  });

  it('isolates simultaneous deployment streams and reconnects', async () => {
    const fixture = buildSseApp();
    const current = (id: string) => ({ deploymentId: id, workflowRunId: null, status: 'DEPLOYING', currentStep: 'Running', workflowRunUrl: null, statusMessage: null, failureReason: null, updatedAt: new Date().toISOString(), completedAt: null, commitSha: null, mode: 'github-api' });
    fixture.seed('a', [{ id: 'a-1', eventType: 'github-log', note: 'log-a' }], current('a'));
    fixture.seed('b', [{ id: 'b-1', eventType: 'github-log', note: 'log-b' }], current('b'));
    const a = await connect(fixture.app, 'a');
    const b = await connect(fixture.app, 'b');
    expect(a).toContain('log-a');
    expect(a).not.toContain('log-b');
    expect(b).toContain('log-b');
    expect(b).not.toContain('log-a');
    fixture.emit('b', { id: 'b-2', eventType: 'github-log', note: 'only-b' });
    const aReconnect = await connect(fixture.app, 'a');
    expect(aReconnect).not.toContain('only-b');
  });

  it('delivers terminal state and closes the stream', async () => {
    const fixture = buildSseApp();
    fixture.seed('a', [], { deploymentId: 'a', workflowRunId: '42', status: 'SUCCEEDED', currentStep: 'Done', workflowRunUrl: 'run', statusMessage: null, failureReason: null, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), commitSha: null, mode: 'github-api' });
    const connection = await connect(fixture.app, 'a');
    expect(connection).toContain('SUCCEEDED');
  });
});
