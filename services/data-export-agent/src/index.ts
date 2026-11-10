/**
 * Entry point: `node dist/index.js`. Wires the production dependencies
 * (workload identity credential, pg, Azure SDK clients, Kubernetes API) into
 * the agent and handles process signals.
 */
import fs from 'fs/promises';
import { Agent } from './agent';
import { createAzureCredential, tokenProviderFromCredential } from './auth';
import { createKubernetesClusterInfoReader } from './clusterInfo';
import { ConfigError, loadConfig } from './config';
import { ControlPlaneClient } from './controlPlaneClient';
import { startHealthServer } from './healthServer';
import { JobRunner } from './jobRunner';
import { createLogger } from './logger';
import { createDefaultRegistry } from './providers/registry';
import { SourceConnector } from './sql/source';
import { agentVersion } from './version';

export { Agent } from './agent';
export { JobRunner } from './jobRunner';
export * from './protocol';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    const bootLogger = createLogger('info');
    bootLogger.error(err instanceof ConfigError ? err.message : String(err), {
      problems: err instanceof ConfigError ? err.problems : undefined,
    });
    process.exit(78); // EX_CONFIG
  }

  const version = agentVersion();
  const logger = createLogger(config.logLevel, undefined, {
    service: 'data-export-agent',
    cluster: config.clusterName,
  });

  const credential = createAzureCredential();
  const tokens = tokenProviderFromCredential(credential);
  const controlPlane = new ControlPlaneClient({
    baseUrl: config.controlPlaneUrl,
    scope: config.controlPlaneScope,
    tokens,
    logger,
    userAgent: `data-export-agent/${version}`,
  });
  const providers = createDefaultRegistry({ credential });

  // Leftovers from a previous container run (crash, OOM) are never reused.
  await fs.rm(config.workDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(config.workDir, { recursive: true, mode: 0o700 });

  const runner = new JobRunner({
    controlPlane,
    source: new SourceConnector({
      pg: config.pg,
      tokens,
      applicationName: `data-export-agent/${version}`,
    }),
    providers,
    logger,
    workDir: config.workDir,
    agentName: config.agentName,
    agentVersion: version,
    clusterName: config.clusterName,
  });

  const agent = new Agent({
    controlPlane,
    runner,
    providers,
    logger,
    agentName: config.agentName,
    version,
    clusterInfo: createKubernetesClusterInfoReader(logger),
    shutdownGraceMs: config.shutdownGraceSeconds * 1000,
  });

  const health = await startHealthServer(config.healthPort, agent);
  agent.start();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Signal received, shutting down', { signal });
    agent
      .stop()
      .catch(err => logger.error('Error during shutdown', { error: err }))
      .finally(() => {
        health.close();
        process.exit(0);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', err =>
    logger.error('Unhandled rejection', { error: err }),
  );
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(
      `${JSON.stringify({
        level: 'error',
        msg: 'Agent failed to start',
        error: String(err),
      })}\n`,
    );
    process.exit(1);
  });
}
