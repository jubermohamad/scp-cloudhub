import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';

const muiTheme = (lightTheme as any).getTheme ? (lightTheme as any).getTheme('v5') : lightTheme;

const renderWithTheme = (ui: React.ReactElement) => render(<ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>);
import { InfrastructurePage } from './InfrastructurePage';
import { MemoryRouter } from 'react-router-dom';

jest.mock('./AzureFoundationResourceCard', () => () => (
  <div>AzureFoundationResourceCard</div>
));
jest.mock('./GpuInfrastructureCard', () => () => <div>GpuInfrastructureCard</div>);

describe('InfrastructurePage', () => {
  it('renders the infrastructure workspace with Azure resource cards', () => {
    renderWithTheme(
      <MemoryRouter>
        <InfrastructurePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Infrastructure')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Azure' })).toBeInTheDocument();
    expect(screen.getAllByText('Create Test VM').length).toBeGreaterThan(0);
    expect(screen.getAllByText('GPU Compute').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VNet / Subnet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Secrets Vault').length).toBeGreaterThan(0);
  });
});
