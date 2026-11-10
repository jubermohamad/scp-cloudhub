import { ContainerServiceClient } from '@azure/arm-containerservice';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';
import * as k8s from '@kubernetes/client-node';
import type { ResourceProfile } from '../types';

export interface WorkspacePlatformConfiguration {
  id: 'sri-dev-workspaces';
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  namespace: string;
}

export interface WorkspaceKubernetesResources {
  podName: string;
  pvcName: string;
  serviceAccountName: string;
}

export interface WorkspaceKubernetesStatus {
  podExists: boolean;
  podPhase: string | null;
  podReady: boolean;
  podReason: string | null;
  pvcExists: boolean;
  pvcPhase: string | null;
  pvcUid: string | null;
  serviceAccountExists: boolean;
}

export interface WorkspaceProvisioningPreflightCheck {
  key: string;
  status: 'READY' | 'FAILED' | 'SKIPPED';
  message: string;
}

export interface WorkspaceProvisioningPreflightReport {
  platformId: WorkspacePlatformConfiguration['id'];
  clusterName: string;
  namespace: string;
  ready: boolean;
  checks: WorkspaceProvisioningPreflightCheck[];
  checkedAt: string;
}

export interface WorkspaceProvisioningPreflightInput {
  dependencies?: {
    postgresql?: boolean;
    kafka?: boolean;
    temporal?: boolean;
  };
  componentId?: string;
  developmentProfileId?: string;
}

export interface ProvisionWorkspaceInput {
  workspaceId: string;
  componentId: string;
  developmentProfileId: string;
  developerRef?: string;
  dependencies?: {
    postgresql?: boolean;
    kafka?: boolean;
    temporal?: boolean;
  };
  resourceProfile: ResourceProfile;
  image: string;
  resources: WorkspaceKubernetesResources;
}

interface WorkspacePodRuntimeOptions {
  workspaceMountPath: string;
  onePasswordAccount: string | null;
  githubPatSecretName: string | null;
  githubPatSecretKey: string;
  dockerSocketMountEnabled: boolean;
  kubeconfigSecretName: string | null;
  postgresSidecarImage: string;
  postgresSecretName: string;
  postgresSecretKey: string;
  kafkaSidecarImage: string;
  temporalSidecarImage: string;
  enableTemporalSidecar: boolean;
  kafkaSecretName: string | null;
  kafkaSecretKey: string | null;
  kafkaSecretEnvName: string;
  temporalSecretName: string | null;
  temporalSecretKey: string | null;
  temporalSecretEnvName: string;
}

