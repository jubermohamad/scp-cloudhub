import type { LoggerService } from '@backstage/backend-plugin-api';
import { TerraformCloudService } from './terraformCloudService';

/**
 * Low-cost test VM provisioning via Terraform Cloud, pinned to the approved
 * vm-self-service configuration. Guardrails (SKU allow-list, non-prod env,
 * no public IP) are enforced in that configuration's variables.tf as well as
 * in TestVmService, so neither layer alone can be bypassed.
 */

const TFC_ORGANIZATION = 'sensa-cloud-platform';
const REPOSITORY =
  process.env.CLOUDHUB_TFC_REPOSITORY ??
  process.env.TFC_REPOSITORY ??
  process.env.GITHUB_REPOSITORY ??
  'jubermohamad/platform_cloudhub';
const BRANCH =
  process.env.CLOUDHUB_TFC_BRANCH ??
  process.env.TFC_BRANCH ??
  process.env.GITHUB_REF_NAME ??
  'main';
const WORKING_DIRECTORY =
  process.env.CLOUDHUB_TFC_WORKING_DIRECTORY ??
  process.env.TFC_WORKING_DIRECTORY ??
  'infra/vm-self-service';

export class VmTerraformCloudService extends TerraformCloudService {
  constructor(logger: LoggerService) {
    super({
      logger,
      config: {
        organization: TFC_ORGANIZATION,
        repository: REPOSITORY,
        branch: BRANCH,
        workingDirectory: WORKING_DIRECTORY,
        workspacePrefix: 'vm-',
        label: 'Test VM',
        logPrefix: 'test-vm',
        committerName: 'CloudHub Test VM',
        committerEmail: 'cloudhub-test-vm@symphony.ai',
      },
    });
  }

  async runLogs(runId: string) {
    return super.runLogs(runId);
  }
}
