import { render, screen, waitFor } from '@testing-library/react';
import { lightTheme } from '@backstage/theme';

const muiTheme = (lightTheme as any).getTheme ? (lightTheme as any).getTheme('v5') : lightTheme;
import { ThemeProvider } from '@mui/material/styles';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { TestApiProvider } from '@backstage/test-utils';
import { GpuLogStreamingDialog } from './GpuLogStreamingDialog';
import type { GpuInstanceRecord } from './types';

const discoveryApi = {
  getBaseUrl: jest.fn().mockResolvedValue('http://localhost/api'),
};

const fetchApi = {
  fetch: jest.fn().mockResolvedValue(new Response(JSON.stringify({ lines: [] }))),
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <TestApiProvider
      apis={[
        [discoveryApiRef, discoveryApi],
        [fetchApiRef, fetchApi],
      ]}
    >
      <ThemeProvider theme={muiTheme}>{children}</ThemeProvider>
    </TestApiProvider>
  );
}

const instance: GpuInstanceRecord = {
  id: 'gpu-123',
  name: 'gpu-team-a-001',
  gpuSku: 'a100',
  vmSize: 'Standard_NC24ads_A100_v4',
  region: 'eastus2',
  resourceGroup: 'rg-gpu-sdc',
  subscriptionId: '00000000-0000-0000-0000-000000000000',
  subnetId: '/subscriptions/xxx/subnets/ml-subnet',
  environment: 'dev',
  owner: 'user@symphony.ai',
  businessJustification: 'Research',
  leaseDuration: '30d',
  terraformRepository: 'SymphonySensa/scp-azure-terraform-modules',
  terraformBranch: 'main',
  workflowRunId: 'run-123',
  workflowRunUrl: 'https://app.terraform.io/runs/run-123',
  mode: 'terraform-cloud',
  status: 'PROVISIONING',
  statusMessage: 'GPU VM provisioning workflow dispatched',
  failureReason: null,
  requestedBy: 'user:default/test',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: null,
  deletedAt: null,
};

describe('GpuLogStreamingDialog', () => {
  it('renders the streaming log dialog for a GPU instance', async () => {
    render(
      <GpuLogStreamingDialog
        open
        instance={instance}
        onClose={() => {}}
      />,
      { wrapper: Wrapper },
    );

    expect(
      screen.getByText(/Provisioning logs: gpu-team-a-001/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Live activity log/)).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText(/Waiting for GPU provisioning activity/),
      ).toBeInTheDocument();
    });
  });

  it('renders nothing when no instance is provided', () => {
    const { container } = render(
      <GpuLogStreamingDialog open instance={null} onClose={() => {}} />,
      { wrapper: Wrapper },
    );
    expect(container.firstChild).toBeNull();
  });
});
