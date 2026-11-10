import * as k8s from '@kubernetes/client-node';
import type { LoggerService } from '@backstage/backend-plugin-api';

export interface NamespaceConfig {
  username: string;
  email: string;
  team: string;
  resourceQuota: {
    cpu: string;
    memory: string;
    storage: string;
  };
}

export class NamespaceService {
  private k8sApi: k8s.CoreV1Api;
  private k8sRbac: k8s.RbacAuthorizationV1Api;
  private k8sNetworking: k8s.NetworkingV1Api;

  constructor(private readonly logger: LoggerService) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    this.k8sRbac = kc.makeApiClient(k8s.RbacAuthorizationV1Api);
    this.k8sNetworking = kc.makeApiClient(k8s.NetworkingV1Api);
  }

  /**
   * Generate namespace name from username
   * Example: alex.chen@company.com -> sri-dev-alex-chen
   */
  private generateNamespaceName(username: string): string {
    const clean = username
      .toLowerCase()
      .split('@')[0] // Remove email domain
      .replace(/[^a-z0-9-]/g, '-') // Replace special chars
      .replace(/-+/g, '-') // Remove duplicate dashes
      .replace(/^-|-$/g, ''); // Trim dashes
    return `sri-dev-${clean}`;
  }

  /**
   * Create or get existing namespace for developer
   */
  async getOrCreateDeveloperNamespace(config: NamespaceConfig): Promise<{
    namespace: string;
    isNew: boolean;
  }> {
    const namespaceName = this.generateNamespaceName(config.username);

    try {
      // Check if namespace exists
      await this.k8sApi.readNamespace({ name: namespaceName });
      this.logger.info(
        `[namespace-service] Namespace ${namespaceName} already exists`,
      );
      return { namespace: namespaceName, isNew: false };
    } catch (error: any) {
      if (error.statusCode !== 404) {
        throw new Error(`Failed to check namespace: ${error.message}`);
      }
      // Namespace doesn't exist, create it
      await this.createNamespace(namespaceName, config);
      return { namespace: namespaceName, isNew: true };
    }
  }

  /**
   * Create a new namespace with all required resources
   */
  private async createNamespace(
    namespaceName: string,
    config: NamespaceConfig,
  ): Promise<void> {
    this.logger.info(
      `[namespace-service] Creating namespace ${namespaceName} for ${config.username}`,
    );

    // 1. Create the namespace
    const namespace = new k8s.V1Namespace();
    namespace.metadata = {
      name: namespaceName,
      labels: {
        'sri.dev': 'true',
        'sri.developer': config.username,
        'sri.team': config.team,
        'sri.environment': 'development',
        'app.kubernetes.io/managed-by': 'sri-portal',
      },
      annotations: {
        'sri.created-at': new Date().toISOString(),
        'sri.created-by': config.email,
      },
    };
    await this.k8sApi.createNamespace({ body: namespace });
    this.logger.info(`[namespace-service] Namespace ${namespaceName} created`);

    // 2. Apply resource quota
    await this.applyResourceQuota(namespaceName, config.resourceQuota);
    this.logger.info(
      `[namespace-service] Resource quota applied to ${namespaceName}`,
    );

    // 3. Apply network policy (isolate from other dev namespaces)
    await this.applyNetworkPolicy(namespaceName);
    this.logger.info(
      `[namespace-service] Network policy applied to ${namespaceName}`,
    );

    // 4. Create service account for CI/CD
    await this.createServiceAccount(namespaceName, config.username);
    this.logger.info(
      `[namespace-service] Service account created for ${namespaceName}`,
    );

    // 5. Create role binding for developer access
    await this.createRoleBinding(namespaceName, config.username);
    this.logger.info(
      `[namespace-service] Role binding created for ${namespaceName}`,
    );

    // 6. Create default secrets for 1Password
    await this.createDefaultSecrets(namespaceName);
    this.logger.info(
      `[namespace-service] Default secrets created for ${namespaceName}`,
    );
  }

  /**
   * Apply resource quota to namespace
   */
  private async applyResourceQuota(
    namespaceName: string,
    quota: NamespaceConfig['resourceQuota'],
  ): Promise<void> {
    const resourceQuota = new k8s.V1ResourceQuota();
    resourceQuota.metadata = {
      name: 'developer-quota',
      namespace: namespaceName,
    };
    resourceQuota.spec = {
      hard: {
        'requests.cpu': quota.cpu,
        'requests.memory': quota.memory,
        'limits.cpu': quota.cpu,
        'limits.memory': quota.memory,
        persistentvolumeclaims: '5',
        'requests.storage': quota.storage,
        pods: '5',
        services: '10',
        secrets: '20',
      },
    };
    await this.k8sApi.createNamespacedResourceQuota({
      namespace: namespaceName,
      body: resourceQuota,
    });
  }

  /**
   * Apply network policy for isolation
   */
  private async applyNetworkPolicy(namespaceName: string): Promise<void> {
    const networkPolicy = new k8s.V1NetworkPolicy();
    networkPolicy.metadata = {
      name: 'developer-isolation',
      namespace: namespaceName,
    };
    networkPolicy.spec = {
      podSelector: {},
      policyTypes: ['Ingress', 'Egress'],
      ingress: [
        // Allow from shared services namespace
        {
          _from: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': 'sri-platform-services',
                },
              },
            },
          ],
        } as k8s.V1NetworkPolicyIngressRule,
        // Allow from same namespace
        {
          _from: [
            {
              podSelector: {},
            },
          ],
        } as k8s.V1NetworkPolicyIngressRule,
      ],
      egress: [
        // Allow to shared services
        {
          _to: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': 'sri-platform-services',
                },
              },
            },
          ],
        } as k8s.V1NetworkPolicyEgressRule,
        // Allow DNS
        {
          _to: [
            {
              namespaceSelector: {},
              podSelector: {
                matchLabels: {
                  'k8s-app': 'kube-dns',
                },
              },
            },
          ],
          ports: [
            {
              port: 53,
              protocol: 'UDP',
            },
          ],
        } as k8s.V1NetworkPolicyEgressRule,
        // Allow internet (but not cluster internal)
        {
          _to: [
            {
              ipBlock: {
                cidr: '0.0.0.0/0',
                except: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
              },
            },
          ],
        } as k8s.V1NetworkPolicyEgressRule,
      ],
    };
    await this.k8sNetworking.createNamespacedNetworkPolicy({
      namespace: namespaceName,
      body: networkPolicy,
    });
  }

  /**
   * Create service account
   */
  private async createServiceAccount(
    namespaceName: string,
    username: string,
  ): Promise<void> {
    const sa = new k8s.V1ServiceAccount();
    sa.metadata = {
      name: `sa-${username.replace(/[^a-z0-9-]/g, '-')}`,
      namespace: namespaceName,
    };
    await this.k8sApi.createNamespacedServiceAccount({
      namespace: namespaceName,
      body: sa,
    });
  }

  /**
   * Create role binding for developer
   */
  private async createRoleBinding(
    namespaceName: string,
    username: string,
  ): Promise<void> {
    const roleBinding = new k8s.V1RoleBinding();
    roleBinding.metadata = {
      name: `rb-${username.replace(/[^a-z0-9-]/g, '-')}`,
      namespace: namespaceName,
    };
    roleBinding.roleRef = {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: 'edit',
    };
    roleBinding.subjects = [
      {
        kind: 'User',
        name: username,
        apiGroup: 'rbac.authorization.k8s.io',
      },
      {
        kind: 'ServiceAccount',
        name: `sa-${username.replace(/[^a-z0-9-]/g, '-')}`,
        namespace: namespaceName,
      },
    ];
    await this.k8sRbac.createNamespacedRoleBinding({
      namespace: namespaceName,
      body: roleBinding,
    });
  }

  /**
   * Create default secrets
   */
  private async createDefaultSecrets(namespaceName: string): Promise<void> {
    const secret = new k8s.V1Secret();
    secret.metadata = {
      name: 'default-secrets',
      namespace: namespaceName,
      labels: {
        'sri.secret-type': 'default',
      },
    };
    secret.type = 'Opaque';
    secret.data = {
      // These will be overridden by 1Password
      GITHUB_PAT: Buffer.from('PLACEHOLDER').toString('base64'),
      ONEPASSWORD_ACCOUNT: Buffer.from('PLACEHOLDER').toString('base64'),
    };
    await this.k8sApi.createNamespacedSecret({
      namespace: namespaceName,
      body: secret,
    });
  }

  /**
   * Delete developer namespace (cleanup everything)
   */
  async deleteDeveloperNamespace(username: string): Promise<{
    deleted: boolean;
    namespace: string;
  }> {
    const namespaceName = this.generateNamespaceName(username);

    try {
      // Check if namespace exists
      await this.k8sApi.readNamespace({ name: namespaceName });
    } catch (error: any) {
      if (error.statusCode === 404) {
        return { deleted: false, namespace: namespaceName };
      }
      throw error;
    }

    this.logger.info(`[namespace-service] Deleting namespace ${namespaceName}`);
    await this.k8sApi.deleteNamespace({ name: namespaceName });

    return { deleted: true, namespace: namespaceName };
  }

  /**
   * Get namespace resource usage
   */
  async getNamespaceUsage(namespaceName: string) {
    // Get pod metrics
    const pods = await this.k8sApi.listNamespacedPod({
      namespace: namespaceName,
    });
    const pvcs = await this.k8sApi.listNamespacedPersistentVolumeClaim({
      namespace: namespaceName,
    });

    let totalCpu = 0;
    let totalMemory = 0;
    let totalStorage = 0;

    for (const pod of pods.items) {
      if (pod.spec?.containers) {
        for (const container of pod.spec.containers) {
          const reqs = container.resources?.requests;
          if (reqs) {
            totalCpu += this.parseCpu(reqs.cpu);
            totalMemory += this.parseMemory(reqs.memory);
          }
        }
      }
    }

    for (const pvc of pvcs.items) {
      const size = pvc.spec?.resources?.requests?.storage;
      if (size) {
        totalStorage += this.parseStorage(size);
      }
    }

    return {
      namespace: namespaceName,
      pods: pods.items.length,
      pvcs: pvcs.items.length,
      cpu: totalCpu,
      memory: totalMemory,
      storage: totalStorage,
    };
  }

  private parseCpu(cpu: string | undefined): number {
    if (!cpu) return 0;
    if (cpu.endsWith('m')) {
      return parseInt(cpu, 10) / 1000;
    }
    return parseInt(cpu, 10) || 0;
  }

  private parseMemory(memory: string | undefined): number {
    if (!memory) return 0;
    if (memory.endsWith('Mi')) {
      return parseInt(memory, 10) / 1024;
    }
    if (memory.endsWith('Gi')) {
      return parseInt(memory, 10);
    }
    return parseInt(memory, 10) / 1024 / 1024 / 1024 || 0;
  }

  private parseStorage(storage: string | undefined): number {
    if (!storage) return 0;
    if (storage.endsWith('Gi')) {
      return parseInt(storage, 10);
    }
    if (storage.endsWith('Mi')) {
      return parseInt(storage, 10) / 1024;
    }
    return parseInt(storage, 10) || 0;
  }
}
