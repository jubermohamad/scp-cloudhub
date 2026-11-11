import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { SriDeploymentHubPage } from './SriDeploymentHubPage';

const mockBackendFetch = jest.fn();

jest.mock('./DeploymentHistory', () => ({
  DeploymentHistory: () => null,
}));

jest.mock('@internal/plugin-platform-common', () => ({
  SRI_COMPONENTS: [],
  useBackendFetch: () => mockBackendFetch,
}));

describe('SriDeploymentHubPage', () => {
  beforeEach(() => {
    mockBackendFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        applications: [
          { appName: 'invhub', displayName: 'InvHub', description: 'InvHub app' },
          { appName: 'detectionhub', displayName: 'DetectionHub', description: 'DetectionHub app' },
        ],
      }),
    });
  });

  it('renders the SRI Provisioner card first on the deployment page', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={createTheme()}>
          <SriDeploymentHubPage />
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Deploy SRI')).not.toBeNull();
    });

    const provisionerCard = screen.getByRole('button', { name: /SRI Provisioner/i });
    expect(provisionerCard).not.toBeNull();
    expect(provisionerCard.textContent).toContain('Provision SRI environments and services');

    const allButtons = Array.from(document.querySelectorAll('button'));
    expect(allButtons[0]).toBe(provisionerCard);
  });
});
