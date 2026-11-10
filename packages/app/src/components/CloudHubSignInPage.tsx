import { useCallback, useEffect, useState } from 'react';
import { useApiHolder, microsoftAuthApiRef } from '@backstage/core-plugin-api';
import type { IdentityApi } from '@backstage/core-plugin-api';
import { UserIdentity } from '@backstage/core-components';
import { Typography, CircularProgress } from '@mui/material';
import { makeStyles } from '@mui/styles';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

const LOGIN_ROUTE = '/login';
const REDIRECT_KEY = 'cloudhub:post-login-redirect';
const AUTH_FLOW_PENDING_KEY = 'cloudhub:manual-sign-in-pending';

function getPostLoginRedirectUrl() {
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const savedPath = sessionStorage.getItem(REDIRECT_KEY) || currentPath || '/';
  try {
    const target = new URL(savedPath, window.location.origin);
    if (
      target.origin !== window.location.origin ||
      target.pathname === LOGIN_ROUTE
    ) {
      return new URL('/', window.location.origin).toString();
    }
    return target.toString();
  } catch {
    return new URL('/', window.location.origin).toString();
  }
}

export function buildMicrosoftAuthStartUrl() {
  const startUrl = new URL('/api/auth/microsoft/start', window.location.origin);
  startUrl.searchParams.set(
    'scope',
    'openid offline_access profile email User.Read',
  );
  startUrl.searchParams.set('origin', window.location.origin);
  startUrl.searchParams.set('redirectUrl', getPostLoginRedirectUrl());
  startUrl.searchParams.set('flow', 'redirect');
  startUrl.searchParams.set(
    'env',
    window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
      ? 'development'
      : 'production',
  );
  return startUrl.toString();
}

const LOGIN_TOKENS = {
  color: {
    pageBg: '#f3f6fb',
    cardBg: '#ffffff',
    accent: '#3f50ff',
    heading: '#101828',
    body: '#5b6b85',
    divider: '#e5eaf3',
    buttonText: '#12284d',
    buttonBorder: '#c5d4f0',
    buttonHoverBg: '#f5f8ff',
    buttonHoverBorder: '#9eb8e6',
    buttonIconText: '#2a4f90',
    footerText: '#7a879e',
  },
  size: {
    cardMaxWidth: 400,
    cardRadius: 16,
    buttonMinHeight: 48,
    buttonRadius: 8,
  },
} as const;

