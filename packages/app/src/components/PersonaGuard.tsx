import { type ReactNode } from 'react';
import { Typography, Button } from '@mui/material';
import { makeStyles } from '@mui/styles';
import LockIcon from '@mui/icons-material/Lock';
import {
  PERSONAS,
  PERSONA_PERMISSIONS,
  type PersonaId,
  usePersona,
} from '@internal/plugin-platform-common';

// Re-export for backward compatibility with any existing consumers
export { PERSONA_PERMISSIONS };

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  denied: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 360,
    padding: theme.spacing(4),
    textAlign: 'center',
    gap: theme.spacing(2),
  },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background:
      theme.palette.mode === 'dark'
        ? 'rgba(244,67,54,0.12)'
        : 'rgba(244,67,54,0.08)',
    marginBottom: theme.spacing(1),
  },
  lockIcon: {
    fontSize: 32,
    color: theme.palette.error.main,
  },
  title: {
    color: theme.palette.error.main,
  },
  message: {
    color: theme.palette.text.secondary,
    maxWidth: 380,
  },
  personaBadge: {
    display: 'inline-block',
    padding: theme.spacing(0.25, 1),
    borderRadius: 12,
    fontSize: '0.78rem',
    color: '#fff',
  },
  allowedList: {
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: theme.spacing(0.5),
  },
  hint: {
    fontSize: '0.78rem',
    color: theme.palette.text.disabled,
  },
}));

// ─── AccessDeniedView ─────────────────────────────────────────────────────────

function AccessDeniedView({
  resource,
  allowed,
}: {
  resource: string;
  allowed: PersonaId[];
}) {
  const classes = useStyles();
  const { persona } = usePersona();
  const current = PERSONAS.find(p => p.id === persona) ?? PERSONAS[0];
  const allowedDefs = PERSONAS.filter(p => allowed.includes(p.id));

  return (
    <div className={classes.denied} role="alert" aria-live="polite">
      <div className={classes.iconRing}>
        <LockIcon className={classes.lockIcon} />
      </div>

      <Typography variant="h5" className={classes.title}>
        Access Restricted
      </Typography>

      <Typography variant="body2" className={classes.message}>
        Your current persona{' '}
        <span
          className={classes.personaBadge}
          style={{ background: current.color }}
        >
          {current.label}
        </span>{' '}
        does not have permission to view&nbsp;
        <strong>{resource}</strong>.
      </Typography>

      <div>
        <Typography variant="caption" className={classes.hint}>
          This resource is accessible to:
        </Typography>
        <div className={classes.allowedList}>
          {allowedDefs.map(p => (
            <span
              key={p.id}
              className={classes.personaBadge}
              style={{ background: p.color }}
            >
              {p.label}
            </span>
          ))}
        </div>
      </div>

      <Button
        size="small"
        variant="outlined"
        onClick={() => {
          /** User switches persona via the FAB in the bottom-right corner */
        }}
      >
        Switch persona to gain access
      </Button>
    </div>
  );
}

// ─── PersonaGuard ─────────────────────────────────────────────────────────────

/**
 * Renders children only when the active persona is in the `allowed` list.
 * Otherwise renders an in-page Access Restricted view (no redirect, no crash).
 *
 * @example
 *   <PersonaGuard allowed={['cloudhub-platform', 'sre']} resource="Cluster Health">
 *     <SREClustersPage />
 *   </PersonaGuard>
 */
export function PersonaGuard({
  allowed,
  resource = 'this resource',
  children,
}: {
  allowed: PersonaId[];
  resource?: string;
  children: ReactNode;
}) {
  const { persona } = usePersona();

  if (!allowed.includes(persona)) {
    return <AccessDeniedView resource={resource} allowed={allowed} />;
  }

  return <>{children}</>;
}
