import { Typography, Paper, Box, Divider } from '@mui/material';
import { makeStyles } from '@mui/styles';
import PersonIcon from '@mui/icons-material/Person';
import { PERSONAS, usePersona } from '@internal/plugin-platform-common';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1100,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  hero: {
    background: 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 100%)',
    borderRadius: 16,
    padding: theme.spacing(4, 5),
    color: '#fff',
    marginBottom: theme.spacing(4),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(3),
  },
  heroIconWrap: {
    background: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: theme.spacing(1.5),
    display: 'flex',
  },
  heroTitle: {
    fontWeight: 700,
    fontSize: '1.75rem',
    lineHeight: 1.2,
  },
  heroSub: {
    opacity: 0.9,
    fontSize: '0.95rem',
    marginTop: theme.spacing(0.5),
  },
  contentCard: {
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    padding: theme.spacing(3),
    marginTop: theme.spacing(2),
  },
  meta: {
    color: '#374151',
    lineHeight: 1.7,
    fontSize: '0.9rem',
  },
}));

export function UserSettingsPage() {
  const classes = useStyles();
  const { identity, persona } = usePersona();
  const userName =
    identity?.displayName ?? identity?.email ?? identity?.userEntityRef;
  const roleLabel =
    PERSONAS.find(item => item.id === persona)?.label ?? 'Unassigned';

  return (
    <div className={classes.root}>
      <Paper elevation={0} className={classes.hero}>
        <div className={classes.heroIconWrap}>
          <PersonIcon style={{ fontSize: 36, color: '#fff' }} />
        </div>
        <div>
          <Typography className={classes.heroTitle}>User Settings</Typography>
          <Typography className={classes.heroSub}>
            Signed in as {userName}
          </Typography>
        </div>
      </Paper>

      <Paper elevation={0} className={classes.contentCard}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Profile
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Box className={classes.meta}>
          Identity: {identity?.userEntityRef}
          <br />
          Email: {identity?.email}
          <br />
          Role: {roleLabel}
        </Box>
      </Paper>
    </div>
  );
}
