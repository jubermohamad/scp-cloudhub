import { CommonResDeployPage } from '../CommonResDeployPage';
import { DeploymentLayout } from './DeploymentLayout';

export function DeployCommonResPage() {
  return (
    <DeploymentLayout>
      <CommonResDeployPage isTab />
    </DeploymentLayout>
  );
}
