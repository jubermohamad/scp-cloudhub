import { SriDeploymentHubPage } from '../SriDeploymentHubPage';
import { DeploymentLayout } from './DeploymentLayout';

export function DeploySriPage() {
  return (
    <DeploymentLayout>
      <SriDeploymentHubPage isTab />
    </DeploymentLayout>
  );
}
