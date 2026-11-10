// React import removed — not required in modern JSX runtimes.
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';
import { UserSettingsPage } from './UserSettingsPage';
import { usePersona } from '@internal/plugin-platform-common';

jest.mock('@internal/plugin-platform-common', () => ({
  ...jest.requireActual('@internal/plugin-platform-common'),
  usePersona: jest.fn(),
}));

const muiTheme = (lightTheme as any).getTheme
  ? (lightTheme as any).getTheme('v5')
  : lightTheme;

describe('UserSettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (usePersona as jest.Mock).mockReturnValue({
      persona: 'cloudhub-platform',
      identity: {
        displayName: 'Juber Mohamad',
        email: 'jubermohamad@symphonysensa.com',
        userEntityRef: 'user:symphonysensa/jubermohamad',
      },
    });
  });

  it('renders the verified Microsoft identity', () => {
    render(
      <ThemeProvider theme={muiTheme}>
        <UserSettingsPage />
      </ThemeProvider>,
    );

    expect(screen.getByText('Signed in as Juber Mohamad')).toBeInTheDocument();
    const profile = screen.getByText('Profile').parentElement?.parentElement;
    expect(profile).toHaveTextContent('user:symphonysensa/jubermohamad');
    expect(profile).toHaveTextContent('jubermohamad@symphonysensa.com');
    expect(profile).toHaveTextContent('Role: Platform Admin');
  });

  it('does not render a dummy identity', () => {
    (usePersona as jest.Mock).mockReturnValue({
      persona: 'cloudhub-platform',
      identity: {
        displayName: 'Juber Mohamad',
        email: 'jubermohamad@symphonysensa.com',
        userEntityRef: 'user:symphonysensa/jubermohamad',
      },
    });

    render(
      <ThemeProvider theme={muiTheme}>
        <UserSettingsPage />
      </ThemeProvider>,
    );

    expect(screen.queryByText('Signed in as User')).not.toBeInTheDocument();
    expect(screen.queryByText('cloudhub-platform')).not.toBeInTheDocument();
  });
});
