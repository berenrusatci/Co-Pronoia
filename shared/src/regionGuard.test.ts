import { describe, expect, it } from 'vitest';
import { applyOp, emptyGraph, type Graph } from './ops.js';
import { expandAll } from './expand.js';
import { regionViolation } from './regionGuard.js';
import type { PlanEdge, PlanNode, RegionInfo } from './types.js';

const node = (id: string, x: number | null, y: number | null, parentId: string | null = null): PlanNode => ({
  id, parentId, title: `Node ${id}`, description: '', nodeType: 'task', status: 'planned',
  x, y, linkedCanvasId: null, notes: '', data: {}, createdCommit: 1, updatedCommit: 1,
});
const edge = (id: string, sourceId: string, targetId: string): PlanEdge => ({
  id, sourceId, targetId, kind: 'flow', direction: 'directed', label: '', createdCommit: 1,
});

const region: RegionInfo = {
  id: 'r1', name: 'Backend', x: 0, y: 0, width: 300, height: 300,
  color: '#3b6fe0', description: '', aiAllowed: true,
  memberIds: ['member'], memberNames: ['üye'], directMemberIds: ['member'], roleIds: [],
};

/** `in` (100,100) inside the region, `out` (900,900) outside, edge e1: in→out, plus a placeless node. */
function fixture(): Graph {
  const g = emptyGraph();
  applyOp(g, { op: 'add_node', node: node('in', 100, 100) }, 1);
  applyOp(g, { op: 'add_node', node: node('out', 900, 900) }, 1);
  applyOp(g, { op: 'add_node', node: node('free', null, null) }, 1);
  applyOp(g, { op: 'add_edge', edge: edge('e1', 'in', 'out') }, 1);
  return g;
}

const check = (g: Graph, userId: string, intents: Parameters<typeof expandAll>[1]) =>
  regionViolation(g, [region], userId, expandAll(g, intents));

describe('regionViolation over expanded ops', () => {
  it('blocks non-members per op type, allows members and outside edits', () => {
    const g = fixture();
    const denied = /"Backend" bölgesinde değişiklik yetkiniz yok/;
    expect(check(g, 'stranger', [{ op: 'update_node', id: 'in', fields: { title: 'X' } }])).toMatch(denied);
    expect(check(g, 'stranger', [{ op: 'delete_node', id: 'in' }])).toMatch(denied);
    expect(check(g, 'stranger', [{ op: 'add_node', title: 'N', x: 50, y: 50 }])).toMatch(denied);
    expect(check(g, 'stranger', [{ op: 'move_node', id: 'in', x: 900, y: 900 }])).toMatch(denied); // out of region
    expect(check(g, 'stranger', [{ op: 'move_node', id: 'out', x: 10, y: 10 }])).toMatch(denied); // into region
    expect(check(g, 'member', [{ op: 'update_node', id: 'in', fields: { title: 'X' } }])).toBeNull();
    expect(check(g, 'stranger', [{ op: 'update_node', id: 'out', fields: { title: 'X' } }])).toBeNull();
    expect(check(g, 'stranger', [{ op: 'move_node', id: 'out', x: 800, y: 800 }])).toBeNull();
  });

  it('blocks edge ops touching an in-region endpoint (either direction)', () => {
    const g = fixture();
    expect(check(g, 'stranger', [{ op: 'add_edge', sourceId: 'out', targetId: 'in' }])).toMatch(/Backend/);
    expect(check(g, 'stranger', [{ op: 'delete_edge', id: 'e1' }])).toMatch(/Backend/);
    // Edge edit = delete + add with the same id.
    expect(
      check(g, 'stranger', [
        { op: 'delete_edge', id: 'e1' },
        { op: 'add_edge', id: 'e1', sourceId: 'in', targetId: 'out', kind: 'dependency' },
      ]),
    ).toMatch(/Backend/);
    expect(check(g, 'member', [{ op: 'delete_edge', id: 'e1' }])).toBeNull();
    expect(check(g, 'stranger', [{ op: 'add_edge', sourceId: 'out', targetId: 'free' }])).toBeNull();
  });

  it('catches cascaded edge deletes from deleting an OUTSIDE node (the edge hole)', () => {
    const g = fixture();
    // 'out' is outside the region, but deleting it cascades delete_edge e1 whose other end is inside.
    expect(check(g, 'stranger', [{ op: 'delete_node', id: 'out' }])).toMatch(/Backend/);
    expect(check(g, 'member', [{ op: 'delete_node', id: 'out' }])).toBeNull();
  });

  it('catches in-region descendants when deleting an outside parent', () => {
    const g = fixture();
    applyOp(g, { op: 'add_node', node: node('child', 50, 50, 'out') }, 2);
    expect(check(g, 'stranger', [{ op: 'delete_node', id: 'out' }])).toMatch(/Backend/);
  });

  it('nodes without coordinates are outside every region', () => {
    const g = fixture();
    expect(check(g, 'stranger', [{ op: 'update_node', id: 'free', fields: { title: 'X' } }])).toBeNull();
    expect(check(g, 'stranger', [{ op: 'delete_node', id: 'free' }])).toBeNull();
  });

  it('replays the batch: later ops see earlier ops (add outside, then connect to it)', () => {
    const g = fixture();
    expect(
      check(g, 'stranger', [
        { op: 'add_node', id: 'n2', title: 'N', x: 700, y: 700 },
        { op: 'add_edge', sourceId: 'n2', targetId: 'out' },
      ]),
    ).toBeNull();
    expect(
      check(g, 'stranger', [
        { op: 'add_node', id: 'n3', title: 'N', x: 700, y: 700 },
        { op: 'add_edge', sourceId: 'n3', targetId: 'in' },
      ]),
    ).toMatch(/Backend/);
  });

  it('move semantics use the scratch position, not the op snapshot', () => {
    const g = fixture();
    // Two moves in one batch: first legally repositions 'out' into free space,
    // second tries to move it into the region → still blocked at the destination.
    expect(
      check(g, 'stranger', [
        { op: 'move_node', id: 'out', x: 600, y: 600 },
        { op: 'move_node', id: 'out', x: 10, y: 10 },
      ]),
    ).toMatch(/Backend/);
  });

  it('no regions → always null', () => {
    const g = fixture();
    expect(regionViolation(g, [], 'stranger', expandAll(g, [{ op: 'delete_node', id: 'in' }]))).toBeNull();
  });
});
