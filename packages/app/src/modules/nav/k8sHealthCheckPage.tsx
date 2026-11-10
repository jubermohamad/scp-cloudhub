import { PageBlueprint } from '@backstage/frontend-plugin-api';
import { K8sHealthCheckPage } from '../../components/K8sHealthCheckPage';
import { PersonaGuard } from '../../components/PersonaGuard';

export const k8sHealthCheckPageExtension = PageBlueprint.make({
  name: 'k8s-health-check',
  params: {
    path: '/operations/k8s-health-check',
    loader: async () => (
      <PersonaGuard
        allowed={['cloudhub-platform', 'sre']}
        resource="K8s Health Check"
      >
        <K8sHealthCheckPage />
      </PersonaGuard>
    ),
  },
});
