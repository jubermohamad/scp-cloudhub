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
  Button,
  Box,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import type { AksHealthCheck } from '../../api/AksHealthApi';

interface HealthBreakdownTableProps {
  checks: AksHealthCheck[];
  onSelectCheck: (check: AksHealthCheck) => void;
}

export const HealthBreakdownTable: React.FC<HealthBreakdownTableProps> = ({
  checks,
  onSelectCheck,
}) => {
  const getStatusChip = (status: string) => {
    let color = '#16a34a';
    let bg = '#f0fdf4';
    let border = '#bbf7d0';

    if (status === 'WARNING') {
      color = '#d97706';
      bg = '#fffbeb';
      border = '#fde68a';
    } else if (status === 'FAIL') {
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
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.05rem' }}>
          Detailed Health Breakdown
        </Typography>
        <Typography variant="caption" sx={{ color: '#64748b' }}>
          Evaluation of all 12 operational certification dimensions (Total: 100 points)
        </Typography>
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
                <TableCell sx={{ width: '22%' }}>Certification Category</TableCell>
                <TableCell sx={{ width: '12%' }} align="center">
                  Status
                </TableCell>
                <TableCell sx={{ width: '10%' }} align="center">
                  Score
                </TableCell>
                <TableCell sx={{ width: '10%' }} align="center">
                  Weight
                </TableCell>
                <TableCell sx={{ width: '34%' }}>Reason / Assessment</TableCell>
                <TableCell sx={{ width: '12%' }} align="center">
                  Findings
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {checks.map(check => (
                <TableRow
                  key={check.name}
                  hover
                  sx={{
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: '#f8fafc',
                    },
                  }}
                  onClick={() => onSelectCheck(check)}
                >
                  <TableCell sx={{ fontWeight: 600, color: '#0f172a' }}>
                    {check.name}
                  </TableCell>
                  <TableCell align="center">{getStatusChip(check.status)}</TableCell>
                  <TableCell
                    align="center"
                    sx={{
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color:
                        check.status === 'PASS'
                          ? '#16a34a'
                          : check.status === 'WARNING'
                          ? '#d97706'
                          : '#dc2626',
                    }}
                  >
                    {check.score}
                  </TableCell>
                  <TableCell
                    align="center"
                    sx={{ fontFamily: 'monospace', color: '#64748b' }}
                  >
                    {check.weight ?? '-'}
                  </TableCell>
                  <TableCell sx={{ color: '#334155', fontSize: '0.875rem' }}>
                    {check.reason || 'Operational within parameters'}
                  </TableCell>
                  <TableCell align="center">
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<VisibilityIcon fontSize="small" />}
                      onClick={e => {
                        e.stopPropagation();
                        onSelectCheck(check);
                      }}
                      sx={{
                        textTransform: 'none',
                        color: '#464feb',
                        fontWeight: 600,
                        fontSize: '0.8125rem',
                        '&:hover': {
                          textDecoration: 'none',
                          backgroundColor: 'rgba(70, 79, 235, 0.08)',
                        },
                      }}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
};
export default HealthBreakdownTable;
