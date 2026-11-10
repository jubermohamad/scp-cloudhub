/**
 * Kubernetes facts reported as heartbeat capabilities: the server version and
 * the `kube-system` namespace UID, which is stable for the cluster's lifetime
 * and so serves as a fingerprint that catches an agent installed on the wrong
 * cluster with a copied values file.
 *
 * Needs only `get` on namespace kube-system and the /version endpoint (see the
 * chart's ClusterRole). Any failure just omits the fields.
 */
import type { Logger } from './logger';

export interface ClusterInfo {
  kubernetesVersion?: string;
  clusterUid?: string;
}

export type ClusterInfoReader = () => Promise<ClusterInfo>;

/** Reads cluster info with the in-cluster service account; returns {} outside a cluster. */
export function createKubernetesClusterInfoReader(
  logger: Logger,
  env: Record<string, string | undefined> = process.env,
): ClusterInfoReader {
  return async () => {
    if (!env.KUBERNETES_SERVICE_HOST) return {};
    const info: ClusterInfo = {};
    try {
      // The client is ESM-only; Node 22 can require() it, and loading it lazily
      // keeps it out of unit tests and local runs.
      const k8s = await import('@kubernetes/client-node');
      const kc = new k8s.KubeConfig();
      kc.loadFromCluster();
      try {
        const version = await kc.makeApiClient(k8s.VersionApi).getCode();
        info.kubernetesVersion = version.gitVersion;
      } catch (err) {
        logger.warn('Could not read the Kubernetes version', { error: err });
      }
      try {
        const ns = await kc
          .makeApiClient(k8s.CoreV1Api)
          .readNamespace({ name: 'kube-system' });
        info.clusterUid = ns.metadata?.uid;
      } catch (err) {
        logger.warn(
          'Could not read the kube-system namespace UID (check the ClusterRole)',
          {
            error: err,
          },
        );
      }
    } catch (err) {
      logger.warn(
        'Kubernetes API unavailable; cluster info omitted from heartbeats',
        { error: err },
      );
    }
    return info;
  };
}