const useStyles = makeStyles(theme => ({
  root: {
    minHeight: '100dvh',
    background: LOGIN_TOKENS.color.pageBg,
    display: 'grid',
    placeItems: 'center',
    padding: theme.spacing(2),
    boxSizing: 'border-box',
  },
  card: {
    width: '100%',
    maxWidth: LOGIN_TOKENS.size.cardMaxWidth,
    background: LOGIN_TOKENS.color.cardBg,
    borderRadius: LOGIN_TOKENS.size.cardRadius,
    boxShadow: '0 16px 40px rgba(6, 24, 68, 0.12)',
    padding: theme.spacing(4.5, 4),
    boxSizing: 'border-box',
    [theme.breakpoints.down('xs')]: {
      padding: theme.spacing(3.5, 2.75),
    },
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: LOGIN_TOKENS.color.accent,
    '& svg': {
      fontSize: 26,
    },
  },
  brandName: {
    fontFamily: 'Poppins, Segoe UI, sans-serif',
    letterSpacing: '0.06em',
    fontWeight: 700,
    fontSize: '1.3rem',
    lineHeight: 1,
  },
  tagline: {
    marginTop: theme.spacing(1.25),
    color: LOGIN_TOKENS.color.accent,
    fontWeight: 600,
    fontSize: '1rem',
  },
  description: {
    marginTop: theme.spacing(1),
    color: LOGIN_TOKENS.color.body,
    fontSize: '0.9rem',
    lineHeight: 1.5,
  },
  divider: {
    border: 'none',
    borderTop: `1px solid ${LOGIN_TOKENS.color.divider}`,
    margin: theme.spacing(3, 0),
  },
  welcome: {
    color: LOGIN_TOKENS.color.heading,
    fontWeight: 700,
    fontSize: '1.4rem',
    lineHeight: 1.3,
  },
  intro: {
    marginTop: theme.spacing(0.5),
    color: LOGIN_TOKENS.color.body,
    fontSize: '0.9rem',
    lineHeight: 1.45,
  },
  signInCard: {
    marginTop: theme.spacing(2.5),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },
  msButton: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    minHeight: LOGIN_TOKENS.size.buttonMinHeight,
    borderRadius: LOGIN_TOKENS.size.buttonRadius,
    border: `1px solid ${LOGIN_TOKENS.color.buttonBorder}`,
    background: LOGIN_TOKENS.color.cardBg,
    color: LOGIN_TOKENS.color.buttonText,
    fontFamily: theme.typography.fontFamily,
    fontWeight: 600,
    fontSize: '0.95rem',
    textTransform: 'none',
    cursor: 'pointer',
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
    boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06)',
    transition: 'background-color 120ms ease, border-color 120ms ease',
    '&:hover:not(:disabled)': {
      background: LOGIN_TOKENS.color.buttonHoverBg,
      borderColor: LOGIN_TOKENS.color.buttonHoverBorder,
    },
    '&:focus-visible': {
      outline: `2px solid ${LOGIN_TOKENS.color.buttonIconText}`,
      outlineOffset: 2,
    },
    '&:disabled': {
      cursor: 'not-allowed',
      opacity: 0.75,
    },
  },
  msLogo: {
    display: 'inline-flex',
    flexShrink: 0,
    marginRight: theme.spacing(1.25),
  },
  msButtonSpinner: {
    marginLeft: 'auto',
    color: LOGIN_TOKENS.color.buttonIconText,
  },
  errorBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1.25, 1.5),
    borderRadius: 8,
    background: '#fdecea',
    border: '1px solid #f5c2c0',
    color: '#7a2e2a',
    '& svg': {
      marginTop: 2,
      flexShrink: 0,
    },
  },
  footer: {
    marginTop: theme.spacing(3),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: LOGIN_TOKENS.color.footerText,
    '& svg': {
      fontSize: 16,
    },
  },
  footerText: {
    fontSize: '0.8rem',
    lineHeight: 1.4,
    '& strong': {
      display: 'block',
      color: LOGIN_TOKENS.color.body,
      fontWeight: 600,
      fontSize: '0.85rem',
    },
  },
}));

