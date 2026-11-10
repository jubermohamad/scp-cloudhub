import type { LoggerService } from '@backstage/backend-plugin-api';
import type * as k8s from '@kubernetes/client-node';
import type { AzureClientFactory } from './services/AzureClientFactory';
import type { KubernetesClientFactory } from './services/KubernetesClientFactory';

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

export interface HealthResult {
  name: string;
  status: CheckStatus;
  score: number;
  weight: number;
  reason?: string;
  findings?: string[];
  details?: Record<string, unknown>;
}

export interface CertificationResult {
  clusterId: string;
  clusterName: string;
  overallScore: number;
  status: CertificationStatus;
  certified: boolean;
  reason: string;
  runTimestamp: string;
  checks: HealthResult[];
  formattedOutput?: string;
}

export interface HealthCheckContext {
  azureClientFactory: AzureClientFactory;
  kubernetesClientFactory: KubernetesClientFactory;
  kubeConfig?: k8s.KubeConfig;
  logger: LoggerService;
  isSimulated?: boolean;
}

export interface HealthCheck {
  name: string;
  weight: number;
  run(cluster: PlatformCluster, context: HealthCheckContext): Promise<HealthResult>;
}

export interface AksHealthRunRecord {
  id: string;
  cluster_id: string;
  run_timestamp: Date | string;
  overall_score: number;
  status: string;
  certified: boolean;
  reason: string;
}

export interface AksHealthCheckResultRecord {
  id: string;
  run_id: string;
  check_name: string;
  status: string;
  score: number;
  reason: string;
  details_json: Record<string, unknown>;
}

export interface HistoricalRunItem {
  id?: string;
  date: string;
  score: number;
  status: string;
  certified?: boolean;
  reason?: string;
}
