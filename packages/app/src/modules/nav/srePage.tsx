import { PageBlueprint } from '@backstage/frontend-plugin-api';
import { SREClustersPage } from '../../components/SREClustersPage';
import { PersonaGuard } from '../../components/PersonaGuard';

export const sreClustersPageExtension = PageBlueprint.make({
  name: 'sre',
  params: {
    path: '/sre/clusters',
    loader: async () => (
      <PersonaGuard
        allowed={['cloudhub-platform', 'sre']}
        resource="Environment Health"
      >
        <SREClustersPage />
      </PersonaGuard>
    ),
  },
});