export class WorkspacePlatformConfigurationError extends Error {
  constructor(
    code: 'WORKSPACE_PLATFORM_NOT_CONFIGURED' | 'WORKSPACE_NAMESPACE_NOT_FOUND',
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export function getWorkspacePlatformConfiguration(): WorkspacePlatformConfiguration {
  const subscriptionId =
    process.env.CLOUDHUB_WORKSPACE_AKS_SUBSCRIPTION_ID ??
    process.env.CLOUDHUB_AZURE_SUBSCRIPTION_ID ??
    '';
  const resourceGroup = process.env.CLOUDHUB_WORKSPACE_AKS_RESOURCE_GROUP ?? '';
  const clusterName =
    process.env.CLOUDHUB_WORKSPACE_AKS_CLUSTER_NAME ??
    process.env.CLOUDHUB_WORKSPACE_AKS_CLUSTER ??
    '';
  const namespace =
    process.env.CLOUDHUB_WORKSPACE_NAMESPACE ?? 'cloudhub-workspaces';

  if (!subscriptionId || !resourceGroup || !clusterName || !namespace) {
    throw new WorkspacePlatformConfigurationError(
      'WORKSPACE_PLATFORM_NOT_CONFIGURED',
      'CLOUDHUB_WORKSPACE_AKS_SUBSCRIPTION_ID, CLOUDHUB_WORKSPACE_AKS_RESOURCE_GROUP, CLOUDHUB_WORKSPACE_AKS_CLUSTER_NAME, and CLOUDHUB_WORKSPACE_NAMESPACE are required.',
    );
  }

  return {
    id: 'sri-dev-workspaces',
    subscriptionId,
    resourceGroup,
    clusterName,
    namespace,
  };
}

// ─── Credential resolution ────────────────────────────────────────────────────

export class KubernetesWorkspaceProvisioner {
  private credential?: ReturnType<typeof createCloudHubAzureCredential>;
  private coreApi: k8s.CoreV1Api | undefined;
  private customApi: k8s.CustomObjectsApi | undefined;

  constructor(private readonly logger: LoggerService) {}

  private getCredential(): ReturnType<typeof createCloudHubAzureCredential> {
    if (!this.credential) {
      this.credential = createCloudHubAzureCredential(
        (message, metadata) => this.logger.info(message, metadata),
      );
    }
    return this.credential;
  }

  private runtimeOptions(): WorkspacePodRuntimeOptions {
    const dockerSocketMountEnabled =
      String(
        process.env.CLOUDHUB_WORKSPACE_ENABLE_DOCKER_SOCKET_MOUNT ?? '',
      ).toLowerCase() === 'true';
    const enableTemporalSidecar =
      String(
        process.env.CLOUDHUB_WORKSPACE_ENABLE_TEMPORAL_SIDECAR ?? '',
      ).toLowerCase() === 'true';
    return {
      workspaceMountPath:
        process.env.CLOUDHUB_WORKSPACE_MOUNT_PATH ?? '/workspace',
      onePasswordAccount:
        process.env.CLOUDHUB_WORKSPACE_ONEPASSWORD_ACCOUNT ?? null,
      githubPatSecretName:
        process.env.CLOUDHUB_WORKSPACE_GITHUB_PAT_SECRET_NAME ?? null,
      githubPatSecretKey:
        process.env.CLOUDHUB_WORKSPACE_GITHUB_PAT_SECRET_KEY ?? 'pat',
      dockerSocketMountEnabled,
      kubeconfigSecretName:
        process.env.CLOUDHUB_WORKSPACE_KUBECONFIG_SECRET_NAME ?? null,
      postgresSidecarImage:
        process.env.CLOUDHUB_WORKSPACE_POSTGRES_SIDECAR_IMAGE ??
        'postgres:15.4',
      postgresSecretName:
        process.env.CLOUDHUB_WORKSPACE_POSTGRES_SECRET_NAME ??
        'postgres-credentials',
      postgresSecretKey:
        process.env.CLOUDHUB_WORKSPACE_POSTGRES_SECRET_KEY ?? 'password',
      kafkaSidecarImage:
        process.env.CLOUDHUB_WORKSPACE_KAFKA_SIDECAR_IMAGE ??
        'bitnami/kafka:3.6',
      temporalSidecarImage:
        process.env.CLOUDHUB_WORKSPACE_TEMPORAL_SIDECAR_IMAGE ??
        'temporalio/auto-setup:1.21',
      enableTemporalSidecar,
      kafkaSecretName: process.env.CLOUDHUB_WORKSPACE_KAFKA_SECRET_NAME ?? null,
      kafkaSecretKey: process.env.CLOUDHUB_WORKSPACE_KAFKA_SECRET_KEY ?? null,
      kafkaSecretEnvName:
        process.env.CLOUDHUB_WORKSPACE_KAFKA_SECRET_ENV_NAME ??
        'KAFKA_CLIENT_PASSWORD',
      temporalSecretName:
        process.env.CLOUDHUB_WORKSPACE_TEMPORAL_SECRET_NAME ?? null,
      temporalSecretKey:
        process.env.CLOUDHUB_WORKSPACE_TEMPORAL_SECRET_KEY ?? null,
      temporalSecretEnvName:
        process.env.CLOUDHUB_WORKSPACE_TEMPORAL_SECRET_ENV_NAME ??
        'TEMPORAL_DB_PASSWORD',
    };
  }

  static resourceNames(workspaceId: string): WorkspaceKubernetesResources {
    const safeId = workspaceId
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 48);
    return {
      podName: `ws-${safeId}`,
      pvcName: `ws-${safeId}-home`,
      serviceAccountName: `ws-${safeId}`,
    };
  }

  async validatePlatform(): Promise<WorkspacePlatformConfiguration> {
    const platform = getWorkspacePlatformConfiguration();
    const core = await this.getCoreApi(platform);
    try {
      await core.readNamespace({ name: platform.namespace });
    } catch (error) {
      const statusCode = this.statusCode(error);
      if (statusCode === 404) {
        throw new WorkspacePlatformConfigurationError(
          'WORKSPACE_NAMESPACE_NOT_FOUND',
          `Platform namespace ${platform.namespace} does not exist on ${platform.clusterName}.`,
        );
      }
      throw error;
    }
    return platform;
  }

  async validateWorkspacePrerequisites(
    input?: WorkspaceProvisioningPreflightInput,
  ): Promise<WorkspaceProvisioningPreflightReport> {
    const checkedAt = new Date().toISOString();
    const checks: WorkspaceProvisioningPreflightCheck[] = [];

    try {
      const platform = getWorkspacePlatformConfiguration();
      const core = await this.getCoreApi(platform);

      try {
        await core.readNamespace({ name: platform.namespace });
        checks.push({
          key: 'namespace',
          status: 'READY',
          message: `Namespace ${platform.namespace} exists on ${platform.clusterName}.`,
        });
      } catch (error) {
        const statusCode = this.statusCode(error);
        if (statusCode === 404) {
          checks.push({
            key: 'namespace',
            status: 'FAILED',
            message: `Namespace ${platform.namespace} does not exist on ${platform.clusterName}.`,
          });
        } else {
          checks.push({
            key: 'namespace',
            status: 'FAILED',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const options = this.runtimeOptions();
      const requiresVpa = this.shouldEnableVpaForWorkload({
        componentId: input?.componentId,
        developmentProfileId: input?.developmentProfileId,
      });
      const requiresPostgresSidecar = Boolean(input?.dependencies?.postgresql);
      const requiresKafkaSidecar = Boolean(input?.dependencies?.kafka);
      const requiresTemporalSidecar =
        options.enableTemporalSidecar &&
        Boolean(
          input?.dependencies?.temporal || input?.dependencies?.postgresql,
        );

      if (
        String(
          process.env.CLOUDHUB_WORKSPACE_ENABLE_VPA ?? 'true',
        ).toLowerCase() === 'false'
      ) {
        checks.push({
          key: 'workspaceVpaCrd',
          status: 'SKIPPED',
          message:
            'Workspace VPA support is disabled by CLOUDHUB_WORKSPACE_ENABLE_VPA=false.',
        });
      } else if (!requiresVpa) {
        checks.push({
          key: 'workspaceVpaCrd',
          status: 'SKIPPED',
          message: 'VPA is not required for this workspace workload profile.',
        });
      } else {
        try {
          const custom = await this.getCustomObjectsApi(platform);
          await custom.listNamespacedCustomObject({
            group: 'autoscaling.k8s.io',
            version: 'v1',
            namespace: platform.namespace,
            plural: 'verticalpodautoscalers',
            limit: 1,
          });
          checks.push({
            key: 'workspaceVpaCrd',
            status: 'READY',
            message:
              'VerticalPodAutoscaler CRD is available in the cluster API.',
          });
        } catch (error) {
          checks.push({
            key: 'workspaceVpaCrd',
            status: 'FAILED',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (requiresPostgresSidecar) {
        if (
          !options.postgresSecretName.trim() ||
          !options.postgresSecretKey.trim()
        ) {
          checks.push({
            key: 'postgresSidecarSecret',
            status: 'FAILED',
            message:
              'Postgres sidecar is enabled but secret configuration is missing. Set CLOUDHUB_WORKSPACE_POSTGRES_SECRET_NAME and CLOUDHUB_WORKSPACE_POSTGRES_SECRET_KEY.',
          });
        } else {
          try {
            const secretResponse = await core.readNamespacedSecret({
              name: options.postgresSecretName,
              namespace: platform.namespace,
            });
            const secret =
              'body' in (secretResponse as object)
                ? (secretResponse as { body: k8s.V1Secret }).body
                : (secretResponse as k8s.V1Secret);
            const hasKey = Boolean(
              secret.data?.[options.postgresSecretKey] ||
                secret.stringData?.[options.postgresSecretKey],
            );
            checks.push({
              key: 'postgresSidecarSecret',
              status: hasKey ? 'READY' : 'FAILED',
              message: hasKey
                ? `Postgres secret ${options.postgresSecretName} contains key ${options.postgresSecretKey}.`
                : `Postgres secret ${options.postgresSecretName} is missing key ${options.postgresSecretKey}.`,
            });
          } catch (error) {
            checks.push({
              key: 'postgresSidecarSecret',
              status: 'FAILED',
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else {
        checks.push({
          key: 'postgresSidecarSecret',
          status: 'SKIPPED',
          message: 'Postgres dependency is not requested for this workspace.',
        });
      }

      if (requiresKafkaSidecar) {
        if (options.kafkaSecretName && options.kafkaSecretKey) {
          try {
            const secretResponse = await core.readNamespacedSecret({
              name: options.kafkaSecretName,
              namespace: platform.namespace,
            });
            const secret =
              'body' in (secretResponse as object)
                ? (secretResponse as { body: k8s.V1Secret }).body
                : (secretResponse as k8s.V1Secret);
            const hasKey = Boolean(
              secret.data?.[options.kafkaSecretKey] ||
                secret.stringData?.[options.kafkaSecretKey],
            );
            checks.push({
              key: 'kafkaSidecarSecret',
              status: hasKey ? 'READY' : 'FAILED',
              message: hasKey
                ? `Kafka secret ${options.kafkaSecretName} contains key ${options.kafkaSecretKey}.`
                : `Kafka secret ${options.kafkaSecretName} is missing key ${options.kafkaSecretKey}.`,
            });
          } catch (error) {
            checks.push({
              key: 'kafkaSidecarSecret',
              status: 'FAILED',
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          checks.push({
            key: 'kafkaSidecarSecret',
            status: 'SKIPPED',
            message:
              'Kafka dependency is requested but no Kafka secret is configured; sidecar will run without secret injection.',
          });
        }
      } else {
        checks.push({
          key: 'kafkaSidecarSecret',
          status: 'SKIPPED',
          message: 'Kafka dependency is not requested for this workspace.',
        });
      }

      if (requiresTemporalSidecar) {
        if (options.temporalSecretName && options.temporalSecretKey) {
          try {
            const secretResponse = await core.readNamespacedSecret({
              name: options.temporalSecretName,
              namespace: platform.namespace,
            });
            const secret =
              'body' in (secretResponse as object)
                ? (secretResponse as { body: k8s.V1Secret }).body
                : (secretResponse as k8s.V1Secret);
            const hasKey = Boolean(
              secret.data?.[options.temporalSecretKey] ||
                secret.stringData?.[options.temporalSecretKey],
            );
            checks.push({
              key: 'temporalSidecarSecret',
              status: hasKey ? 'READY' : 'FAILED',
              message: hasKey
                ? `Temporal secret ${options.temporalSecretName} contains key ${options.temporalSecretKey}.`
                : `Temporal secret ${options.temporalSecretName} is missing key ${options.temporalSecretKey}.`,
            });
          } catch (error) {
            checks.push({
              key: 'temporalSidecarSecret',
              status: 'FAILED',
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          checks.push({
            key: 'temporalSidecarSecret',
            status: 'SKIPPED',
            message:
              'Temporal sidecar is enabled but no Temporal secret is configured; sidecar will run without secret injection.',
          });
        }
      } else {
        checks.push({
          key: 'temporalSidecarSecret',
          status: 'SKIPPED',
          message:
            'Temporal sidecar is not required for this workspace request.',
        });
      }

      if (options.githubPatSecretName) {
        try {
          const secretResponse = await core.readNamespacedSecret({
            name: options.githubPatSecretName,
            namespace: platform.namespace,
          });
          const secret =
            'body' in (secretResponse as object)
              ? (secretResponse as { body: k8s.V1Secret }).body
              : (secretResponse as k8s.V1Secret);
          const hasKey = Boolean(
            secret.data?.[options.githubPatSecretKey] ||
              secret.stringData?.[options.githubPatSecretKey],
          );
          checks.push({
            key: 'githubPatSecret',
            status: hasKey ? 'READY' : 'FAILED',
            message: hasKey
              ? `Secret ${options.githubPatSecretName} contains key ${options.githubPatSecretKey}.`
              : `Secret ${options.githubPatSecretName} is missing key ${options.githubPatSecretKey}.`,
          });
        } catch (error) {
          checks.push({
            key: 'githubPatSecret',
            status: 'FAILED',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        checks.push({
          key: 'githubPatSecret',
          status: 'SKIPPED',
          message: 'GITHUB_PAT secret injection is not configured.',
        });
      }

      if (options.kubeconfigSecretName) {
        try {
          await core.readNamespacedSecret({
            name: options.kubeconfigSecretName,
            namespace: platform.namespace,
          });
          checks.push({
            key: 'kubeconfigSecret',
            status: 'READY',
            message: `Secret ${options.kubeconfigSecretName} exists for kubeconfig mount.`,
          });
        } catch (error) {
          checks.push({
            key: 'kubeconfigSecret',
            status: 'FAILED',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        checks.push({
          key: 'kubeconfigSecret',
          status: 'SKIPPED',
          message: 'Kubeconfig secret mount is not configured.',
        });
      }

      checks.push({
        key: 'dockerSocketMount',
        status: options.dockerSocketMountEnabled ? 'READY' : 'SKIPPED',
        message: options.dockerSocketMountEnabled
          ? 'Docker socket hostPath mount is enabled.'
          : 'Docker socket hostPath mount is disabled.',
      });

      checks.push({
        key: 'onePasswordAccount',
        status: options.onePasswordAccount ? 'READY' : 'SKIPPED',
        message: options.onePasswordAccount
          ? `ONEPASSWORD_ACCOUNT is configured as ${options.onePasswordAccount}.`
          : 'ONEPASSWORD_ACCOUNT is not configured.',
      });

      return {
        platformId: platform.id,
        clusterName: platform.clusterName,
        namespace: platform.namespace,
        ready: checks.every(check => check.status !== 'FAILED'),
        checks,
        checkedAt,
      };
    } catch (error) {
      checks.push({
        key: 'platformConfiguration',
        status: 'FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        platformId: 'sri-dev-workspaces',
        clusterName:
          process.env.CLOUDHUB_WORKSPACE_AKS_CLUSTER_NAME ??
          process.env.CLOUDHUB_WORKSPACE_AKS_CLUSTER ??
          '',
        namespace:
          process.env.CLOUDHUB_WORKSPACE_NAMESPACE ?? 'cloudhub-workspaces',
        ready: false,
        checks,
        checkedAt,
      };
    }
  }

  async createWorkspace(input: ProvisionWorkspaceInput): Promise<void> {
    const platform = await this.validatePlatform();
    const core = await this.getCoreApi(platform);
    const labels = this.labels(input);
    await this.createIfAbsent(() =>
      core.createNamespacedServiceAccount({
        namespace: platform.namespace,
        body: {
          metadata: { name: input.resources.serviceAccountName, labels },
          automountServiceAccountToken: false,
        },
      }),
    );
    await this.createIfAbsent(() =>
      core.createNamespacedPersistentVolumeClaim({
        namespace: platform.namespace,
        body: {
          metadata: { name: input.resources.pvcName, labels },
          spec: {
            accessModes: ['ReadWriteOnce'],
            resources: {
              requests: {
                storage: input.resourceProfile.storageQuota ?? '10Gi',
              },
            },
          },
        },
      }),
    );
    await this.createPod(core, platform.namespace, input, labels);
    await this.ensureWorkspaceAutoscaling(platform.namespace, input, labels);
    await this.waitForReady(
      core,
      platform.namespace,
      input.resources.podName,
      input.resources.pvcName,
    );
  }

  async stopWorkspace(resources: WorkspaceKubernetesResources): Promise<void> {
    const platform = await this.validatePlatform();
    const core = await this.getCoreApi(platform);
    await this.deleteIfPresent(() =>
      core.deleteNamespacedPod({
        name: resources.podName,
        namespace: platform.namespace,
      }),
    );
    await this.waitForPodDeleted(core, platform.namespace, resources.podName);
  }

  async startWorkspace(input: ProvisionWorkspaceInput): Promise<void> {
    await this.resumeWorkspace(input);
  }

  async resumeWorkspace(input: ProvisionWorkspaceInput): Promise<void> {
    const platform = await this.validatePlatform();
    const core = await this.getCoreApi(platform);
    await core.readNamespacedServiceAccount({
      name: input.resources.serviceAccountName,
      namespace: platform.namespace,
    });
    await core.readNamespacedPersistentVolumeClaim({
      name: input.resources.pvcName,
      namespace: platform.namespace,
    });
    await this.createPod(core, platform.namespace, input, this.labels(input));
    await this.waitForReady(
      core,
      platform.namespace,
      input.resources.podName,
      input.resources.pvcName,
    );
    await this.restoreProcesses(
      platform.namespace,
      input.resources.podName,
      input.workspaceId,
    );
    await this.notifyWorkspaceResumed(
      platform.namespace,
      input.workspaceId,
      input.developerRef,
    );
  }

  async deleteWorkspace(
    resources: WorkspaceKubernetesResources,
  ): Promise<void> {
    const platform = await this.validatePlatform();
    const core = await this.getCoreApi(platform);
    const custom = await this.getCustomObjectsApi(platform);
    await this.deleteIfPresent(() =>
      custom.deleteNamespacedCustomObject({
        group: 'autoscaling.k8s.io',
        version: 'v1',
        namespace: platform.namespace,
        plural: 'verticalpodautoscalers',
        name: `${resources.podName}-vpa`,
      }),
    );
    await this.deleteIfPresent(() =>
      core.deleteNamespacedPod({
        name: resources.podName,
        namespace: platform.namespace,
      }),
    );
    await this.waitForPodDeleted(core, platform.namespace, resources.podName);
    await this.deleteIfPresent(() =>
      core.deleteNamespacedPersistentVolumeClaim({
        name: resources.pvcName,
        namespace: platform.namespace,
      }),
    );
    await this.deleteIfPresent(() =>
      core.deleteNamespacedServiceAccount({
        name: resources.serviceAccountName,
        namespace: platform.namespace,
      }),
    );
  }

  async getWorkspaceStatus(
    resources: WorkspaceKubernetesResources,
  ): Promise<WorkspaceKubernetesStatus> {
    const platform = await this.validatePlatform();
    const core = await this.getCoreApi(platform);

    const [pod, pvc, serviceAccount] = await Promise.all([
      this.readOrNull(() =>
        core.readNamespacedPod({
          name: resources.podName,
          namespace: platform.namespace,
        }),
      ),
      this.readOrNull(() =>
        core.readNamespacedPersistentVolumeClaim({
          name: resources.pvcName,
          namespace: platform.namespace,
        }),
      ),
      this.readOrNull(() =>
        core.readNamespacedServiceAccount({
          name: resources.serviceAccountName,
          namespace: platform.namespace,
        }),
      ),
    ]);

    const container = pod?.status?.containerStatuses?.find(
      status => status.name === 'workspace',
    );
    const podReason =
      container?.state?.waiting?.reason ??
      container?.state?.terminated?.reason ??
      pod?.status?.reason ??
      null;

    return {
      podExists: Boolean(pod),
      podPhase: pod?.status?.phase ?? null,
      podReady: Boolean(container?.ready),
      podReason,
      pvcExists: Boolean(pvc),
      pvcPhase: pvc?.status?.phase ?? null,
      pvcUid: pvc?.metadata?.uid ?? null,
      serviceAccountExists: Boolean(serviceAccount),
    };
  }

  private async getCoreApi(
    platform: WorkspacePlatformConfiguration,
  ): Promise<k8s.CoreV1Api> {
    if (this.coreApi) return this.coreApi;
    const client = new ContainerServiceClient(
      this.getCredential(),
      platform.subscriptionId,
    );
    const credentials = await client.managedClusters.listClusterUserCredentials(
      platform.resourceGroup,
      platform.clusterName,
    );
    const kubeconfig = credentials.kubeconfigs?.[0]?.value;
    if (!kubeconfig)
      throw new Error(
        'WORKSPACE_PLATFORM_NOT_CONFIGURED: AKS user credentials are unavailable',
      );
    const config = new k8s.KubeConfig();
    config.loadFromString(Buffer.from(kubeconfig).toString('utf8'));
    this.coreApi = config.makeApiClient(k8s.CoreV1Api);
    this.customApi = config.makeApiClient(k8s.CustomObjectsApi);
    return this.coreApi;
  }

  private async getCustomObjectsApi(
    platform: WorkspacePlatformConfiguration,
  ): Promise<k8s.CustomObjectsApi> {
    if (this.customApi) return this.customApi;
    await this.getCoreApi(platform);
    if (!this.customApi) {
      throw new Error(
        'WORKSPACE_PLATFORM_NOT_CONFIGURED: Kubernetes custom objects client is unavailable',
      );
    }
    return this.customApi;
  }

  private shouldEnableVpa(input: ProvisionWorkspaceInput): boolean {
    return this.shouldEnableVpaForWorkload({
      componentId: input.componentId,
      developmentProfileId: input.developmentProfileId,
    });
  }

  private shouldEnableVpaForWorkload(input: {
    componentId?: string;
    developmentProfileId?: string;
  }): boolean {
    const globallyEnabled =
      String(
        process.env.CLOUDHUB_WORKSPACE_ENABLE_VPA ?? 'true',
      ).toLowerCase() !== 'false';
    if (!globallyEnabled) return false;

    const heavyByProfile = ['scala-spark', 'python-data'].includes(
      (input.developmentProfileId ?? '').toLowerCase(),
    );
    const componentId = (input.componentId ?? '').toLowerCase();
    const heavyByComponent =
      componentId.includes('detection-engine') ||
      componentId.includes('data-pipeline');

    return heavyByProfile || heavyByComponent;
  }

  private async ensureWorkspaceAutoscaling(
    namespace: string,
    input: ProvisionWorkspaceInput,
    labels: Record<string, string>,
  ): Promise<void> {
    if (!this.shouldEnableVpa(input)) {
      return;
    }

    const platform = getWorkspacePlatformConfiguration();
    const custom = await this.getCustomObjectsApi(platform);

    const minCpu = process.env.CLOUDHUB_WORKSPACE_VPA_MIN_CPU ?? '1';
    const minMemory = process.env.CLOUDHUB_WORKSPACE_VPA_MIN_MEMORY ?? '2Gi';
    const maxCpu = process.env.CLOUDHUB_WORKSPACE_VPA_MAX_CPU ?? '8';
    const maxMemory = process.env.CLOUDHUB_WORKSPACE_VPA_MAX_MEMORY ?? '16Gi';
    const updateMode = process.env.CLOUDHUB_WORKSPACE_VPA_UPDATE_MODE ?? 'Auto';

    const body = {
      apiVersion: 'autoscaling.k8s.io/v1',
      kind: 'VerticalPodAutoscaler',
      metadata: {
        name: `${input.resources.podName}-vpa`,
        labels,
      },
      spec: {
        targetRef: {
          apiVersion: 'v1',
          kind: 'Pod',
          name: input.resources.podName,
        },
        updatePolicy: {
          updateMode,
        },
        resourcePolicy: {
          containerPolicies: [
            {
              containerName: 'workspace',
              minAllowed: {
                cpu: minCpu,
                memory: minMemory,
              },
              maxAllowed: {
                cpu: maxCpu,
                memory: maxMemory,
              },
            },
          ],
        },
      },
    };

    try {
      await this.createIfAbsent(() =>
        custom.createNamespacedCustomObject({
          group: 'autoscaling.k8s.io',
          version: 'v1',
          namespace,
          plural: 'verticalpodautoscalers',
          body,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Workspace VPA creation skipped for ${input.workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async createPod(
    core: k8s.CoreV1Api,
    namespace: string,
    input: ProvisionWorkspaceInput,
    labels: Record<string, string>,
  ): Promise<void> {
    const options = this.runtimeOptions();
    const dependencyFlags = {
      postgresql: Boolean(input.dependencies?.postgresql),
      kafka: Boolean(input.dependencies?.kafka),
      temporal: Boolean(input.dependencies?.temporal),
    };
    const temporalEnabled =
      options.enableTemporalSidecar &&
      (dependencyFlags.temporal || dependencyFlags.postgresql);

    const databaseName =
      `${input.componentId.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_dev`
        .replace(/^_+|_+$/g, '')
        .slice(0, 63) || 'workspace_dev';

    const env: k8s.V1EnvVar[] = [];
    if (options.onePasswordAccount) {
      env.push({
        name: 'ONEPASSWORD_ACCOUNT',
        value: options.onePasswordAccount,
      });
    }
    if (options.githubPatSecretName) {
      env.push({
        name: 'GITHUB_PAT',
        valueFrom: {
          secretKeyRef: {
            name: options.githubPatSecretName,
            key: options.githubPatSecretKey,
          },
        },
      });
    }
    if (dependencyFlags.postgresql) {
      env.push({ name: 'POSTGRES_HOST', value: 'localhost' });
      env.push({ name: 'POSTGRES_PORT', value: '5432' });
      env.push({ name: 'POSTGRES_DB', value: databaseName });
    }
    if (dependencyFlags.kafka) {
      env.push({ name: 'KAFKA_BROKERS', value: 'localhost:9092' });
    }
    if (temporalEnabled) {
      env.push({ name: 'TEMPORAL_ADDRESS', value: 'localhost:7233' });
    }

    const volumeMounts: k8s.V1VolumeMount[] = [
      {
        name: 'workspace-storage',
        mountPath: options.workspaceMountPath,
      },
    ];
    const volumes: k8s.V1Volume[] = [
      {
        name: 'workspace-storage',
        persistentVolumeClaim: { claimName: input.resources.pvcName },
      },
    ];

    if (options.dockerSocketMountEnabled) {
      volumeMounts.push({
        name: 'docker-socket',
        mountPath: '/var/run/docker.sock',
      });
      volumes.push({
        name: 'docker-socket',
        hostPath: {
          path: '/var/run/docker.sock',
          type: 'Socket',
        },
      });
    }

    if (options.kubeconfigSecretName) {
      volumeMounts.push({
        name: 'kubeconfig',
        mountPath: '/home/developer/.kube',
        readOnly: true,
      });
      volumes.push({
        name: 'kubeconfig',
        secret: {
          secretName: options.kubeconfigSecretName,
        },
      });
    }

    const containers: k8s.V1Container[] = [
      {
        name: 'workspace',
        image: input.image,
        command: ['/bin/bash'],
        args: ['-c', 'while true; do sleep 30; done;'],
        resources: {
          requests: {
            cpu: input.resourceProfile.cpuRequest,
            memory: input.resourceProfile.memoryRequest,
          },
          limits: {
            cpu: input.resourceProfile.cpuLimit,
            memory: input.resourceProfile.memoryLimit,
          },
        },
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ['ALL'] },
        },
        env,
        ports: [
          { containerPort: 8080, name: 'vscode' },
          { containerPort: 8000, name: 'app' },
        ],
        volumeMounts,
      },
    ];

    if (dependencyFlags.postgresql) {
      containers.push({
        name: 'postgres-sidecar',
        image: options.postgresSidecarImage,
        env: [
          {
            name: 'POSTGRES_PASSWORD',
            valueFrom: {
              secretKeyRef: {
                name: options.postgresSecretName,
                key: options.postgresSecretKey,
              },
            },
          },
          { name: 'POSTGRES_DB', value: databaseName },
        ],
        ports: [{ containerPort: 5432, name: 'postgres' }],
      });
    }

    if (dependencyFlags.kafka) {
      const kafkaEnv: k8s.V1EnvVar[] = [
        { name: 'KAFKA_CFG_NODE_ID', value: '0' },
        { name: 'KAFKA_CFG_PROCESS_ROLES', value: 'controller,broker' },
      ];
      if (options.kafkaSecretName && options.kafkaSecretKey) {
        kafkaEnv.push({
          name: options.kafkaSecretEnvName,
          valueFrom: {
            secretKeyRef: {
              name: options.kafkaSecretName,
              key: options.kafkaSecretKey,
            },
          },
        });
      }

      containers.push({
        name: 'kafka-sidecar',
        image: options.kafkaSidecarImage,
        env: kafkaEnv,
        ports: [{ containerPort: 9092, name: 'kafka' }],
      });
    }

    if (temporalEnabled) {
      const temporalEnv: k8s.V1EnvVar[] = [
        { name: 'POSTGRES_HOST', value: 'localhost' },
        { name: 'POSTGRES_PORT', value: '5432' },
      ];
      if (options.temporalSecretName && options.temporalSecretKey) {
        temporalEnv.push({
          name: options.temporalSecretEnvName,
          valueFrom: {
            secretKeyRef: {
              name: options.temporalSecretName,
              key: options.temporalSecretKey,
            },
          },
        });
      }

      containers.push({
        name: 'temporal-sidecar',
        image: options.temporalSidecarImage,
        env: temporalEnv,
        ports: [{ containerPort: 7233, name: 'temporal' }],
      });
    }

    await this.createIfAbsent(() =>
      core.createNamespacedPod({
        namespace,
        body: {
          metadata: { name: input.resources.podName, labels },
          spec: {
            serviceAccountName: input.resources.serviceAccountName,
            restartPolicy: 'Never',
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000,
              seccompProfile: { type: 'RuntimeDefault' },
            },
            containers,
            volumes,
          },
        },
      }),
    );
  }

  private labels(input: ProvisionWorkspaceInput): Record<string, string> {
    const sanitize = (value: string): string =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 63);
    const developer = input.developerRef ? sanitize(input.developerRef) : null;
    return {
      'app.kubernetes.io/managed-by': 'cloudhub',
      'cloudhub.io/resource-type': 'developer-workspace',
      'cloudhub.io/workspace-id': input.workspaceId,
      'cloudhub.io/component-id': input.componentId,
      'cloudhub.io/development-profile': input.developmentProfileId,
      'cloudhub.io/resource-profile': input.resourceProfile.id,
      ...(developer ? { 'cloudhub.io/developer': developer } : {}),
    };
  }

  private async waitForReady(
    core: k8s.CoreV1Api,
    namespace: string,
    podName: string,
    pvcName: string,
  ): Promise<void> {
    let lastStatus: WorkspaceKubernetesStatus | null = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const [pod, pvc] = await Promise.all([
        core.readNamespacedPod({ name: podName, namespace }),
        core.readNamespacedPersistentVolumeClaim({ name: pvcName, namespace }),
      ]);
      const container = pod.status?.containerStatuses?.find(
        status => status.name === 'workspace',
      );
      const podReason =
        container?.state?.waiting?.reason ??
        container?.state?.terminated?.reason ??
        pod.status?.reason ??
        null;
      lastStatus = {
        podExists: true,
        podPhase: pod.status?.phase ?? null,
        podReady: Boolean(container?.ready),
        podReason,
        pvcExists: true,
        pvcPhase: pvc.status?.phase ?? null,
        pvcUid: pvc.metadata?.uid ?? null,
        serviceAccountExists: true,
      };
      if (
        pvc.status?.phase === 'Bound' &&
        pod.status?.phase === 'Running' &&
        container?.ready
      )
        return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(this.readinessFailureMessage(lastStatus));
  }

  private readinessFailureMessage(
    status: WorkspaceKubernetesStatus | null,
  ): string {
    if (!status) {
      return 'WORKSPACE_READY_TIMEOUT: Pod or PVC did not become ready within two minutes';
    }

    if (status.pvcPhase && status.pvcPhase !== 'Bound') {
      return `WORKSPACE_PVC_PENDING: Workspace storage is not bound yet (phase=${status.pvcPhase}).`;
    }

    if (!status.podExists) {
      return 'WORKSPACE_POD_NOT_FOUND: Workspace pod was not found in the workspace namespace.';
    }

    if (status.podReason === 'ErrImagePull') {
      return 'WORKSPACE_IMAGE_PULL_FAILED: Workspace development image could not be pulled.';
    }
    if (status.podReason === 'ImagePullBackOff') {
      return 'WORKSPACE_IMAGE_UNAVAILABLE: Workspace development image is unavailable.';
    }
    if (status.podReason === 'Unschedulable') {
      return 'WORKSPACE_CLUSTER_CAPACITY: Workspace pod is unschedulable due to cluster capacity.';
    }
    if (status.podReason === 'CrashLoopBackOff') {
      return 'WORKSPACE_CONTAINER_FAILED: Workspace container is crash looping.';
    }
    if (status.podPhase === 'Pending') {
      return 'WORKSPACE_PENDING: Workspace is waiting for compute resources.';
    }

    return `WORKSPACE_READY_TIMEOUT: Pod phase=${
      status.podPhase ?? 'unknown'
    } ready=${status.podReady} pvcPhase=${
      status.pvcPhase ?? 'unknown'
    } reason=${status.podReason ?? 'none'}`;
  }

  private async waitForPodDeleted(
    core: k8s.CoreV1Api,
    namespace: string,
    podName: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const pod = await this.readOrNull(() =>
        core.readNamespacedPod({ name: podName, namespace }),
      );
      if (!pod) return;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(
      'WORKSPACE_POD_DELETE_TIMEOUT: Workspace pod deletion timed out.',
    );
  }

  private async createIfAbsent(
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (this.statusCode(error) !== 409) throw error;
    }
  }
  private async deleteIfPresent(
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (this.statusCode(error) !== 404) throw error;
    }
  }
  private async readOrNull<T>(
    operation: () => Promise<T | { body: T }>,
  ): Promise<T | null> {
    try {
      const response = await operation();
      if (
        typeof response === 'object' &&
        response !== null &&
        'body' in response
      ) {
        return (response as { body: T }).body;
      }
      return response as T;
    } catch (error) {
      if (this.statusCode(error) === 404) return null;
      throw error;
    }
  }
  private statusCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const typed = error as {
      response?: { statusCode?: number; statusCodeValue?: number };
      statusCode?: number;
      code?: number;
      body?: { code?: number };
    };
    return (
      typed.response?.statusCode ??
      typed.response?.statusCodeValue ??
      typed.statusCode ??
      typed.code ??
      typed.body?.code
    );
  }

  // Placeholder hook for future process snapshot/restore integration.
  private async restoreProcesses(
    namespace: string,
    podName: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.debug(
      `Workspace resume restore hook executed for workspace=${workspaceId} namespace=${namespace} pod=${podName}`,
    );
  }

  private async notifyWorkspaceResumed(
    namespace: string,
    workspaceId: string,
    developerRef?: string,
  ): Promise<void> {
    this.logger.info(
      `Workspace resumed: workspace=${workspaceId} namespace=${namespace}${
        developerRef ? ` developer=${developerRef}` : ''
      }`,
    );
  }
}
