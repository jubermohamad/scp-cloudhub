import { MouseEvent, useMemo, useState } from 'react';
import { Box, Stack, Typography, useTheme } from '@mui/material';
import { formatDateTime } from '../../utils';

interface Sample {
  capturedAt: string;
  value: number;
}

const WIDTH = 600;
const HEIGHT = 140;
const PAD = { top: 12, right: 8, bottom: 20, left: 32 };

/** Builds SVG path data for a line and its filled area. Exported for tests. */
export function queueDepthPaths(
  samples: Sample[],
  width = WIDTH,
  height = HEIGHT,
): {
  line: string;
  area: string;
  max: number;
  points: Array<{ x: number; y: number }>;
} {
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const max = Math.max(1, ...samples.map(sample => sample.value));
  const step = samples.length > 1 ? innerW / (samples.length - 1) : 0;
  const points = samples.map((sample, index) => ({
    x: PAD.left + index * step,
    y: PAD.top + innerH - (Math.max(0, sample.value) / max) * innerH,
  }));
  if (points.length === 0) return { line: '', area: '', max, points };
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
    )
    .join(' ');
  const baseline = PAD.top + innerH;
  const area = `${line} L${points[points.length - 1].x.toFixed(
    1,
  )},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`;
  return { line, area, max, points };
}

/** Queue depth over the last 24 hours: a single-series area chart with a hover crosshair. */
export function QueueDepthChart({ samples }: { samples: Sample[] }) {
  const theme = useTheme();
  const [hover, setHover] = useState<number | null>(null);
  const { line, area, max, points } = useMemo(
    () => queueDepthPaths(samples),
    [samples],
  );

  if (samples.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No queue samples in the last 24 hours.
      </Typography>
    );
  }

  const latest = samples[samples.length - 1];
  const peak = samples.reduce((a, b) => (b.value > a.value ? b : a));
  const baseline = HEIGHT - PAD.bottom;
  const stroke = theme.palette.primary.main;
  const muted = theme.palette.text.secondary;
  const grid = theme.palette.divider;
  const hovered = hover === null ? null : samples[hover];

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs(points[nearest].x - x)) {
        nearest = index;
      }
    });
    setHover(nearest);
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
        <Typography variant="body2" color="text.secondary">
          Now <strong>{latest.value.toLocaleString()}</strong>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Peak <strong>{peak.value.toLocaleString()}</strong>
        </Typography>
        <Typography variant="body2" color="text.secondary" aria-live="polite">
          {hovered
            ? `${formatDateTime(
                hovered.capturedAt,
              )}: ${hovered.value.toLocaleString()} queued`
            : 'Hover the chart for a reading'}
        </Typography>
      </Stack>
      <Box sx={{ width: '100%', overflow: 'hidden' }}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Queue depth over the last 24 hours, currently ${latest.value}, peak ${peak.value}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ display: 'block' }}
        >
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={PAD.top}
            y2={PAD.top}
            stroke={grid}
            strokeDasharray="3 3"
          />
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={baseline}
            y2={baseline}
            stroke={grid}
          />
          <text
            x={PAD.left - 6}
            y={PAD.top + 4}
            textAnchor="end"
            fontSize={10}
            fill={muted}
          >
            {max}
          </text>
          <text
            x={PAD.left - 6}
            y={baseline}
            textAnchor="end"
            fontSize={10}
            fill={muted}
          >
            0
          </text>
          <text x={PAD.left} y={HEIGHT - 4} fontSize={10} fill={muted}>
            24h ago
          </text>
          <text
            x={WIDTH - PAD.right}
            y={HEIGHT - 4}
            textAnchor="end"
            fontSize={10}
            fill={muted}
          >
            now
          </text>
          <path d={area} fill={stroke} fillOpacity={0.14} />
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {hover !== null && points[hover] && (
            <>
              <line
                x1={points[hover].x}
                x2={points[hover].x}
                y1={PAD.top}
                y2={baseline}
                stroke={muted}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={points[hover].x}
                cy={points[hover].y}
                r={4}
                fill={stroke}
                stroke={theme.palette.background.paper}
                strokeWidth={2}
              />
            </>
          )}
        </svg>
      </Box>
    </Stack>
  );
}
