import * as k8s from '@kubernetes/client-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { NamespaceService } from './namespaceService';
import { PlatformService } from './platformService';

export interface WorkspaceConfig {
  name: string; // e.g., invhub-copilot
  username: string; // e.g., alex.chen
  email: string; // e.g., alex.chen@company.com
  team: string; // e.g., sensa-investigation
  language: string; // e.g., python, typescript, java
  framework: string; // e.g., fastapi, react, spring-boot
  dependencies: string[]; // e.g., ['postgres', 'kafka', 'redis']
  resources: {
    cpu: string;
    memory: string;
    storage: string;
  };
}

export class WorkspaceService {
  private k8sApi: k8s.CoreV1Api;
  private namespaceService: NamespaceService;
  private platformService: PlatformService;

  constructor(private readonly logger: LoggerService) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    this.namespaceService = new NamespaceService(logger);
    this.platformService = new PlatformService(logger);
  }

  /**
   * Generate workspace pod name
   */
  private generatePodName(workspaceName: string): string {
    const cleanName = workspaceName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return `${cleanName}-dev`;
  }

  /**
   * Get the namespace for a developer
   */
  private getDeveloperNamespace(username: string): string {
    const clean = username
      .toLowerCase()
      .split('@')[0]
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return `sri-dev-${clean}`;
  }

  /**
   * Create or update workspace for developer
   */
  async createWorkspace(config: WorkspaceConfig): Promise<{
    workspaceId: string;
    namespace: string;
    podName: string;
    connectionDetails: any;
  }> {
    this.logger.info(
      `[workspace-service] Creating workspace ${config.name} for ${config.username}`,
    );

    // 1. Ensure developer namespace exists
    const { namespace, isNew } =
      await this.namespaceService.getOrCreateDeveloperNamespace({
        username: config.username,
        email: config.email,
        team: config.team,
        resourceQuota: {
          cpu: config.resources.cpu,
          memory: config.resources.memory,
          storage: config.resources.storage,
        },
      });

    if (isNew) {
      this.logger.info(
        `[workspace-service] Created new namespace ${namespace}`,
      );
    }

    // 2. Get platform service connection details (shared services)
    const platformServices = await this.platformService.getPlatformServices({
      username: config.username,
      workspaceName: config.name,
      dependencies: config.dependencies,
    });

    // 3. Generate workspace pod manifest
    const podName = this.generatePodName(config.name);
    const podManifest = this.generatePodManifest({
      podName,
      namespace,
      username: config.username,
      workspaceName: config.name,
      language: config.language,
      framework: config.framework,
      platformServices,
      resources: config.resources,
    });

    // 4. Create or update the pod
    try {
      // Check if pod exists
      await this.k8sApi.readNamespacedPod({ name: podName, namespace });
      // Delete existing pod
      await this.k8sApi.deleteNamespacedPod({ name: podName, namespace });
      this.logger.info(`[workspace-service] Deleted existing pod ${podName}`);
    } catch (error: any) {
      if (error.statusCode !== 404) {
        throw error;
      }
    }

    // Create new pod
    await this.k8sApi.createNamespacedPod({
      namespace,
      body: podManifest,
    });
    this.logger.info(
      `[workspace-service] Created pod ${podName} in namespace ${namespace}`,
    );

    // 5. Create service for the workspace
    await this.createWorkspaceService(namespace, podName, config.name);

    // 6. Create ingress for the workspace (optional)
    if (config.dependencies.includes('web-ui')) {
      await this.createWorkspaceIngress(namespace, podName, config.username);
    }

    // 7. Generate workspace ID
    const workspaceId = `ws-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    return {
      workspaceId,
      namespace,
      podName,
      connectionDetails: {
        // Developer can connect via kubectl port-forward
        portForwardCommand: `kubectl port-forward -n ${namespace} ${podName} 8000:8000`,
        // Or via VS Code Remote
        vscodeCommand: `VS Code: Remote → Attach to Kubernetes Pod → ${podName} (${namespace})`,
        // Environment variables
        env: platformServices.env,
        // Ingress URL (if web UI)
        ingressUrl: `https://${podName}.${namespace}.sri-dev.symphonyfs.com`,
      },
    };
  }

  /**
   * Generate the pod manifest
   */
  private generatePodManifest(params: {
    podName: string;
    namespace: string;
    username: string;
    workspaceName: string;
    language: string;
    framework: string;
    platformServices: any;
    resources: any;
  }): k8s.V1Pod {
    const pod = new k8s.V1Pod();
    pod.metadata = {
      name: params.podName,
      namespace: params.namespace,
      labels: {
        app: params.workspaceName,
        'sri.workspace': 'true',
        'sri.developer': params.username,
        'sri.language': params.language,
        'app.kubernetes.io/managed-by': 'sri-portal',
      },
      annotations: {
        'sri.created-at': new Date().toISOString(),
        'sri.framework': params.framework,
      },
    };

    // Determine base image based on language
    const imageMap: Record<string, string> = {
      python: 'sri-dev-python:latest',
      typescript: 'sri-dev-typescript:latest',
      java: 'sri-dev-java:latest',
      scala: 'sri-dev-scala:latest',
      go: 'sri-dev-go:latest',
    };
    const image = imageMap[params.language] || 'sri-dev-base:latest';

    pod.spec = {
      containers: [
        {
          name: 'dev-environment',
          image: image,
          command: ['/bin/bash'],
          args: ['-c', 'while true; do sleep 30; done;'],
          resources: {
            requests: {
              cpu: params.resources.cpu,
              memory: params.resources.memory,
            },
            limits: {
              cpu: params.resources.cpu,
              memory: params.resources.memory,
            },
          },
          env: [
            // Developer identification
            {
              name: 'SRI_DEVELOPER',
              value: params.username,
            },
            {
              name: 'SRI_WORKSPACE',
              value: params.workspaceName,
            },
            {
              name: 'SRI_NAMESPACE',
              value: params.namespace,
            },
            // Platform service connections
            ...this.generateEnvVars(
              params.platformServices,
              params.username,
              params.workspaceName,
            ),
          ],
          envFrom: [
            {
              secretRef: {
                name: 'default-secrets',
                optional: true,
              },
            },
          ],
          volumeMounts: [
            {
              name: 'workspace-storage',
              mountPath: '/workspace',
            },
            {
              name: 'docker-socket',
              mountPath: '/var/run/docker.sock',
            },
          ],
        },
      ],
      volumes: [
        {
          name: 'workspace-storage',
          persistentVolumeClaim: {
            claimName: `pvc-${params.username}-${params.workspaceName}`,
          },
        },
        {
          name: 'docker-socket',
          hostPath: {
            path: '/var/run/docker.sock',
          },
        },
      ],
      // If we want to auto-clone repos on startup
      initContainers: [
        {
          name: 'setup-workspace',
          image: 'alpine/git:latest',
          command: ['/bin/sh', '-c'],
          args: [
            `
              cd /workspace
              if [ ! -d "${params.workspaceName}" ]; then
                git clone https://github.com/SymphonyFS/${params.workspaceName}.git
                cd ${params.workspaceName}
                if [ -f "package.json" ]; then
                  npm install
                fi
                if [ -f "requirements.txt" ]; then
                  pip install -r requirements.txt
                fi
              fi
            `,
          ],
          volumeMounts: [
            {
              name: 'workspace-storage',
              mountPath: '/workspace',
            },
          ],
        },
      ],
    };

    return pod;
  }

  /**
   * Generate environment variables for platform services
   */
  private generateEnvVars(
    platformServices: any,
    username: string,
    workspaceName: string,
  ): k8s.V1EnvVar[] {
    const envVars: k8s.V1EnvVar[] = [];

    // PostgreSQL
    if (platformServices.postgres) {
      envVars.push(
        { name: 'POSTGRES_HOST', value: platformServices.postgres.host },
        {
          name: 'POSTGRES_PORT',
          value: String(platformServices.postgres.port),
        },
        { name: 'POSTGRES_DB', value: platformServices.postgres.database },
        {
          name: 'POSTGRES_SCHEMA',
          value: `dev_${username.replace(/[^a-z0-9]/g, '_')}`,
        },
        { name: 'POSTGRES_USER', value: platformServices.postgres.user },
        {
          name: 'POSTGRES_PASSWORD',
          valueFrom: {
            secretKeyRef: { name: 'postgres-credentials', key: 'password' },
          },
        },
      );
    }

    // Kafka
    if (platformServices.kafka) {
      envVars.push(
        { name: 'KAFKA_BOOTSTRAP', value: platformServices.kafka.bootstrap },
        {
          name: 'KAFKA_CONSUMER_GROUP',
          value: `dev_${username.replace(/[^a-z0-9]/g, '_')}_${workspaceName}`,
        },
        {
          name: 'KAFKA_TOPIC_PREFIX',
          value: `dev.${username.replace(/[^a-z0-9]/g, '_')}`,
        },
      );
    }

    // Redis
    if (platformServices.redis) {
      envVars.push(
        { name: 'REDIS_HOST', value: platformServices.redis.host },
        {
          name: 'REDIS_PORT',
          value: String(platformServices.redis.port),
        },
        {
          name: 'REDIS_KEY_PREFIX',
          value: `dev:${username.replace(/[^a-z0-9]/g, '_')}:`,
        },
      );
    }

    // Temporal
    if (platformServices.temporal) {
      envVars.push(
        { name: 'TEMPORAL_HOST', value: platformServices.temporal.host },
        {
          name: 'TEMPORAL_PORT',
          value: String(platformServices.temporal.port),
        },
        {
          name: 'TEMPORAL_NAMESPACE',
          value: `dev_${username.replace(/[^a-z0-9]/g, '_')}`,
        },
      );
    }

    // MinIO
    if (platformServices.minio) {
      envVars.push(
        { name: 'MINIO_HOST', value: platformServices.minio.host },
        {
          name: 'MINIO_PORT',
          value: String(platformServices.minio.port),
        },
        {
          name: 'MINIO_BUCKET',
          value: platformServices.minio.bucket,
        },
      );
    }

    return envVars;
  }

  /**
   * Create service for workspace
   */
  private async createWorkspaceService(
    namespace: string,
    _podName: string,
    workspaceName: string,
  ): Promise<void> {
    const service = new k8s.V1Service();
    service.metadata = {
      name: `${workspaceName}-service`,
      namespace: namespace,
      labels: {
        app: workspaceName,
        'sri.workspace': 'true',
      },
    };
    service.spec = {
      selector: {
        app: workspaceName,
      },
      ports: [
        { name: 'http', port: 8000, targetPort: 8000 },
        { name: 'https', port: 8443, targetPort: 8443 },
        { name: 'debug', port: 5678, targetPort: 5678 }, // Python debugger
        { name: 'vscode', port: 8080, targetPort: 8080 }, // VS Code Server
      ],
      type: 'ClusterIP',
    };

    try {
      await this.k8sApi.createNamespacedService({
        namespace,
        body: service,
      });
    } catch (error: any) {
      if (error.statusCode === 409) {
        // Service already exists, update it
        await this.k8sApi.replaceNamespacedService({
          name: `${workspaceName}-service`,
          namespace,
          body: service,
        });
      } else {
        throw error;
      }
    }
  }

  /**
   * Create ingress for workspace (for web UI)
   */
  private async createWorkspaceIngress(
    namespace: string,
    podName: string,
    _username: string,
  ): Promise<void> {
    // Implementation depends on your ingress controller
    // This is a placeholder
    this.logger.info(
      `[workspace-service] Creating ingress for ${podName} in ${namespace}`,
    );
  }

  /**
   * Delete workspace
   */
  async deleteWorkspace(
    workspaceName: string,
    username: string,
  ): Promise<void> {
    const namespace = this.getDeveloperNamespace(username);
    const podName = this.generatePodName(workspaceName);

    try {
      await this.k8sApi.deleteNamespacedPod({
        name: podName,
        namespace,
      });
      this.logger.info(
        `[workspace-service] Deleted pod ${podName} in namespace ${namespace}`,
      );
    } catch (error: any) {
      if (error.statusCode !== 404) {
        throw error;
      }
    }

    // Delete service
    try {
      await this.k8sApi.deleteNamespacedService({
        name: `${workspaceName}-service`,
        namespace,
      });
    } catch (error: any) {
      if (error.statusCode !== 404) {
        throw error;
      }
    }
  }

  /**
   * List workspaces for a developer
   */
  async listWorkspaces(username: string): Promise<any[]> {
    const namespace = this.getDeveloperNamespace(username);

    try {
      const pods = await this.k8sApi.listNamespacedPod({
        namespace,
        fieldSelector: 'sri.workspace=true',
      });

      const workspaces = [];
      for (const pod of pods.items) {
        const podName = pod.metadata?.name || '';
        const labels = pod.metadata?.labels || {};
        const workspaceName = labels.app || 'unknown';

        // Get usage
        const usage = await this.namespaceService.getNamespaceUsage(namespace);

        workspaces.push({
          name: workspaceName,
          podName: podName,
          namespace: namespace,
          status: pod.status?.phase || 'unknown',
          created: pod.metadata?.creationTimestamp,
          resources: {
            cpu: this.parseCpu(
              pod.spec?.containers[0]?.resources?.requests?.cpu,
            ),
            memory: this.parseMemory(
              pod.spec?.containers[0]?.resources?.requests?.memory,
            ),
          },
          usage,
          connection: {
            portForward: `kubectl port-forward -n ${namespace} ${podName} 8000:8000`,
          },
        });
      }

      return workspaces;
    } catch (error: any) {
      if (error.statusCode === 404) {
        return [];
      }
      throw error;
    }
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
}
