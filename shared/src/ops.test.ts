import { describe, expect, it } from 'vitest';
import { applyOp, emptyGraph, invertOp, invertOps, wouldCreateCycle, type Graph } from './ops.js';
import type { Op, PlanNode } from './types.js';

const node = (id: string, parentId: string | null = null, extra: Partial<PlanNode> = {}): PlanNode => ({
  id, parentId, title: `Node ${id}`, description: '', nodeType: 'task', status: 'planned',
  x: null, y: null, createdCommit: 1, updatedCommit: 1, ...extra,
});

const snapshot = (g: Graph) => JSON.stringify({
  nodes: [...g.nodes.values()].map(({ createdCommit, updatedCommit, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id)),
  edges: [...g.edges.values()].map(({ createdCommit, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id)),
});

describe('invertOp round-trips', () => {
  it('add_node / delete_node / update_node / add_edge / delete_edge / move_node', () => {
    const g = emptyGraph();
    applyOp(g, { op: 'add_node', node: node('a', null, { x: 5, y: 5 }) }, 1);
    applyOp(g, { op: 'add_node', node: node('b', 'a') }, 2);
    applyOp(g, { op: 'add_edge', edge: { id: 'e1', sourceId: 'a', targetId: 'b', kind: 'flow', direction: 'directed', label: '', createdCommit: 2 } }, 2);

    const ops: Op[] = [
      { op: 'add_node', node: node('c', 'a') },
      { op: 'update_node', id: 'b', before: { title: 'Node b' }, after: { title: 'Renamed' } },
      { op: 'move_node', id: 'a', before: { x: 5, y: 5 }, after: { x: 100, y: 50 } },
      { op: 'add_edge', edge: { id: 'e2', sourceId: 'b', targetId: 'a', kind: 'flow', direction: 'directed', label: 'dep', createdCommit: 3 } },
      { op: 'delete_edge', edge: { id: 'e1', sourceId: 'a', targetId: 'b', kind: 'flow', direction: 'directed', label: '', createdCommit: 2 } },
    ];
    const before = snapshot(g);
    for (const op of ops) applyOp(g, op, 3);
    for (const op of invertOps(ops)) applyOp(g, op, 4);
    expect(snapshot(g)).toBe(before);
  });

  it('delete_node inverts to add_node with full state', () => {
    const n = node('x', null, { title: 'Keep me', status: 'done', x: 7, y: 8 });
    const inv = invertOp({ op: 'delete_node', node: n });
    expect(inv).toEqual({ op: 'add_node', node: n });
  });
});

describe('applyOp validation', () => {
  it('rejects deleting a node that still has children or edges', () => {
    const g = emptyGraph();
    applyOp(g, { op: 'add_node', node: node('a') }, 1);
    applyOp(g, { op: 'add_node', node: node('b', 'a') }, 2);
    expect(() => applyOp(g, { op: 'delete_node', node: node('a') }, 3)).toThrow(/child/);
  });

  it('rejects edges to missing nodes', () => {
    const g = emptyGraph();
    applyOp(g, { op: 'add_node', node: node('a') }, 1);
    expect(() =>
      applyOp(g, { op: 'add_edge', edge: { id: 'e', sourceId: 'a', targetId: 'ghost', kind: 'flow', direction: 'directed', label: '', createdCommit: 1 } }, 1),
    ).toThrow(/target/);
  });

  it('rejects reparenting that creates a cycle', () => {
    const g = emptyGraph();
    applyOp(g, { op: 'add_node', node: node('a') }, 1);
    applyOp(g, { op: 'add_node', node: node('b', 'a') }, 2);
    applyOp(g, { op: 'add_node', node: node('c', 'b') }, 3);
    expect(wouldCreateCycle(g, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(g, 'c', 'a')).toBe(false);
    expect(() => applyOp(g, { op: 'update_node', id: 'a', before: { parentId: null }, after: { parentId: 'c' } }, 4)).toThrow(/cycle/);
  });
});
