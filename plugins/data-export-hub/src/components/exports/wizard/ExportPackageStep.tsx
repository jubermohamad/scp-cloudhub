import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import type { ExportPackage } from '../../../types';
import type { StepProps } from './types';

export function ExportPackageStep({ form, update, api }: StepProps) {
  const [packages, setPackages] = useState<ExportPackage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .listPackages()
      .then(list => {
        if (cancelled) return;
        if (Array.isArray(list)) setPackages(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const handleToggle = (pkg: ExportPackage) => {
    const wasSelected = form.packageCodes.includes(pkg.packageCode);
    const nextCodes = wasSelected
      ? form.packageCodes.filter(code => code !== pkg.packageCode)
      : [...form.packageCodes, pkg.packageCode];
    const selected = packages.filter(item => nextCodes.includes(item.packageCode));
    const nextName = selected
      .map(item => item.packageName)
      .join(' + ');

    update({
      packageCode: nextCodes.length === 1 ? nextCodes[0] : '',
      packageCodes: nextCodes,
      packageName: nextName,
      packageDescription:
        nextCodes.length === 1
          ? selected[0]?.description || ''
          : `Combined package with ${nextCodes.length} selections`,
      name:
        nextCodes.length > 0
          ? `${form.customerName || form.tenantId} - ${nextName}`
          : '',
    });
  };

  if (loading && packages.length === 0) {
    return (
      <Stack alignItems="center" py={4}>
        <CircularProgress size={24} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Select one or more standard, platform-owned NetReveal export packages. Individual
        dataset configuration is managed automatically.
      </Typography>

      {packages.length === 0 && !loading && (
        <Alert severity="info" variant="outlined">
          No export packages are currently available.
        </Alert>
      )}

      <Grid container spacing={2}>
        {packages.map(pkg => {
          const isSelected = form.packageCodes.includes(pkg.packageCode);
          return (
            <Grid item xs={12} key={pkg.packageCode}>
              <Card
                variant="outlined"
                sx={{
                  borderColor: isSelected ? 'primary.main' : 'divider',
                  bgcolor: isSelected ? 'action.selected' : 'background.paper',
                  borderWidth: isSelected ? 2 : 1,
                  borderRadius: 2,
                }}
              >
                <CardActionArea onClick={() => handleToggle(pkg)}>
                  <CardContent sx={{ py: 2 }}>
                    <Stack direction="row" alignItems="flex-start" spacing={2}>
                      <Checkbox checked={isSelected} value={pkg.packageCode} />
                      <Inventory2OutlinedIcon
                        color={isSelected ? 'primary' : 'action'}
                        sx={{ mt: 0.5 }}
                      />
                      <Stack spacing={0.75} flex={1}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Typography variant="subtitle1" fontWeight={700}>
                            {pkg.packageName}
                          </Typography>
                          <Chip
                            label="Standard Package"
                            size="small"
                            color="info"
                            variant="outlined"
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {pkg.description}
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, pt: 0.5 }}>
                          {pkg.datasetIds.map(report => (
                            <Chip
                              key={report}
                              label={`${report}.tsv`}
                              size="small"
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.75rem',
                                bgcolor: isSelected ? 'primary.50' : 'grey.100',
                              }}
                            />
                          ))}
                        </Box>
                      </Stack>
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Stack>
  );
}
