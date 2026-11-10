import express from 'express';
import request from 'supertest';
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { patchSupertestIpv4 } from 'backend/src/test-utils/patchSupertestIpv4';
import { createTenantRegistryRouter } from '../router';

patchSupertestIpv4();

function buildApp() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as any;

  const db = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)::text AS count FROM tenants')) {
        return [{ count: '0' }];
      }
      if (sql.includes('COUNT(*)::text AS count FROM clusters')) {
        return [{ count: '0' }];
      }
      return [];
    }),
  } as any;

  const httpAuth = {
    credentials: jest.fn(async (req: express.Request) => ({
      principal: { type: 'user' },
      groups:
        (req.headers['x-groups'] as string | undefined)
          ?.split(',')
          .map(s => s.trim())
          .filter(Boolean) ?? [],
    })),
  } as any;

  const userInfo = {
    getUserInfo: jest.fn(async (credentials: any) => ({
      userEntityRef: 'user:default/test',
      ownershipEntityRefs: credentials.groups ?? [],
    })),
  } as any;

  const auth = {
    getOwnServiceCredentials: jest.fn(),
    getPluginRequestToken: jest.fn(),
  } as any;

  const discovery = {
    getBaseUrl: jest.fn(async () => 'http://localhost:7007/api/catalog'),
  } as any;

  const router = createTenantRegistryRouter({
    logger,
    httpAuth,
    userInfo,
    auth,
    discovery,
    db,
  });

  const app = express();
  app.use(express.json());
  app.use(router);
  return { app, db };
}

describe('Tenant Registry Router RBAC', () => {
  it('allows Professional Services read-only access to GET /tenants', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get('/tenants')
      .set('x-groups', 'group:default/cloudhubps');

    expect(res.status).toBe(200);
  });

  it('allows cloudhub-login-allow read-only access to GET /tenants', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get('/tenants')
      .set('x-groups', 'group:default/cloudhub-login-allow');

    expect(res.status).toBe(200);
  });

  it('denies Professional Services write access to POST /tenants', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/tenants')
      .set('x-groups', 'group:default/cloudhubps')
      .send({
        tenantName: 'Visa',
        cloudProvider: 'Azure',
        subscriptionId: 'sub-1',
      });

    expect(res.status).toBe(403);
  });

  it('allows Platform Admin write access to POST /tenants', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/tenants')
      .set('x-groups', 'group:default/cloudhubplatformowners')
      .send({
        tenantName: 'Visa',
        cloudProvider: 'Azure',
        subscriptionId: 'sub-1',
        regions: ['eastus'],
        environments: ['dev'],
      });

    expect(res.status).toBe(201);
  });

  it('allows GRP-CloudHub-PlatformAdmin write access to POST /tenants', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/tenants')
      .set('x-groups', 'group:default/grp-cloudhub-platformadmin')
      .send({
        tenantName: 'Visa',
        cloudProvider: 'Azure',
        subscriptionId: 'sub-1',
        regions: ['eastus'],
        environments: ['dev'],
      });

    expect(res.status).toBe(201);
  });

  it('allows Platform Admin object-id claim write access to POST /tenants', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/tenants')
      .set('x-groups', '778023ed-fa96-43b3-8c35-4679943c01ee')
      .send({
        tenantName: 'Visa',
        cloudProvider: 'Azure',
        subscriptionId: 'sub-1',
        regions: ['eastus'],
        environments: ['dev'],
      });

    expect(res.status).toBe(201);
  });

  it('normalizes negative page and caps oversized pageSize for GET /tenants', async () => {
    const { app, db } = buildApp();

    const res = await request(app)
      .get('/tenants?page=-4&pageSize=9999')
      .set('x-groups', 'group:default/cloudhubplatformowners');

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(0);
    expect(res.body.pageSize).toBe(200);

    const listCall = (db.query as jest.Mock).mock.calls.find(call => {
      const sql = String(call[0]);
      return sql.includes('FROM tenants') && sql.includes('ORDER BY');
    });
    expect(listCall).toBeDefined();
    const params = (listCall?.[1] as unknown[]) ?? [];
    // No search => [limit, offset]
    expect(params[0]).toBe(200);
    expect(params[1]).toBe(0);
  });

  it('falls back to default sort for invalid cluster sort key', async () => {
    const { app, db } = buildApp();

    const res = await request(app)
      .get('/clusters?sortBy=DROP TABLE clusters&sortOrder=asc')
      .set('x-groups', 'group:default/cloudhubplatformowners');

    expect(res.status).toBe(200);

    const listCall = (db.query as jest.Mock).mock.calls.find(call => {
      const sql = String(call[0]);
      return sql.includes('FROM clusters') && sql.includes('ORDER BY');
    });
    expect(listCall).toBeDefined();
    const sql = String(listCall?.[0] ?? '');
    expect(sql).toContain('ORDER BY created_at ASC');
  });

  it('applies search filter params path for GET /clusters', async () => {
    const { app, db } = buildApp();

    const res = await request(app)
      .get('/clusters?search=visa')
      .set('x-groups', 'group:default/cloudhubplatformowners');

    expect(res.status).toBe(200);

    const listCall = (db.query as jest.Mock).mock.calls.find(call => {
      const sql = String(call[0]);
      return sql.includes('FROM clusters') && sql.includes('LIKE $1');
    });
    expect(listCall).toBeDefined();
    const params = (listCall?.[1] as unknown[]) ?? [];
    expect(params[0]).toBe('%visa%');
  });
});
