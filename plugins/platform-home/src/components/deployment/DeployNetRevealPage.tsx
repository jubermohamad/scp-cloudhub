import { Stage2DeployPage } from '../Stage2DeployPage';
import { DeploymentLayout } from './DeploymentLayout';

export function DeployNetRevealPage() {
  return (
    <DeploymentLayout>
      <Stage2DeployPage isTab />
    </DeploymentLayout>
  );
}
