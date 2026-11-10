import { Router, json as expressJson } from 'express';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { CertificationEngine } from './services/CertificationEngine';
import { AksHealthDatabase } from './database';

export interface RouterOptions {
  logger: LoggerService;
  db?: AksHealthDatabase;
  engine?: CertificationEngine;
}

export function createAksHealthRouter(options: RouterOptions): Router {
  const { logger } = options;
  const db = options.db ?? AksHealthDatabase.fromEnv(logger);
  const engine = options.engine ?? new CertificationEngine({ logger, db });

  const router = Router();
  router.use(expressJson());

  // Prevent browser caching of dynamic health statuses
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // GET /clusters: List available clusters from Platform Registry
  router.get('/clusters', async (_req, res) => {
    try {
      const clusters = await db.listClusters();
      res.json(clusters);
    } catch (err: any) {
      logger.error(`[aks-health] Failed to list clusters: ${err.message}`);
      res.status(500).json({ error: 'Failed to retrieve clusters from registry' });
    }
  });

  // POST /run: Trigger health check for cluster
  router.post('/run', async (req, res) => {
    const { clusterId } = req.body ?? {};

    if (!clusterId || typeof clusterId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "clusterId" in request body' });
      return;
    }

    try {
      let cluster = await db.getClusterById(clusterId);
      if (!cluster) {
        // If cluster is not in registry, construct a placeholder PlatformCluster
        cluster = {
          id: clusterId,
          customerName: 'ScotiaBank',
          environment: 'PROD',
          subscriptionId: 'sub-netreveal-prod',
          resourceGroup: 'rg-scotia-prd',
          clusterName: clusterId.startsWith('aks-') ? clusterId : 'aks-scp-prd-cnc-st-scotia',
          region: 'eastus2',
        };
      }

      const result = await engine.runCertification(cluster);

      // Return exactly formatted response
      res.json({
        id: result.clusterId,
        clusterId: result.clusterId,
        clusterName: result.clusterName,
        overallScore: result.overallScore,
        status: result.status,
        certified: result.certified,
        reason: result.reason,
        runTimestamp: result.runTimestamp,
        formattedOutput: result.formattedOutput,
        checks: result.checks.map(c => ({
          name: c.name,
          status: c.status,
          score: c.score,
          weight: c.weight,
          reason: c.reason,
          findings: c.findings,
          details: c.details,
        })),
      });
    } catch (err: any) {
      logger.error(`[aks-health] Health check failed for clusterId=${clusterId}: ${err.message}`);
      res.status(500).json({ error: `Health check error: ${err.message}` });
    }
  });

  // GET /history/:clusterId: Retrieve historical certification runs
  router.get('/history/:clusterId', async (req, res) => {
    const { clusterId } = req.params;

    if (!clusterId) {
      res.status(400).json({ error: 'clusterId parameter is required' });
      return;
    }

    try {
      const history = await db.getHistory(clusterId);
      res.json(history);
    } catch (err: any) {
      logger.error(`[aks-health] Failed to get history for ${clusterId}: ${err.message}`);
      res.status(500).json({ error: 'Failed to retrieve history' });
    }
  });

  return router;
}
