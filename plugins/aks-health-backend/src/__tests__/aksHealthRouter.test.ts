import express from 'express';
import request from 'supertest';
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { patchSupertestIpv4 } from 'backend/src/test-utils/patchSupertestIpv4';
import { createAksHealthRouter } from '../router';
import { AksHealthDatabase } from '../database';

patchSupertestIpv4();

describe('aksHealthRouter', () => {
  const logger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  let app: express.Express;

  beforeEach(() => {
    const db = new AksHealthDatabase(logger);
    db.init();
    const router = createAksHealthRouter({ logger, db });
    app = express();
    app.use(express.json());
    app.use('/api/aks-health', router);
  });

  it('GET /api/aks-health/clusters returns list of clusters', async () => {
    const res = await request(app).get('/api/aks-health/clusters');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('clusterName');
  });

  it('POST /api/aks-health/run runs certification check for clusterId', async () => {
    const res = await request(app)
      .post('/api/aks-health/run')
      .send({ clusterId: '44444444-0000-0000-0000-000000000020' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('clusterName', 'aks-scp-prd-cnc-st-scotia');
    expect(res.body).toHaveProperty('overallScore', 87);
    expect(res.body).toHaveProperty('status', 'DEGRADED');
    expect(res.body).toHaveProperty('certified', false);
    expect(res.body).toHaveProperty(
      'reason',
      'PostgreSQL cluster in failover state',
    );
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.checks).toHaveLength(12);

    const cpCheck = res.body.checks.find((c: any) => c.name === 'Control Plane');
    expect(cpCheck).toBeDefined();
    expect(cpCheck.status).toBe('PASS');
    expect(cpCheck.score).toBe(15);

    const cnpgCheck = res.body.checks.find((c: any) => c.name === 'CloudNativePG');
    expect(cnpgCheck).toBeDefined();
    expect(cnpgCheck.status).toBe('FAIL');
    expect(cnpgCheck.score).toBe(0);
  });

  it('POST /api/aks-health/run rejects missing clusterId', async () => {
    const res = await request(app).post('/api/aks-health/run').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/aks-health/history/:clusterId returns historical runs', async () => {
    const res = await request(app).get(
      '/api/aks-health/history/44444444-0000-0000-0000-000000000020',
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('score');
    expect(res.body[0]).toHaveProperty('status');
  });
});
