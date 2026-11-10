import * as k8s from '@kubernetes/client-node';
import type { LoggerService } from '@backstage/backend-plugin-api';

export class KubernetesClientFactory {
  private readonly logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  createKubeConfig(kubeconfigRaw?: string | null): k8s.KubeConfig {
    const kc = new k8s.KubeConfig();
    if (kubeconfigRaw && kubeconfigRaw.trim()) {
      kc.loadFromString(kubeconfigRaw);
    } else {
      try {
        kc.loadFromDefault();
      } catch (err: any) {
        this.logger.debug(
          `[aks-health] Kubernetes default kubeconfig not available: ${err.message}`,
        );
      }
    }
    return kc;
  }

  getCoreApi(kc: k8s.KubeConfig): k8s.CoreV1Api {
    return kc.makeApiClient(k8s.CoreV1Api);
  }

  getAppsApi(kc: k8s.KubeConfig): k8s.AppsV1Api {
    return kc.makeApiClient(k8s.AppsV1Api);
  }

  getCustomObjectsApi(kc: k8s.KubeConfig): k8s.CustomObjectsApi {
    return kc.makeApiClient(k8s.CustomObjectsApi);
  }

  getStorageApi(kc: k8s.KubeConfig): k8s.StorageV1Api {
    return kc.makeApiClient(k8s.StorageV1Api);
  }
}
