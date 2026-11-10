import { useEffect, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useBackendFetch, usePersona } from '@internal/plugin-platform-common';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(6),
    maxWidth: 640,
    margin: '0 auto',
    textAlign: 'center',
  },
  icon: {
    fontSize: 48,
    color: '#9CA3AF',
    marginBottom: theme.spacing(2),
  },
}));

export interface GpuAuthorization {
  authorized: boolean;
  role: 'GPU_ADMIN' | 'GPU_USER' | 'GPU_APPROVER' | 'NONE';
}

/**
 * Enforces GPU_COMPUTE_ACCESS on the frontend before rendering GPU Compute
 * pages. The backend re-checks on every request regardless — this only
 * avoids flashing the form/list to an unauthorized user who hits the URL
 * directly.
 */
export function GpuAccessGate({ children }: { children: React.ReactNode }) {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const { identity } = usePersona();
  const [authz, setAuthz] = useState<GpuAuthorization | null>(null);
  const identityKey =
    identity?.userEntityRef ?? identity?.ownershipEntityRefs.join('|') ?? 'anonymous';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          '/gpu-instances/permissions',
        );
        const body = await response.json();
        if (!cancelled) {
          setAuthz(response.ok ? body : { authorized: false, role: 'NONE' });
        }
      } catch {
        if (!cancelled) setAuthz({ authorized: false, role: 'NONE' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendFetch, identityKey]);

  if (!authz) {
    return (
      <Box className={classes.root}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!authz.authorized) {
    return (
      <Box className={classes.root}>
        <LockOutlinedIcon className={classes.icon} />
        <Typography variant="h6" style={{ fontWeight: 700, marginBottom: 8 }}>
          Access Restricted
        </Typography>
        <Typography variant="body2" color="textSecondary">
          You are not authorized to access GPU Compute. Please contact the
          Cloud Platform team for access.
        </Typography>
      </Box>
    );
  }

  return <>{children}</>;
}
