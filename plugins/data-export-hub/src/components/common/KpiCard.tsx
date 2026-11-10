import { Link as RouterLink } from 'react-router-dom';
import {
  Card,
  CardActionArea,
  CardContent,
  Skeleton,
  Typography,
} from '@mui/material';

interface Props {
  label: string;
  value: number | string | undefined;
  /** Secondary line, e.g. "1.2M rows". */
  caption?: string;
  loading?: boolean;
  tone?: 'default' | 'success' | 'error' | 'info' | 'warning';
  /** Drill-down link. */
  to?: string;
}

export function KpiCard({
  label,
  value,
  caption,
  loading,
  tone = 'default',
  to,
}: Props) {
  const content = (
    <CardContent>
      <Typography
        variant="overline"
        color="text.secondary"
        component="div"
        noWrap
        title={label}
      >
        {label}
      </Typography>
      {loading || value === undefined ? (
        <Skeleton variant="text" width={72} height={44} />
      ) : (
        <Typography
          variant="h4"
          component="div"
          sx={{
            color: tone === 'default' ? 'text.primary' : `${tone}.main`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {typeof value === 'number' ? value.toLocaleString() : value}
        </Typography>
      )}
      {caption && !loading && (
        <Typography variant="caption" color="text.secondary" component="div">
          {caption}
        </Typography>
      )}
    </CardContent>
  );
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      {to ? (
        <CardActionArea
          component={RouterLink}
          to={to}
          sx={{ height: '100%' }}
          aria-label={`${label}: open details`}
        >
          {content}
        </CardActionArea>
      ) : (
        content
      )}
    </Card>
  );
}
