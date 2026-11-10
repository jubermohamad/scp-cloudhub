import { PageBlueprint } from '@backstage/frontend-plugin-api';
import { TailscaleJumpboxApprovalsPage } from '../../components/TailscaleJumpboxApprovalsPage';

export const tailscaleApprovalsPageExtension = PageBlueprint.make({
  name: 'tailscale-jumpbox-approvals',
  params: {
    path: '/eng-tools/tailscale-jumpbox-approvals',
    loader: async () => <TailscaleJumpboxApprovalsPage />,
  },
});
