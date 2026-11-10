import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';
import { microsoftAuthApiRef, useApiHolder } from '@backstage/core-plugin-api';

jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApiHolder: jest.fn(),
}));

import {
  buildMicrosoftAuthStartUrl,
  CloudHubSignInPage,
} from './CloudHubSignInPage';

const muiTheme = (lightTheme as any).getTheme
  ? (lightTheme as any).getTheme('v5')
  : lightTheme;

describe('CloudHubSignInPage', () => {
  const authApi = {
    getBackstageIdentity: jest.fn(),
    getProfile: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/login');
    authApi.getBackstageIdentity.mockResolvedValue({
      identity: {
        userEntityRef: 'user:default/jubermohamad',
        ownershipEntityRefs: [],
        token: 'backstage-token',
      },
    });
    authApi.getProfile.mockResolvedValue({
      displayName: 'Juber Mohamad',
      email: 'jubermohamad@symphonysensa.com',
    });
    (useApiHolder as jest.Mock).mockReturnValue({
      get: (ref: unknown) =>
        ref === microsoftAuthApiRef ? authApi : undefined,
    });
  });

  it('builds same-origin Entra redirect login with the home page as its return target', () => {
    const startUrl = new URL(buildMicrosoftAuthStartUrl());

    expect(startUrl.origin).toBe(window.location.origin);
    expect(startUrl.pathname).toBe('/api/auth/microsoft/start');
    expect(startUrl.searchParams.get('flow')).toBe('redirect');
    expect(startUrl.searchParams.get('env')).toBe('development');
    expect(startUrl.searchParams.get('origin')).toBe(window.location.origin);
    expect(startUrl.searchParams.get('redirectUrl')).toBe(
      `${window.location.origin}/`,
    );
  });

  it('returns OAuth to the original deep link instead of the login route', () => {
    sessionStorage.setItem(
      'cloudhub:post-login-redirect',
      '/deployment?stage=2',
    );

    const startUrl = new URL(buildMicrosoftAuthStartUrl());
    expect(startUrl.searchParams.get('redirectUrl')).toBe(
      `${window.location.origin}/deployment?stage=2`,
    );

    sessionStorage.setItem('cloudhub:post-login-redirect', '/login');
    expect(
      new URL(buildMicrosoftAuthStartUrl()).searchParams.get('redirectUrl'),
    ).toBe(`${window.location.origin}/`);
  });

  it('restores identity after the user-initiated OAuth flow returns', async () => {
    sessionStorage.setItem('cloudhub:manual-sign-in-pending', 'true');
    const onSignInSuccess = jest.fn();
    render(
      <ThemeProvider theme={muiTheme}>
        <CloudHubSignInPage onSignInSuccess={onSignInSuccess} />
      </ThemeProvider>,
    );

    await waitFor(() => expect(onSignInSuccess).toHaveBeenCalledTimes(1));
    expect(authApi.getBackstageIdentity).toHaveBeenCalledWith({
      optional: true,
    });
    expect(authApi.getProfile).toHaveBeenCalled();
  });

  it('does not automatically sign in from an existing CloudHub session', async () => {
    const onSignInSuccess = jest.fn();
    render(
      <ThemeProvider theme={muiTheme}>
        <CloudHubSignInPage onSignInSuccess={onSignInSuccess} />
      </ThemeProvider>,
    );

    expect(
      await screen.findByRole('button', {
        name: /sign in with microsoft entra id/i,
      }),
    ).toBeInTheDocument();
    expect(onSignInSuccess).not.toHaveBeenCalled();
    expect(authApi.getBackstageIdentity).not.toHaveBeenCalled();
  });

  it('keeps the requested route without checking for a session before manual sign-in', async () => {
    window.history.replaceState({}, '', '/deployment?stage=2');
    authApi.getBackstageIdentity.mockResolvedValue(undefined);

    render(
      <ThemeProvider theme={muiTheme}>
        <CloudHubSignInPage onSignInSuccess={jest.fn()} />
      </ThemeProvider>,
    );

    await screen.findByRole('button', {
      name: /sign in with microsoft entra id/i,
    });
    expect(authApi.getBackstageIdentity).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/deployment');
    expect(window.location.search).toBe('?stage=2');
  });

  it('shows the membership request returned by the Entra sign-in resolver', async () => {
    window.history.replaceState(
      {},
      '',
      '/login?error=Access%20denied.%20Request%20membership%20in%20cloudhub-login-allow.',
    );
    authApi.getBackstageIdentity.mockResolvedValue(undefined);

    render(
      <ThemeProvider theme={muiTheme}>
        <CloudHubSignInPage onSignInSuccess={jest.fn()} />
      </ThemeProvider>,
    );

    expect(
      await screen.findByText(/request membership in cloudhub-login-allow/i),
    ).toBeInTheDocument();
    expect(authApi.getBackstageIdentity).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });
});
