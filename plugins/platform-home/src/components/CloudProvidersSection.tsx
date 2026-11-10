import { Typography, Grid, Card, CardActionArea, Divider } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useNavigate } from 'react-router-dom';
import BuildIcon from '@mui/icons-material/Build';
import SecurityIcon from '@mui/icons-material/Security';
import { usePersona } from '@internal/plugin-platform-common';

// ─── Provider definitions ────────────────────────────────────────────────────

interface CloudProvider {
  id: string;
  name: string;
  tagline: string;
  category: 'public' | 'external';
  gradient: string;
  glyph: string;
  enabled: boolean;
  externalUrl?: string;
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: 'azure',
    name: 'Azure',
    tagline: 'Microsoft Azure',
    category: 'public',
    gradient: 'linear-gradient(135deg, #111827 0%, #374151 100%)',
    glyph: 'az',
    enabled: true,
  },
  {
    id: 'aws',
    name: 'AWS',
    tagline: 'Amazon Web Services',
    category: 'public',
    gradient: 'linear-gradient(135deg, #111827 0%, #374151 100%)',
    glyph: 'aws',
    enabled: false,
  },
  {
    id: 'gcp',
    name: 'GCP',
    tagline: 'Google Cloud Platform',
    category: 'public',
    gradient: 'linear-gradient(135deg, #111827 0%, #374151 100%)',
    glyph: 'gcp',
    enabled: false,
  },
  {
    id: 'sri-provisioner',
    name: 'SRI Provisioner',
    tagline: 'Provision SRI environments and services',
    category: 'external',
    gradient: 'linear-gradient(135deg, #111827 0%, #374151 100%)',
    glyph: 'sri',
    enabled: true,
    externalUrl: 'https://sri-provisioner.invhub.fseng.net/',
  },
];

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  card: {
    height: 200,
    borderRadius: 18,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
    transition: 'box-shadow 0.2s, transform 0.15s',
    '&:hover': {
      boxShadow: '0 16px 28px rgba(15, 23, 42, 0.18)',
      transform: 'translateY(-2px)',
    },
    [theme.breakpoints.down('sm')]: { height: 180 },
    [theme.breakpoints.up('xl')]: { height: 220 },
  },
  cardDisabled: {
    height: 200,
    borderRadius: 18,
    [theme.breakpoints.down('sm')]: { height: 180 },
    [theme.breakpoints.up('xl')]: { height: 220 },
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    cursor: 'not-allowed',
    position: 'relative',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
  },
  comingSoonBadge: {
    background: '#f3f4f6',
    color: '#0f172a',
    fontSize: '0.62rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    padding: '6px 10px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
    lineHeight: 1.2,
    [theme.breakpoints.down('sm')]: {
      fontSize: '0.58rem',
      padding: '5px 8px',
    },
  },
  cardArea: {
    height: '100%',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    textAlign: 'left',
    justifyContent: 'space-between',
    padding: theme.spacing(2.1),
    position: 'relative',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(1.5) },
  },
  cardHeader: {
    display: 'flex',
    width: '100%',
    boxSizing: 'border-box',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: theme.spacing(1),
  },
  headerBadges: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: theme.spacing(0.75),
    minWidth: 118,
    marginLeft: 'auto',
    flexShrink: 0,
  },
  glyph: {
    width: 52,
    height: 52,
    borderRadius: 10,
    background: 'rgba(255,255,255,0.16)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.95rem',
    letterSpacing: 1,
    [theme.breakpoints.down('sm')]: {
      width: 42,
      height: 42,
      fontSize: '0.8rem',
      borderRadius: 8,
    },
  },
  categoryPill: {
    fontSize: '0.58rem',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    background: 'rgba(255,255,255,0.9)',
    color: '#0f172a',
    padding: '6px 10px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
    fontWeight: 700,
    lineHeight: 1.2,
    [theme.breakpoints.down('sm')]: {
      fontSize: '0.52rem',
      padding: '5px 8px',
      letterSpacing: 0.7,
    },
  },
  providerName: {
    textAlign: 'left',
    fontSize: '1.7rem',
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: '-0.04em',
    margin: 0,
    [theme.breakpoints.down('sm')]: { fontSize: '1.4rem' },
    [theme.breakpoints.between('lg', 'xl')]: { fontSize: '1.55rem' },
    [theme.breakpoints.up('xl')]: { fontSize: '1.8rem' },
  },
  providerTagline: {
    textAlign: 'left',
    fontSize: '0.82rem',
    opacity: 0.9,
    lineHeight: 1.4,
    marginTop: 6,
    [theme.breakpoints.down('sm')]: { fontSize: '0.7rem' },
  },
}));

