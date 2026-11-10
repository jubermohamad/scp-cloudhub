import { Box } from '@mui/material';

/** Monospace block for JSON, logs and SQL. Scrolls rather than stretching its container. */
export function CodeBlock({
  children,
  maxHeight = 360,
  ariaLabel,
}: {
  children: string;
  maxHeight?: number;
  ariaLabel?: string;
}) {
  return (
    <Box
      component="pre"
      aria-label={ariaLabel}
      tabIndex={0}
      sx={{
        m: 0,
        p: 1.5,
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.5,
        borderRadius: 1,
        bgcolor: 'action.hover',
        color: 'text.primary',
        border: 1,
        borderColor: 'divider',
        overflow: 'auto',
        maxHeight,
        whiteSpace: 'pre',
      }}
    >
      {children}
    </Box>
  );
}
