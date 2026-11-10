import { useEffect, useState } from 'react';
import {
  Card,
  CardActionArea,
  CircularProgress,
  Typography,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import { useNavigate } from 'react-router-dom';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import { useBackendFetch } from '@internal/plugin-platform-common';

const useStyles = makeStyles(theme => ({
  card: {
    borderRadius: 12,
    border: '2px solid #fbbf24',
    background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
    position: 'relative',
    overflow: 'hidden',
  },
  cardContent: {
    padding: theme.spacing(2.5),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 12,
    background: '#fbbf24',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: {
    fontSize: 32,
    color: '#92400e',
  },
  content: {
    flex: 1,
  },
  number: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#92400e',
  },
  label: {
    fontSize: '0.9rem',
    color: '#b45309',
    marginTop: theme.spacing(0.5),
  },
  badge: {
    position: 'absolute',
    top: 12,
    right: 12,
    background: '#ef4444',
    color: '#fff',
    borderRadius: '50%',
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.75rem',
    fontWeight: 700,
  },
  loading: {
    opacity: 0.6,
  },
}));

interface PendingStats {
  pending: number;
}

export function PendingApprovalsWidget() {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  const [stats, setStats] = useState<PendingStats>({ pending: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await backendFetch(
          'deployment-control-plane',
          '/deployments/approvals?status=PENDING',
        );
        if (res.ok) {
          const data = await res.json();
          setStats({ pending: Array.isArray(data?.approvals) ? data.approvals.length : 0 });
          setError(null);
        } else {
          setError(`Unable to load approvals (${res.status})`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 60000); // Refresh every 60 seconds
    return () => clearInterval(interval);
  }, [backendFetch]);

  return (
    <Card className={`${classes.card} ${loading ? classes.loading : ''}`}>
      <CardActionArea
        className={classes.cardContent}
        onClick={() => navigate('/approvals')}
      >
        {stats.pending > 0 && (
          <div className={classes.badge}>{stats.pending}</div>
        )}

        <div className={classes.iconBox}>
          {loading ? (
            <CircularProgress size={24} style={{ color: '#92400e' }} />
          ) : (
            <CheckBoxIcon className={classes.icon} />
          )}
        </div>

        <div className={classes.content}>
          <Typography className={classes.number}>
            {stats.pending}
          </Typography>
          <Typography className={classes.label}>
            {(() => {
              if (error) {
                return 'Approvals inbox — click to open';
              }
              if (stats.pending === 1) {
                return 'deployment pending approval';
              }
              return 'deployments pending approval';
            })()}
          </Typography>
        </div>
      </CardActionArea>
    </Card>
  );
}

export default PendingApprovalsWidget;
