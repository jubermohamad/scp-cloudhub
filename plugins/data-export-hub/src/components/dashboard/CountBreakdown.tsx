import { Link as RouterLink } from 'react-router-dom';
import { Box, Link, Stack, Typography } from '@mui/material';
import type { ChipTone } from '../../utils';

export interface BreakdownItem {
  label: string;
  value: number;
  tone: ChipTone;
  to?: string;
}

/**
 * Labelled counts with a proportional bar. Status colours come from the theme
 * palette and every bar carries its label and number, so colour is never the
 * only signal.
 */
export function CountBreakdown({ items }: { items: BreakdownItem[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <Stack spacing={1.5}>
      {items.map(item => {
        const share = total > 0 ? (item.value / total) * 100 : 0;
        const color =
          item.tone === 'default' ? 'text.disabled' : `${item.tone}.main`;
        return (
          <Box key={item.label}>
            <Stack direction="row" justifyContent="space-between" mb={0.5}>
              {item.to ? (
                <Link
                  component={RouterLink}
                  to={item.to}
                  variant="body2"
                  underline="hover"
                  color="text.primary"
                >
                  {item.label}
                </Link>
              ) : (
                <Typography variant="body2">{item.label}</Typography>
              )}
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {item.value.toLocaleString()}
              </Typography>
            </Stack>
            <Box
              sx={{
                height: 6,
                borderRadius: 3,
                bgcolor: 'action.hover',
                overflow: 'hidden',
              }}
            >
              <Box
                role="presentation"
                sx={{
                  width: `${share}%`,
                  height: '100%',
                  bgcolor: color,
                  borderRadius: 3,
                }}
              />
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
