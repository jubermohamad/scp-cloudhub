import React from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Divider,
  Chip,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import type { AksHealthCheck } from '../../api/AksHealthApi';

interface FindingsPanelProps {
  open: boolean;
  onClose: () => void;
  check: AksHealthCheck | null;
}

export const FindingsPanel: React.FC<FindingsPanelProps> = ({
  open,
  onClose,
  check,
}) => {
  if (!check) return null;

  const isFail = check.status === 'FAIL';
  const isWarn = check.status === 'WARNING';
  const statusColor = isFail ? '#dc2626' : isWarn ? '#d97706' : '#16a34a';
  const statusBg = isFail ? '#fef2f2' : isWarn ? '#fffbeb' : '#f0fdf4';

  const details = check.details || {};
  const hasCnpgSpecifics =
    check.name === 'CloudNativePG' && (details.namespace || details.cluster);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 460 },
          p: 0,
        },
      }}
    >
      {/* Drawer Header */}
      <Box
        sx={{
          p: 2.5,
          backgroundColor: '#0f172a',
          color: '#ffffff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box>
          <Typography
            variant="caption"
            sx={{
              color: '#94a3b8',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            Detailed Findings Drawer
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#f8fafc' }}>
            {check.name}
          </Typography>
        </Box>
        <IconButton onClick={onClose} sx={{ color: '#94a3b8' }}>
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Status Bar */}
      <Box
        sx={{
          p: 2,
          backgroundColor: statusBg,
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Chip
            label={check.status}
            sx={{
              backgroundColor: statusColor,
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.8125rem',
            }}
          />
          <Typography variant="body2" sx={{ fontWeight: 600, color: '#334155' }}>
            Score: {check.score} / {check.weight ?? '-'} pts
          </Typography>
        </Box>
      </Box>

      {/* Drawer Body */}
      <Box sx={{ p: 3 }}>
        {/* If this is CloudNativePG or structured issue, show the exact prompt layout */}
        {hasCnpgSpecifics ? (
          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              mb: 3,
              backgroundColor: '#f8fafc',
              border: `1px solid ${statusColor}40`,
              fontFamily: 'monospace',
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: '#64748b',
                fontWeight: 700,
                textTransform: 'uppercase',
                display: 'block',
                mb: 1.5,
              }}
            >
              CRD Health Inspection
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box>
                <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
                  Namespace:
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                  {String(details.namespace ?? 'nr-scotia')}
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
                  Cluster:
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                  {String(details.cluster ?? 'postgresql-cluster')}
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
                  Issue:
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    color: statusColor,
                  }}
                >
                  {String(details.issue ?? check.reason ?? 'Cluster failing over')}
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
                  Ready:
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                  {String(details.ready ?? `${details.readyInstances ?? 2}/${details.instances ?? 3}`)}
                </Typography>
              </Box>

              <Box sx={{ mt: 1, p: 1.5, backgroundColor: '#ffffff', borderRadius: 1, border: '1px solid #e2e8f0' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <LightbulbOutlinedIcon fontSize="small" sx={{ color: '#d97706' }} />
                  <Typography variant="caption" sx={{ color: '#475569', fontWeight: 700 }}>
                    Recommendation:
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ color: '#0f172a', fontWeight: 600 }}>
                  {String(details.recommendation ?? 'Investigate primary replica instability')}
                </Typography>
              </Box>
            </Box>
          </Paper>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              mb: 3,
              backgroundColor: '#f8fafc',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <InfoOutlinedIcon fontSize="small" sx={{ color: '#64748b' }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1e293b' }}>
                Summary Assessment
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ color: '#334155' }}>
              {check.reason || 'Operational within standard thresholds.'}
            </Typography>
          </Paper>
        )}

        {/* Findings List */}
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 700, color: '#0f172a', mb: 1 }}
        >
          Telemetry & Evidence Findings
        </Typography>

        <List dense disablePadding>
          {(check.findings && check.findings.length > 0
            ? check.findings
            : ['No negative findings reported. Dimension is fully compliant.']
          ).map((finding, idx) => (
            <ListItem
              key={idx}
              disableGutters
              sx={{
                alignItems: 'flex-start',
                py: 0.75,
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <ListItemIcon sx={{ minWidth: 20, mt: 0.75 }}>
                <FiberManualRecordIcon
                  sx={{ fontSize: 8, color: statusColor }}
                />
              </ListItemIcon>
              <ListItemText
                primary={finding}
                primaryTypographyProps={{
                  variant: 'body2',
                  sx: {
                    color: '#334155',
                    fontSize: '0.875rem',
                    fontFamily:
                      finding.includes(':') || finding.includes('/')
                        ? 'monospace'
                        : 'inherit',
                  },
                }}
              />
            </ListItem>
          ))}
        </List>

        <Divider sx={{ my: 3 }} />

        {/* Technical Details JSON */}
        {Object.keys(details).length > 0 && (
          <Box>
            <Typography
              variant="caption"
              sx={{
                color: '#64748b',
                fontWeight: 700,
                textTransform: 'uppercase',
                display: 'block',
                mb: 1,
              }}
            >
              Raw Diagnostic Metadata
            </Typography>
            <Box
              component="pre"
              sx={{
                p: 1.5,
                backgroundColor: '#f1f5f9',
                borderRadius: 1,
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                overflowX: 'auto',
                color: '#1e293b',
                border: '1px solid #e2e8f0',
              }}
            >
              {JSON.stringify(details, null, 2)}
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};
export default FindingsPanel;
