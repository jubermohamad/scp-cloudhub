import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SidebarContent } from './Sidebar';
import { sreClustersPageExtension } from './srePage';
import { k8sHealthCheckPageExtension } from './k8sHealthCheckPage';
import { workflowsCatalogPageExtension } from './templatesPage';
import { tailscaleApprovalsPageExtension } from './tailscaleApprovalsPage';

export {
  sreClustersPageExtension,
  k8sHealthCheckPageExtension,
  workflowsCatalogPageExtension,
  tailscaleApprovalsPageExtension,
  SidebarContent,
};

export const navModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    SidebarContent,
    sreClustersPageExtension,
    k8sHealthCheckPageExtension,
    workflowsCatalogPageExtension,
    tailscaleApprovalsPageExtension,
  ],
});
