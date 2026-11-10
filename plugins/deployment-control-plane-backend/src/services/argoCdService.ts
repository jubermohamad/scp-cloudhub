import type { LoggerService } from '@backstage/backend-plugin-api';

export class ArgoCdService {
  private readonly logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  private server(): string {
    return process.env.ARGOCD_SERVER ?? '';
  }

  private token(): string {
    return process.env.ARGOCD_AUTH_TOKEN ?? '';
  }

  private isConfigured(): boolean {
    return Boolean(this.server() && this.token());
  }

  async registerCluster(input: {
    clusterName: string;
    clusterServer: string;
    project: string;
  }) {
    if (!this.isConfigured()) {
      this.logger.info(
        `[control-plane] ArgoCD cluster registration simulated for ${input.clusterName}`,
      );
      return { mode: 'simulated', status: 'accepted' };
    }

    const response = await fetch(`${this.server()}/api/v1/clusters`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        server: input.clusterServer,
        name: input.clusterName,
        project: input.project,
      }),
    });

    return { mode: 'argocd-api', status: response.ok ? 'accepted' : 'failed' };
  }

  async createApplicationSet(input: {
    name: string;
    namespace: string;
    spec: Record<string, unknown>;
  }) {
    if (!this.isConfigured()) {
      return { mode: 'simulated', status: 'accepted', name: input.name };
    }

    const response = await fetch(`${this.server()}/api/v1/applicationsets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    return {
      mode: 'argocd-api',
      status: response.ok ? 'accepted' : 'failed',
      name: input.name,
    };
  }

  async triggerSync(appName: string) {
    if (!this.isConfigured()) {
      return { mode: 'simulated', status: 'synced', appName };
    }

    const response = await fetch(
      `${this.server()}/api/v1/applications/${encodeURIComponent(
        appName,
      )}/sync`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prune: false,
          dryRun: false,
          strategy: { apply: { force: false } },
        }),
      },
    );

    return {
      mode: 'argocd-api',
      status: response.ok ? 'synced' : 'failed',
      appName,
    };
  }

  async status(appName: string) {
    if (!this.isConfigured()) {
      return {
        mode: 'simulated',
        appName,
        syncStatus: 'Synced',
        healthStatus: 'Healthy',
        drift: 'None',
      };
    }

    const response = await fetch(
      `${this.server()}/api/v1/applications/${encodeURIComponent(appName)}`,
      {
        headers: {
          Authorization: `Bearer ${this.token()}`,
        },
      },
    );

    if (!response.ok) {
      return {
        mode: 'argocd-api',
        appName,
        syncStatus: 'Unknown',
        healthStatus: 'Unknown',
        drift: 'Unknown',
      };
    }

    const body = await response.json();
    return {
      mode: 'argocd-api',
      appName,
      syncStatus: body?.status?.sync?.status ?? 'Unknown',
      healthStatus: body?.status?.health?.status ?? 'Unknown',
      drift: body?.status?.sync?.status === 'Synced' ? 'None' : 'Detected',
    };
  }
}
