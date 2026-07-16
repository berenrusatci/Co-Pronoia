import { describe, expect, it } from 'vitest';
import { buildFlowLayoutOps } from './flowLayout.js';
import type { GraphState, OpInput, PlanEdge, PlanNode, RegionInfo } from './types.js';

const node = (id: string, x: number | null, y: number | null, parentId: string | null = null): PlanNode => ({
  id, parentId, title: `Node ${id}`, description: '', nodeType: 'task', status: 'planned',
  x, y, createdCommit: 1, updatedCommit: 1,
});
const edge = (id: string, sourceId: string, targetId: string): PlanEdge => ({
  id, sourceId, targetId, kind: 'flow', direction: 'directed', label: '', createdCommit: 1,
});
const region = (id: string, x: number, y: number, width: number, height: number): RegionInfo => ({
  id, name: id, x, y, width, height, color: '#000', description: '', aiAllowed: true,
  memberIds: [], memberNames: [], directMemberIds: [], roleIds: [],
});

const moves = (ops: OpInput[]) =>
  ops.filter((o): o is Extract<OpInput, { op: 'move_node' }> => o.op === 'move_node');
const edges = (ops: OpInput[]) =>
  ops.filter((o): o is Extract<OpInput, { op: 'add_edge' }> => o.op === 'add_edge');

describe('buildFlowLayoutOps', () => {
  // A: region rA with root a1 → a2 → a3 (hierarchy). B: region rB with root b1 → b2.
  // orphan region-less: o1 → o2. Cross-region link: a3 → b1 (must NOT become an edge).
  const rA = region('rA', 0, 0, 600, 500);
  const rB = region('rB', 1000, 0, 600, 500);
  const state = (extraEdges: PlanEdge[] = []): GraphState => ({
    headSeq: 1,
    nodes: [
      node('a1', 50, 50), node('a2', 60, 60, 'a1'), node('a3', 70, 70, 'a2'),
      node('b1', 1050, 50, 'a3'), node('b2', 1060, 60, 'b1'),
      node('o1', null, null), node('o2', null, null, 'o1'),
    ],
    edges: extraEdges,
  });

  it('places each region cluster inside its rectangle with margin', () => {
    const ops = buildFlowLayoutOps(state(), [rA, rB], new Set(['rA', 'rB']));
    const targetOf = (id: string) => moves(ops).find((m) => m.id === id)!;
    for (const [id, r] of [['a1', rA], ['a2', rA], ['a3', rA], ['b1', rB], ['b2', rB]] as const) {
      const m = targetOf(id);
      expect(m.x).toBeGreaterThanOrEqual(r.x + 20);
      expect(m.x).toBeLessThanOrEqual(r.x + r.width - 20);
      expect(m.y).toBeGreaterThanOrEqual(r.y + 20);
      expect(m.y).toBeLessThanOrEqual(r.y + r.height - 20);
    }
  });

  it('creates hierarchy edges only within a region, never across regions', () => {
    const pairs = edges(buildFlowLayoutOps(state(), [rA, rB], new Set(['rA', 'rB'])))
      .map((e) => `${e.sourceId}->${e.targetId}`)
      .sort();
    expect(pairs).toEqual(['a1->a2', 'a2->a3', 'b1->b2', 'o1->o2']);
    expect(pairs).not.toContain('a3->b1'); // cross-region link dropped
  });

  it('does not duplicate an edge that already connects parent→child', () => {
    const pairs = edges(buildFlowLayoutOps(state([edge('e1', 'a1', 'a2')]), [rA, rB], new Set(['rA', 'rB'])))
      .map((e) => `${e.sourceId}->${e.targetId}`);
    expect(pairs).not.toContain('a1->a2');
    expect(pairs).toContain('a2->a3');
  });

  it('lays region-less nodes out in a cluster below every region', () => {
    const ops = buildFlowLayoutOps(state(), [rA, rB], new Set(['rA', 'rB']));
    const o1 = moves(ops).find((m) => m.id === 'o1')!;
    const o2 = moves(ops).find((m) => m.id === 'o2')!;
    expect(o1.y).toBeGreaterThan(500); // below both region bottoms
    expect(edges(ops).map((e) => `${e.sourceId}->${e.targetId}`)).toContain('o1->o2');
  });

  it('never touches nodes in a region excluded from the layout set', () => {
    const ops = buildFlowLayoutOps(state(), [rA, rB], new Set(['rA'])); // rB excluded
    expect(moves(ops).some((m) => m.id === 'b1' || m.id === 'b2')).toBe(false);
    expect(edges(ops).map((e) => `${e.sourceId}->${e.targetId}`)).not.toContain('b1->b2');
  });
});
