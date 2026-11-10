import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';
import { MemoryRouter } from 'react-router-dom';
import { K8sHealthCheckPage } from './K8sHealthCheckPage';

const muiTheme = (lightTheme as any).getTheme ? (lightTheme as any).getTheme('v5') : lightTheme;

const renderWithTheme = (ui: ReactElement) =>
  render(<ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>);

describe('K8sHealthCheckPage', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });

  it('loads test cases and previews commands in dry-run mode without execution results', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          testCases: [
            {
              id: 'api-reachable',
              name: 'Kubernetes API Reachability',
              description: 'Verifies API query via kubectl.',
            },
            {
              id: 'nodes-ready',
              name: 'All Nodes Ready',
              description: 'Fails if any node is not Ready.',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          summary: {
            total: 2,
            passed: 0,
            failed: 0,
            mode: 'dry-run',
            startedAt: '2026-07-06T00:00:00.000Z',
          },
          preview: [
            {
              id: 'api-reachable',
              name: 'Kubernetes API Reachability',
              description: 'Verifies API query via kubectl.',
              command: 'kubectl',
              args: ['--context', 'aks-dev-01', 'version', '--short'],
              timeoutMs: 90000,
              commandText: 'kubectl --context aks-dev-01 version --short',
            },
          ],
          results: [],
        }),
      });

    renderWithTheme(
      <MemoryRouter initialEntries={['/operations/k8s-health-check']}>
        <K8sHealthCheckPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Kubernetes API Reachability'),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('aks-prod-eastus-001'), {
      target: { value: 'aks-dev-01' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preview Commands' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Dry-run preview only. No test commands were executed.',
        ),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText('kubectl --context aks-dev-01 version --short'),
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/k8s-health-check/test-cases',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/k8s-health-check/run',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.dryRun).toBe(true);
    expect(body.clusterContext).toBe('aks-dev-01');
  });
});