type CloudHubSignInPageProps = {
  onSignInSuccess: (identityApi: IdentityApi) => void;
};

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function CloudHubSignInPage(props: CloudHubSignInPageProps) {
  const classes = useStyles();
  const { onSignInSuccess } = props;
  // Non-throwing lookup: an unwired provider must render an error state,
  // not crash the whole app before any UI can show.
  const authApi = useApiHolder().get(microsoftAuthApiRef);
  const [signingIn, setSigningIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(
    () => sessionStorage.getItem(AUTH_FLOW_PENDING_KEY) === 'true',
  );
  const [error, setError] = useState<Error | null>(
    authApi
      ? null
      : new Error(
          'Sign-in is temporarily unavailable. Please contact support.',
        ),
  );

  const completeSignIn = useCallback(
    (identityApi: IdentityApi) => {
      sessionStorage.removeItem(AUTH_FLOW_PENDING_KEY);
      onSignInSuccess(identityApi);
      const target = new URL(getPostLoginRedirectUrl());
      sessionStorage.removeItem(REDIRECT_KEY);
      const next = `${target.pathname}${target.search}${target.hash}`;
      if (window.location.pathname !== next) {
        window.history.replaceState({}, '', next);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    },
    [onSignInSuccess],
  );

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const authError = currentUrl.searchParams.get('error');
    currentUrl.searchParams.delete('error');

    if (window.location.pathname !== LOGIN_ROUTE && !authError) {
      sessionStorage.setItem(
        REDIRECT_KEY,
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}` || '/',
      );
    }

    if (authError) {
      sessionStorage.removeItem(AUTH_FLOW_PENDING_KEY);
      setError(new Error(authError.slice(0, 500)));
      window.history.replaceState(
        {},
        '',
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      );
    }
  }, []);

  // Restore identity only when returning from an OAuth flow the user explicitly
  // started. A pre-existing CloudHub session must not bypass the manual sign-in.
  useEffect(() => {
    let cancelled = false;
    const signInPending =
      sessionStorage.getItem(AUTH_FLOW_PENDING_KEY) === 'true';
    if (!signInPending || !authApi) {
      setCheckingSession(false);
    } else {
      authApi
        .getBackstageIdentity({ optional: true })
        .then(async identityResponse => {
          if (cancelled) return;
          const identity = identityResponse?.identity;
          if (!identity) {
            sessionStorage.removeItem(AUTH_FLOW_PENDING_KEY);
            setCheckingSession(false);
            return;
          }

          const profile = await authApi.getProfile().catch(() => undefined);
          if (cancelled) return;

          completeSignIn(
            UserIdentity.create({
              identity,
              authApi,
              profile,
            }),
          );
        })
        .catch(() => {
          // The attempted sign-in did not establish a session; require another
          // explicit click rather than silently retrying on later visits.
          sessionStorage.removeItem(AUTH_FLOW_PENDING_KEY);
          if (!cancelled) setCheckingSession(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [authApi, completeSignIn]);

  const handleSignIn = async () => {
    if (!authApi) {
      setError(
        new Error(
          'Sign-in is temporarily unavailable. Please contact support.',
        ),
      );
      return;
    }

    setError(null);
    setSigningIn(true);
    sessionStorage.setItem(AUTH_FLOW_PENDING_KEY, 'true');
    window.location.assign(buildMicrosoftAuthStartUrl());
  };

  return (
    <div className={classes.root}>
      <div className={classes.card}>
        <div className={classes.brandRow}>
          <CloudQueueIcon />
          <Typography component="div" className={classes.brandName}>
            CLOUDHUB
          </Typography>
        </div>
        <Typography className={classes.tagline}>
          Unified Cloud Platform
        </Typography>
        <Typography className={classes.description}>
          Application delivery, customer enablement, and platform administration
          in one workspace.
        </Typography>

        <hr className={classes.divider} />

        <Typography className={classes.welcome}>Welcome to CloudHub</Typography>
        <Typography className={classes.intro}>
          Sign in with your @symphonysensa.com Microsoft Entra ID account
        </Typography>

        <div className={classes.signInCard}>
          <button
            type="button"
            className={classes.msButton}
            onClick={handleSignIn}
            disabled={signingIn || checkingSession}
          >
            <span className={classes.msLogo}>
              <MicrosoftLogo />
            </span>
            <span>
              {signingIn
                ? 'Signing in…'
                : checkingSession
                ? 'Checking your session…'
                : 'Sign in with Microsoft Entra ID'}
            </span>
            {(signingIn || checkingSession) && (
              <CircularProgress size={18} className={classes.msButtonSpinner} />
            )}
          </button>

          {error && (
            <div className={classes.errorBox} role="alert">
              <ErrorOutlineIcon fontSize="small" />
              <Typography variant="body2">{error.message}</Typography>
            </div>
          )}
        </div>

        <div className={classes.footer}>
          <LockOutlinedIcon />
          <Typography className={classes.footerText}>
            <strong>Secure Single Sign-On</strong>
            <br />
            Powered by Microsoft Entra ID
          </Typography>
        </div>
      </div>
    </div>
  );
}
