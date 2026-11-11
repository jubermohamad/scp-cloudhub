import { AksWorkflowPage } from '../AksWorkflowPage';
import { DeploymentLayout } from './DeploymentLayout';

export function CreateAksPage() {
  return (
    <DeploymentLayout>
      <AksWorkflowPage isTab />
    </DeploymentLayout>
  );
}
