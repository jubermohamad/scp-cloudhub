import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { SriDeployPage } from './SriDeployPage';

const wizardProps = jest.fn();

jest.mock('./DeploymentWizard', () => ({
  DeploymentWizard: (props: { open: boolean; preselectedApp?: string }) => {
    wizardProps(props);
    return null;
  },
}));

jest.mock('./DeploymentHistory', () => ({
  DeploymentHistory: () => null,
}));

jest.mock('@internal/plugin-platform-common', () => ({
  getSriComponent: () => undefined,
  useBackendFetch: () => jest.fn(),
}));

function renderPage() {
  render(
    <ThemeProvider theme={createTheme()}>
      <SriDeployPage />
    </ThemeProvider>,
  );
}

function lastWizardProps() {
  return wizardProps.mock.calls[wizardProps.mock.calls.length - 1][0];
}

describe('SriDeployPage', () => {
  beforeEach(() => wizardProps.mockClear());

  it('opens the wizard without a preselected app from the discovered-app card', () => {
    renderPage();

    fireEvent.click(screen.getByText('Other application'));

    expect(lastWizardProps()).toMatchObject({ open: true });
    expect(lastWizardProps().preselectedApp).toBeUndefined();
  });

  it('keeps preselecting the app for a named card', () => {
    renderPage();

    fireEvent.click(screen.getByText('AIStore'));

    expect(lastWizardProps()).toMatchObject({
      open: true,
      preselectedApp: 'ai-store',
    });
  });
});
