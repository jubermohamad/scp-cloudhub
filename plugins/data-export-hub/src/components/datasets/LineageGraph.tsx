import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { alpha, Box, Typography, useTheme } from '@mui/material';
import { DATASET_CATEGORY_LABELS, labelFor } from '../../labels';
import { layoutLineage } from '../../lineageLayout';
import { hubPaths } from '../../routes';
import type { DatasetLineage } from '../../types';

const NODE_WIDTH = 220;

interface Props {
  lineage: DatasetLineage;
  currentId: string;
}

/**
 * Dependency graph, upstream on the left. The current dataset is highlighted;
 * clicking any other node opens it. Colours come from the MUI theme so the
 * graph follows light and dark mode.
 */
export function LineageGraph({ lineage, currentId }: Props) {
  const theme = useTheme();
  const navigate = useNavigate();

  const { nodes, edges } = useMemo(() => {
    const { positions } = layoutLineage(lineage, {
      columnGap: NODE_WIDTH + 80,
      rowGap: 90,
    });
    const flowNodes: Node[] = lineage.nodes.map(node => {
      const current = node.id === currentId;
      return {
        id: node.id,
        position: positions[node.id] ?? { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        connectable: false,
        draggable: false,
        data: {
          label: (
            <Box textAlign="left" title={node.displayName}>
              <Typography
                variant="caption"
                component="div"
                sx={{ fontFamily: 'monospace', fontWeight: 600 }}
                noWrap
              >
                {node.datasetId}
              </Typography>
              <Typography variant="caption" component="div" noWrap>
                {node.displayName}
              </Typography>
              <Typography
                variant="caption"
                component="div"
                color="text.secondary"
                noWrap
              >
                {labelFor(DATASET_CATEGORY_LABELS, node.category)}
                {node.enabled ? '' : ' · disabled'}
              </Typography>
            </Box>
          ),
        },
        style: {
          width: NODE_WIDTH,
          padding: 8,
          borderRadius: theme.shape.borderRadius,
          cursor: current ? 'default' : 'pointer',
          color: theme.palette.text.primary,
          background: current
            ? alpha(
                theme.palette.primary.main,
                theme.palette.mode === 'dark' ? 0.28 : 0.12,
              )
            : theme.palette.background.paper,
          border: `${current ? 2 : 1}px solid ${
            current ? theme.palette.primary.main : theme.palette.divider
          }`,
          opacity: node.enabled ? 1 : 0.65,
        },
      };
    });
    const flowEdges: Edge[] = lineage.edges.map(edge => ({
      id: `${edge.from}->${edge.to}`,
      source: edge.from,
      target: edge.to,
      type: 'smoothstep',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: theme.palette.text.secondary,
      },
      style: { stroke: theme.palette.text.secondary, strokeWidth: 1.5 },
    }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [lineage, currentId, theme]);

  return (
    <Box
      sx={{
        height: { xs: 320, md: 380 },
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.default',
        '& .react-flow__controls-button': {
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderBottomColor: 'divider',
          fill: 'currentColor',
          '&:hover': { bgcolor: 'action.hover' },
        },
        '& .react-flow__attribution': {
          bgcolor: 'transparent',
          '& a': { color: 'text.secondary' },
        },
        '& .react-flow__handle': { opacity: 0 },
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesConnectable={false}
        nodesDraggable={false}
        minZoom={0.2}
        onNodeClick={(_event, node) => {
          if (node.id !== currentId) navigate(hubPaths.datasetDetail(node.id));
        }}
      >
        <Background color={theme.palette.divider} gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </Box>
  );
}
