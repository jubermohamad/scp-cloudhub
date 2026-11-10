import React from 'react';
import { Card, CardContent, Typography, Grid, Chip, Box } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import VerifiedIcon from '@mui/icons-material/Verified';
import CancelIcon from '@mui/icons-material/Cancel';
import type { AksHealthRunResult } from '../../api/AksHealthApi';

interface HealthSummaryCardProps {
  result: AksHealthRunResult;
}

export const HealthSummaryCard: React.FC<HealthSummaryCardProps> = ({
  result,
}) => {
  const isHealthy = result.status === 'HEALTHY' || result.certified;
  const isDegraded = result.status === 'DEGRADED';

  const statusColor = isHealthy ? '#16a34a' : isDegraded ? '#d97706' : '#dc2626';
  const statusBg = isHealthy ? '#f0fdf4' : isDegraded ? '#fffbeb' : '#fef2f2';
  const statusBorder = isHealthy ? '#bbf7d0' : isDegraded ? '#fde68a' : '#fecaca';

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 3,
        border: `1px solid ${statusBorder}`,
        backgroundColor: statusBg,
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Grid container spacing={3} alignItems="center">
          {/* Overall Score */}
          <Grid item xs={12} sm={3}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
              OVERALL SCORE
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'baseline', mt: 0.5 }}>
              <Typography
                variant="h3"
                sx={{
                  fontWeight: 700,
                  color: statusColor,
                  lineHeight: 1,
                }}
              >
                {result.overallScore}
              </Typography>
              <Typography
                variant="h6"
                sx={{ color: '#64748b', ml: 0.5, fontWeight: 500 }}
              >
                /100
              </Typography>
            </Box>
          </Grid>

          {/* Status */}
          <Grid item xs={12} sm={3}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
              CLUSTER STATUS
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <Chip
                icon={
                  isHealthy ? (
                    <CheckCircleIcon />
                  ) : isDegraded ? (
                    <WarningAmberIcon />
                  ) : (
                    <ErrorOutlineIcon />
                  )
                }
                label={result.status}
                sx={{
                  backgroundColor: statusColor,
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  px: 1,
                  '& .MuiChip-icon': { color: '#ffffff' },
                }}
              />
            </Box>
          </Grid>

          {/* Certification */}
          <Grid item xs={12} sm={2}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
              CERTIFIED
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <Chip
                icon={result.certified ? <VerifiedIcon /> : <CancelIcon />}
                label={result.certified ? 'YES' : 'NO'}
                sx={{
                  backgroundColor: result.certified ? '#16a34a' : '#dc2626',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  px: 1,
                  '& .MuiChip-icon': { color: '#ffffff' },
                }}
              />
            </Box>
          </Grid>

          {/* Reason */}
          <Grid item xs={12} sm={4}>
            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
              ASSESSMENT REASON
            </Typography>
            <Typography
              variant="body2"
              sx={{
                mt: 0.5,
                fontWeight: 600,
                color: '#1e293b',
                p: 1,
                backgroundColor: 'rgba(255, 255, 255, 0.7)',
                borderRadius: 1,
                border: '1px solid rgba(0, 0, 0, 0.08)',
              }}
            >
              {result.reason}
            </Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};
export default HealthSummaryCard;
