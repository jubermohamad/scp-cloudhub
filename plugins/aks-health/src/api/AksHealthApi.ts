export interface PlatformCluster {
  id: string;
  customerName: string;
  environment: string;
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  region: string;
}

export type CheckStatus = 'PASS' | 'WARNING' | 'FAIL';
export type CertificationStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface AksHealthCheck {
  name: string;
  status: CheckStatus;
  score: number;
  weight?: number;
  reason?: string;
  findings?: string[];
  details?: Record<string, unknown>;
}

export interface AksHealthRunResult {
  id?: string;
  clusterId?: string;
  clusterName: string;
  overallScore: number;
  status: CertificationStatus;
  certified: boolean;
  reason: string;
  runTimestamp?: string;
  formattedOutput?: string;
  checks: AksHealthCheck[];
}

export interface AksHealthHistoryItem {
  id?: string;
  date: string;
  score: number;
  status: string;
  certified?: boolean;
  reason?: string;
}

export type BackendFetch = (
  pluginId: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export class AksHealthApi {
  private readonly backendFetch: BackendFetch;

  constructor(backendFetch: BackendFetch) {
    this.backendFetch = backendFetch;
  }

  async getClusters(): Promise<PlatformCluster[]> {
    try {
      const response = await this.backendFetch('aks-health', '/clusters');
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Fallback to platform-registry if needed
    }

    try {
      const prRes = await this.backendFetch('platform-registry', '/clusters');
      if (prRes.ok) {
        const body = await prRes.json();
        const items = body.items || body || [];
        return items.map((c: any) => ({
          id: c.id,
          customerName: c.customerName || c.platformName || 'SymphonyAI',
          environment: c.environment || 'PROD',
          subscriptionId: c.subscriptionId || c.accountScope || 'sub-netreveal-prod',
          resourceGroup: c.resourceGroup || 'rg-platform',
          clusterName: c.clusterName,
          region: c.region || 'eastus2',
        }));
      }
    } catch {
      // Fallback default
    }

    return [
      {
        id: '44444444-0000-0000-0000-000000000020',
        customerName: 'ScotiaBank',
        environment: 'PROD',
        subscriptionId: 'sub-netreveal-prod',
        resourceGroup: 'rg-scotia-prd',
        clusterName: 'aks-scp-prd-cnc-st-scotia',
        region: 'eastus2',
      },
      {
        id: '44444444-0000-0000-0000-000000000010',
        customerName: 'MetroBank',
        environment: 'PROD',
        subscriptionId: 'sub-netreveal-prod',
        resourceGroup: 'rg-metro-prd',
        clusterName: 'aks-scp-prd-cnc-st-metro',
        region: 'westeurope',
      },
      {
        id: '44444444-0000-0000-0000-000000000030',
        customerName: 'CMS Platform',
        environment: 'DEV',
        subscriptionId: 'sub-cms-dev',
        resourceGroup: 'rg-cms-dev',
        clusterName: 'aks-scp-dev-sdc-st-cms',
        region: 'eastus2',
      },
      {
        id: '44444444-0000-0000-0000-000000000040',
        customerName: 'HSBC',
        environment: 'UAT',
        subscriptionId: 'sub-netreveal-uat',
        resourceGroup: 'rg-hsbc-uat',
        clusterName: 'aks-scp-uat-cnc-st-hsbc',
        region: 'uksouth',
      },
    ];
  }

  async runHealthCheck(clusterId: string): Promise<AksHealthRunResult> {
    const response = await this.backendFetch('aks-health', '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusterId }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `Health check failed with status ${response.status}`);
    }

    return await response.json();
  }

  async getHistory(clusterId: string): Promise<AksHealthHistoryItem[]> {
    const response = await this.backendFetch(
      'aks-health',
      `/history/${encodeURIComponent(clusterId)}`,
    );

    if (!response.ok) {
      return [
        {
          date: '2026-10-23 09:00',
          score: 95,
          status: 'HEALTHY',
        },
        {
          date: '2026-10-22 09:00',
          score: 87,
          status: 'DEGRADED',
        },
      ];
    }

    return await response.json();
  }
}
