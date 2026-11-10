import express from 'express';
import request from 'supertest';
// Sandboxed WSL hosts resolve localhost to IPv6 first; the sibling router tests need the same shim.
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { patchSupertestIpv4 } from 'backend/src/test-utils/patchSupertestIpv4';
import { createDataExportRouter } from '../router';
import { PLATFORM_ADMIN, SCHEDULER, agentToken, fakeAuth, logger, tenantAdmin, tenantUser } from './testAuth';

patchSupertestIpv4();

const UUID = '8b3c4d5e-3c4d-4f60-a123-3456789abcde';

function buildApp() {
  // Requests reject before the database is used except mocked package listing.
  const db = {
    query: jest.fn(async (sql: string) => {
      if (sql && sql.includes('data_export.export_packages')) {
        return { rows: [] };
      }
      throw new Error('database must not be reached in this test');
    }),
    transaction: jest.fn(async () => {
      throw new Error('database must not be reached in this test');
    }),
  } as any;
  const { httpAuth, userInfo } = fakeAuth();
  const app = express();
  app.use(createDataExportRouter({ logger, httpAuth, userInfo, db }));
  return app;
}

describe('user authentication and roles', () => {
  it('rejects requests without credentials', async () => {
    expect((await request(buildApp()).get('/me')).status).toBe(401);
  });

  it('reports roles on /me', async () => {
    const res = await request(buildApp()).get('/me').set('x-test-principal', tenantAdmin('visa'));
    expect(res.body).toEqual({
      actor: 'user:default/tester',
      isPlatformAdmin: false,
      tenantAdminOf: ['visa'],
      tenantMemberOf: ['visa'],
    });
  });

  it('lists standard export packages on GET /packages', async () => {
    const res = await request(buildApp())
      .get('/packages')
      .set('x-test-principal', tenantUser('visa'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(5);
    expect(res.body.map((p: any) => p.packageCode)).toContain('workflow-audit');
  });

  it('keeps catalog, cluster and agent administration for platform admins', async () => {
    const app = buildApp();
    const as = tenantAdmin('visa');
    const responses = await Promise.all([
      request(app).post('/datasets').set('x-test-principal', as).send({ datasetId: 'NR_X', displayName: 'x', category: 'CASES' }),
      request(app).post('/clusters').set('x-test-principal', as).send({ clusterName: 'aks', environment: 'SIT', tenantId: 'visa' }),
      request(app).post('/clusters/sync').set('x-test-principal', as),
      request(app).post(`/clusters/${UUID}/retire`).set('x-test-principal', as),
      request(app).delete(`/agents/${UUID}`).set('x-test-principal', as),
    ]);
    expect(responses.map(res => res.status)).toEqual([403, 403, 403, 403, 403]);
  });

  it('forbids tenant users from creating exports and destinations', async () => {
    const app = buildApp();
    const exportRes = await request(app)
      .post('/exports')
      .set('x-test-principal', tenantUser('visa'))
      .send({
        name: 'x',
        tenantId: 'visa',
        environment: 'PRODUCTION',
        clusterId: UUID,
        schedule: 'DAILY',
        fileFormat: 'CSV',
        destinationId: UUID,
        datasetIds: [UUID],
      });
    const destinationRes = await request(app)
      .post('/destinations')
      .set('x-test-principal', tenantAdmin('visa'))
      .send({ type: 'ADLS_GEN2', name: 'shared', configuration: { accountName: 'dxhprod' } });
    expect(exportRes.status).toBe(403);
    expect(destinationRes.status).toBe(403);
  });

  it('refuses audit history to tenant users', async () => {
    const res = await request(buildApp()).get('/audit').set('x-test-principal', tenantUser('visa'));
    expect(res.status).toBe(403);
  });

  it('rejects sort fields that are not whitelisted', async () => {
    const res = await request(buildApp())
      .get('/jobs?sortBy=created_at;DROP')
      .set('x-test-principal', PLATFORM_ADMIN);
    expect(res.status).toBe(400);
    expect(res.body.details[0]).toMatch(/sortBy must be one of/);
  });

  it('rejects a connection test for a type without a provider', async () => {
    const res = await request(buildApp())
      .post('/destinations/test')
      .set('x-test-principal', tenantAdmin('visa'))
      .send({ type: 'AWS_S3', configuration: {} });
    expect(res.status).toBe(400);
  });
});

describe('agent and internal endpoints', () => {
  it('do not accept user sign-in tokens', async () => {
    const app = buildApp();
    const agent = await request(app).post('/agent/heartbeat').set('x-test-principal', PLATFORM_ADMIN).send({});
    const internal = await request(app).post('/internal/clusters/sync').set('x-test-principal', PLATFORM_ADMIN);
    expect(agent.status).toBe(403);
    expect(internal.status).toBe(403);
  });

  it('reject service tokens that are not agent identities', async () => {
    const res = await request(buildApp())
      .post('/agent/jobs/claim')
      .set('x-test-principal', 'service:plugin:catalog')
      .send({});
    expect(res.status).toBe(403);
  });

  it('only let the scheduler plugin trigger an internal cluster sync', async () => {
    const res = await request(buildApp())
      .post('/internal/clusters/sync')
      .set('x-test-principal', agentToken('aaaaaaaa-1111-4111-8111-111111111111'));
    expect(res.status).toBe(403);
    expect(SCHEDULER).toBe('service:plugin:data-export-scheduler');
  });
});
