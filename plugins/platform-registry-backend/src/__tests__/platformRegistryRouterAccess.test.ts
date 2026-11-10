import express from 'express';
import request from 'supertest';
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { patchSupertestIpv4 } from 'backend/src/test-utils/patchSupertestIpv4';
import { createPlatformRegistryRouter } from '../router';

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
    isReady: jest.fn(() => true),
    query: jest.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) {
        return [{ count: 0 }];
      }
      if (sql.includes('FROM pr_platforms')) {
        return [];
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

  const router = createPlatformRegistryRouter({
    logger,
    httpAuth,
    userInfo,
    db,
  });

  const app = express();
  app.use(express.json());
  app.use(router);
  return { app };
}

describe('Platform Registry Router RBAC', () => {
  it('allows GRP-CloudHub-PlatformAdmin read access to GET /platforms', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get('/platforms')
      .set('x-groups', 'group:default/grp-cloudhub-platformadmin');

    expect(res.status).toBe(200);
  });

  it('allows Platform Admin object-id claim read access to GET /platforms', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get('/platforms')
      .set('x-groups', '778023ed-fa96-43b3-8c35-4679943c01ee');

    expect(res.status).toBe(200);
  });

  it('does not return a bodyless 304 for conditional live inventory requests', async () => {
    const { app } = buildApp();
    const first = await request(app)
      .get('/platforms')
      .set('x-groups', 'group:default/cloudhubplatformowners');
    const second = await request(app)
      .get('/platforms')
      .set('x-groups', 'group:default/cloudhubplatformowners')
      .set('If-None-Match', first.headers.etag);

    expect(first.headers['cache-control']).toContain('no-store');
    expect(second.status).toBe(200);
    expect(second.body).toHaveProperty('items');
  });

  it('allows read access to GET /customers and GET /customers/:customer/clusters', async () => {
    const { app } = buildApp();

    const resCustomers = await request(app)
      .get('/customers')
      .set('x-groups', 'group:default/cloudhubplatformowners');
    expect(resCustomers.status).toBe(200);

    const resClusters = await request(app)
      .get('/customers/metrobank/clusters?environment=PROD')
      .set('x-groups', 'group:default/cloudhubplatformowners');
    expect(resClusters.status).toBe(200);
  });

  it('denies unrelated groups for GET /platforms', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get('/platforms')
      .set('x-groups', 'group:default/some-other-group');

    expect(res.status).toBe(403);
  });
});