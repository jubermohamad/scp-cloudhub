import { layoutLineage } from '../lineageLayout';
import type { DatasetLineage } from '../types';

function lineage(
  ids: string[],
  edges: Array<[string, string]>,
): DatasetLineage {
  return {
    nodes: ids.map(id => ({
      id,
      datasetId: id.toUpperCase(),
      displayName: id,
      category: 'CASES',
      enabled: true,
    })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

describe('layoutLineage', () => {
  it('places each node one layer after its deepest parent', () => {
    // a → b → d, a → c → d, e → d
    const { layers, positions } = layoutLineage(
      lineage(
        ['d', 'c', 'b', 'a', 'e'],
        [
          ['a', 'b'],
          ['a', 'c'],
          ['b', 'd'],
          ['c', 'd'],
          ['e', 'd'],
        ],
      ),
      { columnGap: 100, rowGap: 10 },
    );
    expect(layers.map(layer => [...layer].sort())).toEqual([
      ['a', 'e'],
      ['b', 'c'],
      ['d'],
    ]);
    expect(positions.a.x).toBe(0);
    expect(positions.b.x).toBe(100);
    expect(positions.d.x).toBe(200);
  });

  it('points every edge rightwards', () => {
    const graph = lineage(
      ['x', 'y', 'z', 'w'],
      [
        ['x', 'z'],
        ['y', 'z'],
        ['z', 'w'],
        ['x', 'w'],
      ],
    );
    const { positions } = layoutLineage(graph);
    for (const edge of graph.edges) {
      expect(positions[edge.from].x).toBeLessThan(positions[edge.to].x);
    }
  });

  it('centres shorter layers and orders children by their parents', () => {
    const { positions, layers } = layoutLineage(
      lineage(
        ['p1', 'p2', 'c2', 'c1'],
        [
          ['p1', 'c1'],
          ['p2', 'c2'],
        ],
      ),
      { rowGap: 10 },
    );
    expect(layers[1]).toEqual(['c1', 'c2']);
    expect(positions.c1.y).toBe(positions.p1.y);

    const fan = layoutLineage(
      lineage(
        ['root', 'a', 'b', 'c'],
        [
          ['a', 'root'],
          ['b', 'root'],
          ['c', 'root'],
        ],
      ),
      { rowGap: 10 },
    );
    expect(fan.positions.root.y).toBe(10);
  });

  it('survives cycles, self-loops and edges to unknown nodes', () => {
    const { positions, layers } = layoutLineage(
      lineage(
        ['a', 'b', 'c'],
        [
          ['a', 'b'],
          ['b', 'c'],
          ['c', 'b'],
          ['a', 'a'],
          ['a', 'ghost'],
        ],
      ),
    );
    expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'c']);
    expect(layers.flat().sort()).toEqual(['a', 'b', 'c']);
    expect(positions.a.x).toBeLessThan(positions.b.x);
  });

  it('handles a single node', () => {
    expect(layoutLineage(lineage(['solo'], [])).positions.solo).toEqual({
      x: 0,
      y: 0,
    });
    expect(layoutLineage({ nodes: [], edges: [] }).layers).toEqual([]);
  });
});
