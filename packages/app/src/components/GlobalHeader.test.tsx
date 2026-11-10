import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';

// Mock @internal/plugin-platform-common before importing GlobalHeader so
// `PERSONAS` is present at module-load time.
jest.mock('@internal/plugin-platform-common', () => ({
  usePersona: jest.fn(),
  getFirstName: (
    identity:
      | { displayName?: string; userEntityRef?: string }
      | null
      | undefined,
  ) => {
    const displayName = identity?.displayName?.trim();
    if (displayName) return displayName.split(/\s+/)[0];
    const ref = identity?.userEntityRef?.trim();
    if (!ref) return 'User';
    return (
      ref
        .replace(/^user:(?:default\/)?/, '')
        .trim()
        .split(/[._\s-]+/)[0] || 'User'
    );
  },
  PERSONAS: [
    { id: 'cloudhub-platform', label: 'Platform Admin', color: '#2563EB' },
    { id: 'developer', label: 'Developer', color: '#10B981' },
  ],
}));

jest.mock('@internal/plugin-platform-home', () => ({
  UserSettingsPage: () => null,
}));

import { GlobalHeader } from './GlobalHeader';
import { microsoftAuthApiRef, useApiHolder } from '@backstage/core-plugin-api';
import { usePersona } from '@internal/plugin-platform-common';

jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApiHolder: jest.fn(),
}));

jest.mock('./PersonaSwitcher', () => ({
  PersonaSwitcher: () => <div data-testid="persona-switcher" />,
}));

// (module mock placed above)

const muiTheme = (lightTheme as any).getTheme
  ? (lightTheme as any).getTheme('v5')
  : lightTheme;

const renderWithTheme = (ui: ReactElement) =>
  render(<ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>);

describe('GlobalHeader', () => {
  const authApi = {
    getProfile: jest.fn(),
    signOut: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    authApi.getProfile.mockResolvedValue({
      displayName: 'Jane Doe',
      email: 'jane.doe@example.com',
    });

    (useApiHolder as jest.Mock).mockReturnValue({
      get: (ref: unknown) =>
        ref === microsoftAuthApiRef ? authApi : undefined,
    });

    (usePersona as jest.Mock).mockReturnValue({
      persona: 'cloudhub-platform',
      personaSource: 'identity',
      setPersona: jest.fn(),
      identity: {
        userEntityRef: 'user:default/jane.doe',
        ownershipEntityRefs: ['group:default/cloudhubplatformowners'],
        displayName: 'Jane Doe',
        email: 'jane.doe@example.com',
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '0.9.0-beta.32',
    }) as jest.Mock;
  });

  it('shows the first name in the user control and keeps the version under the profile menu', async () => {
    renderWithTheme(<GlobalHeader />);

    expect(
      screen.getByRole('button', { name: /user menu/i }),
    ).toHaveTextContent('Jane');

    fireEvent.click(screen.getByRole('button', { name: /user menu/i }));

    await waitFor(() => {
      expect(screen.getByText('Role: Platform Admin')).toBeInTheDocument();
      expect(screen.getByText('CloudHub: 0.9.0-beta.32')).toBeInTheDocument();
    });
  });

  it('opens a settings dialog from the profile menu with a close action', async () => {
    renderWithTheme(<GlobalHeader />);

    fireEvent.click(screen.getByRole('button', { name: /user menu/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: /profile and settings/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('menuitem', { name: /profile and settings/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /close/i }),
      ).toBeInTheDocument();
    });
  });
});
