import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Divider,
  Button,
  Snackbar,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import type { AksHealthCheck, AksHealthRunResult } from '../../api/AksHealthApi';

interface CertificationResultProps {
  result: AksHealthRunResult;
  onSelectCheck?: (check: AksHealthCheck) => void;
}

export const CertificationResult: React.FC<CertificationResultProps> = ({
  result,
  onSelectCheck,
}) => {
  const [copied, setCopied] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PASS':
        return '#16a34a'; // Green
      case 'WARNING':
        return '#d97706'; // Amber
      case 'FAIL':
        return '#dc2626'; // Red
      default:
        return '#64748b';
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'PASS':
        return '#f0fdf4';
      case 'WARNING':
        return '#fffbeb';
      case 'FAIL':
        return '#fef2f2';
      default:
        return '#f8fafc';
    }
  };

  const plainText =
    result.formattedOutput ||
    `Cluster: ${result.clusterName}

${result.checks
  .map(c => `${c.name.padEnd(18, ' ')}${c.status}`)
  .join('\n')}

Overall Score: ${result.overallScore}/100

Status: ${result.status}

Certification: ${result.certified ? 'YES' : 'NO'}

Reason:
${result.reason}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(plainText);
    setCopied(true);
  };

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 3,
        border: '1px solid #e2e8f0',
        borderRadius: 2,
        backgroundColor: '#ffffff',
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          backgroundColor: '#0f172a',
          color: '#ffffff',
          px: 3,
          py: 2,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTopLeftRadius: 7,
          borderTopRightRadius: 7,
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
            Authoritative Assessment
          </Typography>
          <Typography
            variant="h6"
            sx={{
              fontFamily: 'monospace',
              fontWeight: 700,
              color: '#38bdf8',
            }}
          >
            Cluster: {result.clusterName}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          onClick={handleCopy}
          startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
          sx={{
            color: '#e2e8f0',
            borderColor: '#475569',
            textTransform: 'none',
            '&:hover': {
              borderColor: '#94a3b8',
              backgroundColor: 'rgba(255,255,255,0.05)',
            },
          }}
        >
          {copied ? 'Copied' : 'Copy Plain Text'}
        </Button>
      </Box>

      <CardContent sx={{ p: 3 }}>
        {/* Checks grid in two columns */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 1.5,
            mb: 3,
          }}
        >
          {result.checks.map(check => {
            const color = getStatusColor(check.status);
            const bg = getStatusBg(check.status);

            return (
              <Box
                key={check.name}
                onClick={() => onSelectCheck?.(check)}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  p: 1.25,
                  px: 2,
                  borderRadius: 1,
                  backgroundColor: bg,
                  border: `1px solid ${color}40`,
                  cursor: onSelectCheck ? 'pointer' : 'default',
                  transition: 'all 0.15s ease-in-out',
                  '&:hover': onSelectCheck
                    ? {
                        transform: 'translateX(2px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                      }
                    : {},
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    color: '#334155',
                    fontSize: '0.95rem',
                  }}
                >
                  {check.name}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      fontWeight: 800,
                      color,
                      fontSize: '0.95rem',
                    }}
                  >
                    {check.status}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>

        <Divider sx={{ my: 2, borderColor: '#e2e8f0' }} />

        {/* Bottom certification decision section */}
        <Box
          sx={{
            p: 2.5,
            backgroundColor: '#f8fafc',
            borderRadius: 1.5,
            border: '1px solid #e2e8f0',
            fontFamily: 'monospace',
          }}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, mb: 2 }}>
            <Box>
              <Typography
                variant="caption"
                sx={{ color: '#64748b', fontWeight: 600 }}
              >
                Overall Score:
              </Typography>
              <Typography
                variant="h6"
                sx={{
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: getStatusColor(
                    result.overallScore >= 90
                      ? 'PASS'
                      : result.overallScore >= 75
                      ? 'WARNING'
                      : 'FAIL',
                  ),
                }}
              >
                {result.overallScore}/100
              </Typography>
            </Box>

            <Box>
              <Typography
                variant="caption"
                sx={{ color: '#64748b', fontWeight: 600 }}
              >
                Status:
              </Typography>
              <Typography
                variant="h6"
                sx={{
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color:
                    result.status === 'HEALTHY'
                      ? '#16a34a'
                      : result.status === 'DEGRADED'
                      ? '#d97706'
                      : '#dc2626',
                }}
              >
                {result.status}
              </Typography>
            </Box>

            <Box>
              <Typography
                variant="caption"
                sx={{ color: '#64748b', fontWeight: 600 }}
              >
                Certification:
              </Typography>
              <Typography
                variant="h6"
                sx={{
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: result.certified ? '#16a34a' : '#dc2626',
                }}
              >
                {result.certified ? 'YES' : 'NO'}
              </Typography>
            </Box>
          </Box>

          <Box>
            <Typography
              variant="caption"
              sx={{ color: '#64748b', fontWeight: 600 }}
            >
              Reason:
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                fontWeight: 600,
                color: '#0f172a',
                mt: 0.5,
                p: 1.5,
                backgroundColor: '#ffffff',
                borderRadius: 1,
                border: '1px solid #cbd5e1',
              }}
            >
              {result.reason}
            </Typography>
          </Box>
        </Box>
      </CardContent>

      <Snackbar
        open={copied}
        autoHideDuration={2500}
        onClose={() => setCopied(false)}
        message="Exact certification result copied to clipboard"
      />
    </Card>
  );
};
export default CertificationResult;