// ─── Component ───────────────────────────────────────────────────────────────

export function CloudProvidersSection({
  includeSri = false,
}: {
  includeSri?: boolean;
}) {
  const classes = useStyles();
  const navigate = useNavigate();
  const { persona } = usePersona();
  const isPlatformSuperUser = persona === 'cloudhub-platform';

  return (
    <>
      <Grid container spacing={2}>
        {CLOUD_PROVIDERS.map(provider => {
          const inner = (
            <>
              <div className={classes.cardHeader}>
                <div className={classes.glyph}>
                  {provider.id === 'sri-provisioner' ? (
                    <BuildIcon fontSize="small" />
                  ) : (
                    provider.glyph.toUpperCase()
                  )}
                </div>
                <div className={classes.headerBadges}>
                  {!provider.enabled && (
                    <span className={classes.comingSoonBadge}>Coming soon</span>
                  )}
                  <span className={classes.categoryPill}>
                    {provider.category === 'public'
                      ? 'Public Cloud'
                      : 'External Platform'}
                  </span>
                </div>
              </div>
              <div>
                <Typography className={classes.providerName}>
                  {provider.name}
                </Typography>
                <Typography className={classes.providerTagline}>
                  {provider.tagline}
                </Typography>
              </div>
            </>
          );

          return (
            <Grid item xs={6} sm={6} md={3} key={provider.id}>
              {provider.enabled ? (
                <Card className={classes.card} elevation={0}>
                  <CardActionArea
                    className={classes.cardArea}
                    style={{ background: provider.gradient }}
                    onClick={() => {
                      if (provider.externalUrl) {
                        window.open(
                          provider.externalUrl,
                          '_blank',
                          'noopener,noreferrer',
                        );
                        return;
                      }
                      navigate(`/cloud/${provider.id}`);
                    }}
                  >
                    {inner}
                  </CardActionArea>
                </Card>
              ) : (
                <Card
                  className={classes.cardDisabled}
                  elevation={0}
                  style={{ background: provider.gradient }}
                >
                  <div className={classes.cardArea}>{inner}</div>
                </Card>
              )}
            </Grid>
          );
        })}
      </Grid>

      {isPlatformSuperUser && includeSri && (
        <Divider style={{ margin: '28px 0 24px' }} />
      )}

      {/* SRI Suite — Platform Super User only */}
      {isPlatformSuperUser && includeSri && (
        <>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <Card className={classes.card} elevation={0}>
                <CardActionArea
                  className={classes.cardArea}
                  style={{
                    background:
                      'linear-gradient(135deg, #1a237e 0%, #283593 50%, #1565c0 100%)',
                  }}
                  onClick={() => navigate('/sri')}
                >
                  <div className={classes.cardHeader}>
                    <div className={classes.glyph}>
                      <SecurityIcon fontSize="small" />
                    </div>
                    <span className={classes.categoryPill}>Product Suite</span>
                  </div>
                  <div>
                    <Typography className={classes.providerName}>
                      SRI
                    </Typography>
                    <Typography className={classes.providerTagline}>
                      Sensa Risk Intelligence
                    </Typography>
                  </div>
                </CardActionArea>
              </Card>
            </Grid>
          </Grid>
        </>
      )}
    </>
  );
}
