import '@testing-library/jest-dom';
import type { ReactElement } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';
import { GitHubToolForm } from './GitHubToolForm';

const muiTheme = (lightTheme as any).getTheme ? (lightTheme as any).getTheme('v5') : lightTheme;

const renderWithTheme = (ui: ReactElement) =>
  render(<ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>);

const mockBackendFetch = jest.fn();

jest.mock('@internal/plugin-platform-common', () => ({
  useBackendFetch: () => mockBackendFetch,
}));

describe('GitHubToolForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders request type selector and legacy form by default', async () => {
    mockBackendFetch.mockResolvedValue({
      json: async () => ({ authorized: false, enabled: true }),
    });

    renderWithTheme(
      <GitHubToolForm accent="#1F2937" heroTitle="GitHub" heroDesc="Test" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('request-type-select')).toBeInTheDocument();
    });
    expect(screen.getByText('GitHub Request')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit/i })).toBeInTheDocument();
  });

  it('shows repository creation form when request type changes', async () => {
    mockBackendFetch.mockResolvedValue({
      json: async () => ({ authorized: true, enabled: true }),
      ok: true,
    });

    renderWithTheme(
      <GitHubToolForm accent="#1F2937" heroTitle="GitHub" heroDesc="Test" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('request-type-select')).toBeInTheDocument();
    });

    const nativeInput = screen.getByTestId('request-type-select') as HTMLInputElement;
    fireEvent.change(nativeInput, { target: { value: 'Repository Creation' } });

    await waitFor(() => {
      expect(screen.getByTestId('repo-name-input')).toBeInTheDocument();
    });
    expect(screen.getByTestId('owner-team-select')).toBeInTheDocument();
  });

  it('shows authorization banner when user is not authorized for repository creation', async () => {
    mockBackendFetch.mockResolvedValue({
      json: async () => ({ authorized: false, enabled: true }),
    });

    renderWithTheme(
      <GitHubToolForm accent="#1F2937" heroTitle="GitHub" heroDesc="Test" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('request-type-select')).toBeInTheDocument();
    });

    const nativeInput = screen.getByTestId('request-type-select') as HTMLInputElement;
    fireEvent.change(nativeInput, { target: { value: 'Repository Creation' } });

    await waitFor(() => {
      expect(screen.getByTestId('auth-error-banner')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Create Repository/i })).toBeDisabled();
  });

  it('validates repository name format', async () => {
    mockBackendFetch.mockResolvedValue({
      json: async () => ({ authorized: true, enabled: true }),
      ok: true,
    });

    renderWithTheme(
      <GitHubToolForm accent="#1F2937" heroTitle="GitHub" heroDesc="Test" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('request-type-select')).toBeInTheDocument();
    });

    const nativeInput = screen.getByTestId('request-type-select') as HTMLInputElement;
    fireEvent.change(nativeInput, { target: { value: 'Repository Creation' } });

    const repoNameInput = await screen.findByTestId('repo-name-input');
    fireEvent.change(repoNameInput, { target: { value: 'Invalid_Name' } });

    await waitFor(() => {
      expect(
        screen.getByText(/Repository name may only contain lowercase letters/i),
      ).toBeInTheDocument();
    });
  });

  it('submits repository creation and shows success', async () => {
    mockBackendFetch
      .mockResolvedValueOnce({
        json: async () => ({ authorized: true, enabled: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ slug: 'cloud-engineering', name: 'Cloud Engineering' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: ['Empty', 'node-api-template'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          repositoryName: 'platform-orders-api',
          repositoryUrl: 'https://github.com/SymphonySensa/platform-orders-api',
          ownerTeam: 'cloud-engineering',
        }),
      });

    renderWithTheme(
      <GitHubToolForm accent="#1F2937" heroTitle="GitHub" heroDesc="Test" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('request-type-select')).toBeInTheDocument();
    });

    const nativeInput = screen.getByTestId('request-type-select') as HTMLInputElement;
    fireEvent.change(nativeInput, { target: { value: 'Repository Creation' } });

    const repoNameInput = await screen.findByTestId('repo-name-input');
    fireEvent.change(repoNameInput, { target: { value: 'platform-orders-api' } });

    const ownerTeamInput = screen.getByTestId('owner-team-select') as HTMLInputElement;
    fireEvent.change(ownerTeamInput, { target: { value: 'cloud-engineering' } });

    fireEvent.click(screen.getByRole('button', { name: /Review/i }));

    await waitFor(() => {
      expect(screen.getByText(/Review — Repository Creation/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Repository/i }));

    await waitFor(() => {
      expect(screen.getByText(/Repository created successfully/i)).toBeInTheDocument();
    });

    expect(mockBackendFetch).toHaveBeenLastCalledWith(
      'deployment-control-plane',
      '/github/repositories',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
