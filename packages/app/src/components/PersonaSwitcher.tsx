import { useState, useEffect, useRef } from 'react';
import { Typography, Collapse, Divider } from '@mui/material';
import { makeStyles } from '@mui/styles';
import CheckIcon from '@mui/icons-material/Check';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import { PERSONAS, usePersona } from '@internal/plugin-platform-common';

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  root: {
    position: 'relative',
    zIndex: 1301,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: theme.spacing(1),
  },

  // ── Persona panel ──────────────────────────────────────────────────────────
  panel: {
    position: 'absolute',
    right: 0,
    bottom: 'calc(100% + 8px)',
    width: 196,
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: '0 4px 20px rgba(107,33,168,0.18), 0 2px 8px rgba(0,0,0,0.1)',
    background: '#FFFFFF',
    border: '1px solid #EDE9FE',
  },
  panelHeader: {
    padding: theme.spacing(0.5, 1.25),
    background: 'linear-gradient(135deg, #6B21A8 0%, #9333EA 100%)',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  },
  panelHeaderText: {
    fontFamily: theme.typography.fontFamily,
    color: '#fff',
    fontSize: theme.typography.pxToRem(11),
    lineHeight: 1.4,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  panelHeaderIcon: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },

  // ── Persona list items ─────────────────────────────────────────────────────
  listItem: {
    padding: theme.spacing(0.6, 1.25),
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    transition: 'background 0.15s',
    outline: 'none',
    '&:hover': {
      backgroundColor: '#F5F3FF',
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: -2,
    },
  },
  listItemActive: {
    backgroundColor: '#EDE9FE',
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  itemTextWrapper: {
    flex: 1,
    minWidth: 0,
  },
  itemLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.pxToRem(14),
    lineHeight: 1.4,
    color: '#111827',
  },
  checkIcon: {
    fontSize: 14,
    color: theme.palette.primary.main,
    flexShrink: 0,
  },
  identityPanel: {
    padding: theme.spacing(1, 1.25),
    borderBottom: `1px solid #EDE9FE`,
    background: '#FAFAFA',
  },
  identityLabel: {
    display: 'block',
    fontFamily: theme.typography.fontFamily,
    color: '#9CA3AF',
    fontSize: theme.typography.pxToRem(11),
    lineHeight: 1.4,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  identityValue: {
    fontFamily: theme.typography.fontFamily,
    color: '#374151',
    fontSize: theme.typography.pxToRem(13),
    lineHeight: 1.35,
    wordBreak: 'break-word',
  },
  identityGroups: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  identityGroup: {
    fontFamily: theme.typography.fontFamily,
    color: '#6B21A8',
    fontSize: theme.typography.pxToRem(12),
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  identityEmpty: {
    fontFamily: theme.typography.fontFamily,
    color: '#9CA3AF',
    fontSize: theme.typography.pxToRem(12),
    lineHeight: 1.4,
  },

  // ── FAB trigger button ─────────────────────────────────────────────────────
  fab: {
    minWidth: 78,
    height: 32,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#fff',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.pxToRem(12),
    letterSpacing: 0,
    padding: theme.spacing(0, 1),
    textAlign: 'center',
    userSelect: 'none',
    boxShadow: 'none',
    border: '1px solid rgba(255,255,255,0.7)',
    transition: 'transform 0.15s, box-shadow 0.15s',
    '&:hover': {
      filter: 'brightness(1.05)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    },
    '&:active': { filter: 'brightness(0.96)' },
    '&:focus-visible': {
      outline: '3px solid rgba(255,255,255,0.6)',
      outlineOffset: 2,
    },
  },
}));

// ─── Component ────────────────────────────────────────────────────────────────

export function PersonaSwitcher() {
  const classes = useStyles();
  const { persona, setPersona, personaSource, identity } = usePersona();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close panel when clicking outside
  /* eslint-disable consistent-return */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    const cleanup = (): void => {
      document.removeEventListener('mousedown', handler);
    };
    return cleanup;
  }, [open]);
  /* eslint-enable consistent-return */

  if (/^\/login(?:\/|$)/.test(window.location.pathname)) {
    return null;
  }

  const current = PERSONAS.find(p => p.id === persona) ?? PERSONAS[0];

  const handleSelect = (id: typeof persona): void => {
    if (personaSource === 'identity') {
      return;
    }
    setPersona(id);
    setOpen(false);
  };

  return (
    <div className={classes.root} ref={rootRef}>
      {/* ── Collapsible panel ── */}
      <Collapse in={open} unmountOnExit>
        <div className={classes.panel}>
          {/* Header */}
          <div className={classes.panelHeader}>
            <PeopleAltIcon className={classes.panelHeaderIcon} />
            <Typography className={classes.panelHeaderText}>
              Active Persona
            </Typography>
          </div>

          {/* Identity debug panel */}
          <div className={classes.identityPanel}>
            <Typography className={classes.identityLabel}>Identity</Typography>
            <Typography className={classes.identityValue}>
              {personaSource === 'identity'
                ? 'Resolved from Entra group membership'
                : 'Using local persona override'}
            </Typography>
            <div style={{ marginTop: 8 }}>
              <Typography className={classes.identityLabel}>
                User Ref
              </Typography>
              <Typography className={classes.identityValue}>
                {identity?.userEntityRef ?? 'unavailable'}
              </Typography>
            </div>
            <div style={{ marginTop: 8 }}>
              <Typography className={classes.identityLabel}>Groups</Typography>
              <div className={classes.identityGroups}>
                {identity?.ownershipEntityRefs?.length ? (
                  identity.ownershipEntityRefs.map(ref => (
                    <span key={ref} className={classes.identityGroup}>
                      {ref}
                    </span>
                  ))
                ) : (
                  <span className={classes.identityEmpty}>none</span>
                )}
              </div>
            </div>
          </div>

          {/* Persona list */}
          {personaSource === 'identity' && (
            <div style={{ padding: '8px 12px' }}>
              <Typography
                variant="caption"
                style={{ color: '#fff', opacity: 0.8 }}
              >
                Persona is assigned from Entra group membership.
              </Typography>
            </div>
          )}
          {PERSONAS.map((p, i) => (
            <div key={p.id}>
              {i > 0 && <Divider />}
              <div
                className={`${classes.listItem} ${
                  persona === p.id ? classes.listItemActive : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={() => handleSelect(p.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(p.id);
                  }
                }}
                aria-disabled={personaSource === 'identity'}
                style={{
                  opacity: personaSource === 'identity' ? 0.65 : 1,
                  pointerEvents: personaSource === 'identity' ? 'none' : 'auto',
                }}
              >
                <span
                  className={classes.colorDot}
                  style={{ background: p.color }}
                />
                <div className={classes.itemTextWrapper}>
                  <Typography className={classes.itemLabel}>
                    {p.label}
                  </Typography>
                </div>
                {persona === p.id && (
                  <CheckIcon className={classes.checkIcon} />
                )}
              </div>
            </div>
          ))}
        </div>
      </Collapse>

      {/* ── FAB trigger ── */}
      <button
        className={classes.fab}
        style={{ background: current.color }}
        onClick={() => setOpen(o => !o)}
        aria-label={`Switch persona — current: ${current.label}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={`Active persona: ${current.label}`}
        type="button"
      >
        <span>{current.abbr}</span>
      </button>
    </div>
  );
}
