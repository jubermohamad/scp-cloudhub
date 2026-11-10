import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Chip,
  Box,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import type { AksHealthHistoryItem } from '../../api/AksHealthApi';

interface CertificationHistoryProps {
  history: AksHealthHistoryItem[];
  clusterName?: string;
}

export const CertificationHistory: React.FC<CertificationHistoryProps> = ({
  history,
  clusterName,
}) => {
  if (!history || history.length === 0) {
    return null;
  }

  const getStatusChip = (status: string) => {
    let color = '#16a34a';
    let bg = '#f0fdf4';
    let border = '#bbf7d0';

    if (status === 'DEGRADED') {
      color = '#d97706';
      bg = '#fffbeb';
      border = '#fde68a';
    } else if (status === 'UNHEALTHY') {
      color = '#dc2626';
      bg = '#fef2f2';
      border = '#fecaca';
    }

    return (
      <Chip
        label={status}
        size="small"
        sx={{
          fontWeight: 700,
          color,
          backgroundColor: bg,
          border: `1px solid ${border}`,
          fontSize: '0.75rem',
          height: 24,
        }}
      />
    );
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <Box
        sx={{
          backgroundColor: '#f5f5f5',
          borderBottom: '1px solid #e6e6e6',
          px: 3,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <HistoryIcon fontSize="small" sx={{ color: '#64748b' }} />
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.05rem' }}>
            Certification History
          </Typography>
          {clusterName && (
            <Typography variant="caption" sx={{ color: '#64748b' }}>
              Historical operational assessments for {clusterName}
            </Typography>
          )}
        </Box>
      </Box>

      <CardContent sx={{ p: 0 }}>
        <TableContainer>
          <Table
            size="small"
            sx={{
              '& th': {
                backgroundColor: '#f5f5f5',
                border: '1px solid #e6e6e6',
                fontWeight: 600,
                color: '#334155',
                py: 1.2,
              },
              '& td': {
                border: '1px solid #e6e6e6',
                py: 1.2,
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: '40%' }}>Timestamp</TableCell>
                <TableCell sx={{ width: '25%' }} align="center">
                  Score
                </TableCell>
                <TableCell sx={{ width: '35%' }} align="center">
                  Status
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((item, idx) => (
                <TableRow key={item.id ?? idx} hover>
                  <TableCell
                    sx={{
                      fontFamily: 'monospace',
                      fontWeight: 500,
                      color: '#0f172a',
                    }}
                  >
                    {item.date}
                  </TableCell>
                  <TableCell
                    align="center"
                    sx={{
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      color:
                        item.score >= 90
                          ? '#16a34a'
                          : item.score >= 75
                          ? '#d97706'
                          : '#dc2626',
                    }}
                  >
                    {item.score}
                  </TableCell>
                  <TableCell align="center">{getStatusChip(item.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
};
export default CertificationHistory;
