import { PageBlueprint } from '@backstage/frontend-plugin-api';
import { WorkflowsCatalogPage } from '../../components/TemplatesCatalogPage';

export const workflowsCatalogPageExtension = PageBlueprint.make({
  name: 'workflows',
  params: {
    path: '/workflows',
    loader: async () => <WorkflowsCatalogPage />,
  },
});
