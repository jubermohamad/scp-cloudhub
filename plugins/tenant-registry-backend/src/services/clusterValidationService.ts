import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  CloudDiscoveryProvider,
  DiscoveredCluster,
  ValidationResult,
} from '../types';
import { TenantRegistryService } from './tenantRegistryService';

const NAME_PATTERN = /^aks-[a-z0-9]+-(dev|qa|uat|test|stage|prod)-[a-z0-9]+$/;
const REQUIRED_TAGS = ['customer', 'environment', 'managed-by', 'region'];

export class ClusterValidationService {
  private readonly registryService: TenantRegistryService;
  private readonly logger: LoggerService;

  constructor(registryService: TenantRegistryService, logger: LoggerService) {
    this.registryService = registryService;
    this.logger = logger;
  }

  async validate(
    cluster: DiscoveredCluster,
    provider: CloudDiscoveryProvider,
  ): Promise<ValidationResult> {
    const issues: string[] = [];

    const providerValidation = await provider.validateCluster(cluster);

    const namingConventionValid = NAME_PATTERN.test(cluster.clusterName);
    if (!namingConventionValid) {
      issues.push(
        'Naming convention mismatch: expected aks-<tenant>-<env>-<region>',
      );
    }

    const missingTags = REQUIRED_TAGS.filter(tag => !cluster.tags?.[tag]);
    const tagsValid = missingTags.length === 0;
    if (!tagsValid) {
      issues.push(`Missing required tags: ${missingTags.join(', ')}`);
    }

    const onboardingExists = await this.registryService.clusterAlreadyOnboarded(
      cluster.clusterName,
      cluster.subscriptionId,
    );
    if (onboardingExists) {
      issues.push('Cluster already onboarded');
    }

    const provisioningStateSucceeded =
      providerValidation.provisioningStateSucceeded ??
      cluster.provisioningState.toLowerCase() === 'succeeded';
    if (!provisioningStateSucceeded) {
      issues.push(`Provisioning state is ${cluster.provisioningState}`);
    }

    const clusterReachable = providerValidation.clusterReachable ?? false;
    if (!clusterReachable) {
      issues.push('Cluster not reachable');
    }

    const kubeconfigRetrievable =
      providerValidation.kubeconfigRetrievable ?? false;
    if (!kubeconfigRetrievable) {
      issues.push('Kubeconfig not retrievable');
    }

    const kubernetesApiReachable =
      providerValidation.kubernetesApiReachable ?? false;
    if (!kubernetesApiReachable) {
      issues.push('Kubernetes API not reachable');
    }

    const detectedEnvironment =
      providerValidation.detectedEnvironment ?? cluster.environment ?? null;

    const result: ValidationResult = {
      clusterReachable,
      provisioningStateSucceeded,
      kubernetesApiReachable,
      kubeconfigRetrievable,
      namingConventionValid,
      tagsValid,
      notAlreadyOnboarded: !onboardingExists,
      detectedEnvironment,
      issues,
    };

    this.logger.info(
      `[tenant-registry] validation for ${cluster.clusterName} -> ${
        issues.length ? 'FAIL' : 'PASS'
      }`,
    );

    return result;
  }
}
