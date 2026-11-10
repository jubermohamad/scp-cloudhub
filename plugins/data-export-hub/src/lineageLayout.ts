import type { DatasetLineage } from './types';

export interface LayoutOptions {
  columnGap?: number;
  rowGap?: number;
}

export interface LineageLayout {
  /** Top-left position of each node, keyed by node id. */
  positions: Record<string, { x: number; y: number }>;
  /** Node ids per layer, left (most upstream) to right. */
  layers: string[][];
}

/**
 * Layered left-to-right layout for a dependency graph.
 *
 * Each node's layer is the length of the longest upstream path to it, so every
 * edge points rightwards. Nodes caught in a cycle (which the catalog should
 * not contain, but old data might) are placed one layer after their resolved
 * parents rather than looping. Within a layer nodes are ordered by the average
 * position of their parents (one barycentre pass) to reduce edge crossings,
 * then by display order for stability. Layers are vertically centred.
 */
export function layoutLineage(
  lineage: DatasetLineage,
  options: LayoutOptions = {},
): LineageLayout {
  const columnGap = options.columnGap ?? 280;
  const rowGap = options.rowGap ?? 96;
  const ids = lineage.nodes.map(node => node.id);
  const known = new Set(ids);
  const edges = lineage.edges.filter(
    edge => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to,
  );

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const id of ids) {
    parents.set(id, []);
    children.set(id, []);
  }
  for (const edge of edges) {
    parents.get(edge.to)!.push(edge.from);
    children.get(edge.from)!.push(edge.to);
  }

  // Kahn's algorithm, tracking the longest path into each node.
  const layer = new Map<string, number>();
  const remaining = new Map(ids.map(id => [id, parents.get(id)!.length]));
  const queue = ids.filter(id => remaining.get(id) === 0);
  for (const id of queue) layer.set(id, 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of children.get(id)!) {
      layer.set(child, Math.max(layer.get(child) ?? 0, layer.get(id)! + 1));
      const left = remaining.get(child)! - 1;
      remaining.set(child, left);
      if (left === 0) queue.push(child);
    }
  }
  // Cycle members never reach in-degree zero; place them after known parents.
  for (const id of ids) {
    if (remaining.get(id)! > 0 || !layer.has(id)) {
      const parentLayers = parents
        .get(id)!
        .map(parent => layer.get(parent))
        .filter((value): value is number => value !== undefined);
      layer.set(id, parentLayers.length ? Math.max(...parentLayers) + 1 : 0);
    }
  }

  const layerCount = Math.max(0, ...ids.map(id => layer.get(id)! + 1));
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of ids) layers[layer.get(id)!].push(id);

  const order = new Map<string, number>();
  layers.forEach((nodes, index) => {
    if (index > 0) {
      const score = (id: string) => {
        const placed = parents
          .get(id)!
          .map(parent => order.get(parent))
          .filter((value): value is number => value !== undefined);
        return placed.length
          ? placed.reduce((sum, value) => sum + value, 0) / placed.length
          : Number.MAX_SAFE_INTEGER;
      };
      const original = new Map(nodes.map((id, i) => [id, i]));
      nodes.sort(
        (a, b) => score(a) - score(b) || original.get(a)! - original.get(b)!,
      );
    }
    nodes.forEach((id, i) => order.set(id, i));
  });

  const tallest = Math.max(0, ...layers.map(nodes => nodes.length));
  const positions: LineageLayout['positions'] = {};
  layers.forEach((nodes, index) => {
    const offset = ((tallest - nodes.length) * rowGap) / 2;
    nodes.forEach((id, i) => {
      positions[id] = { x: index * columnGap, y: offset + i * rowGap };
    });
  });

  return { positions, layers };
}
