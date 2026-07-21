import { describe, expect, it } from 'vitest';
import { bundleToIntents, parseCanvasBundle, serializeCanvas, BundleError, CANVAS_BUNDLE_VERSION } from './canvasBundle.js';
import type { GraphState, PlanEdge, PlanNode } from './types.js';

function node(id: string, parentId: string | null, over: Partial<PlanNode> = {}): PlanNode {
  return {
    id, title: `T-${id}`, description: '', parentId, nodeType: 'task', status: 'planned',
    x: null, y: null, linkedCanvasId: null, notes: '', url: '', urlBy: null, data: {},
    createdCommit: 3, updatedCommit: 5, ...over,
  };
}
function edge(id: string, s: string, t: string): PlanEdge {
  return { id, sourceId: s, targetId: t, kind: 'flow', direction: 'directed', label: '', createdCommit: 3 };
}
function state(nodes: PlanNode[], edges: PlanEdge[] = []): GraphState {
  return { nodes, edges, headSeq: 9 };
}

describe('serializeCanvas → parseCanvasBundle round-trip', () => {
  it('düğüm/kenar/bölgeleri korur; linkedCanvasId taşınmaz', () => {
    const nodes = [
      node('r', null, { nodeType: 'milestone', status: 'done', x: 1, y: 2, linkedCanvasId: 'other-canvas', data: { sahip: 'ayse' } }),
      node('a', 'r'),
    ];
    const bundle = serializeCanvas(state(nodes, [edge('e1', 'r', 'a')]), {
      name: 'Kanvasım',
      exportedAt: '2026-07-21T00:00:00.000Z',
      regions: [{ id: 'rg', name: 'Bölge', x: 0, y: 0, width: 50, height: 40, color: '#abc', description: 'd', aiAllowed: false, memberIds: [], memberNames: [], directMemberIds: [], roleIds: [] }],
    });
    const json = JSON.parse(JSON.stringify(bundle)); // ağ üzerinden geçişi taklit et
    const parsed = parseCanvasBundle(json);
    expect(parsed.version).toBe(CANVAS_BUNDLE_VERSION);
    expect(parsed.name).toBe('Kanvasım');
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0].linkedCanvasId).toBeNull(); // taşınmaz
    expect(parsed.nodes[0].data).toEqual({ sahip: 'ayse' });
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.regions[0]).toMatchObject({ name: 'Bölge', aiAllowed: false, width: 50 });
  });
});

describe('parseCanvasBundle doğrulama', () => {
  it('yanlış kind/sürüm/yapı → BundleError', () => {
    expect(() => parseCanvasBundle(null)).toThrow(BundleError);
    expect(() => parseCanvasBundle({ kind: 'baska', version: 1, nodes: [] })).toThrow(BundleError);
    expect(() => parseCanvasBundle({ kind: 'treemapper.canvas', version: 99, nodes: [] })).toThrow(BundleError);
    expect(() => parseCanvasBundle({ kind: 'treemapper.canvas', version: 1 })).toThrow(/nodes/);
  });
  it('bilinmeyen nodeType/status varsayılana çekilir', () => {
    const b = parseCanvasBundle({ kind: 'treemapper.canvas', version: 1, name: 'x', nodes: [{ id: 'n', nodeType: 'zart', status: 'zurt' }] });
    expect(b.nodes[0].nodeType).toBe('task');
    expect(b.nodes[0].status).toBe('planned');
  });
});

describe('bundleToIntents', () => {
  it('ebeveynler çocuklardan önce; kenarlar sonra; linkedCanvasId yok', () => {
    const bundle = serializeCanvas(state(
      [node('a', 'r'), node('r', null), node('b', 'a', { linkedCanvasId: 'x' })],
      [edge('e1', 'r', 'a')],
    ), { name: 'K' });
    const parsed = parseCanvasBundle(JSON.parse(JSON.stringify(bundle)));
    const intents = bundleToIntents(parsed);
    const addNodes = intents.filter((i) => i.op === 'add_node');
    const order = addNodes.map((i) => (i as { id: string }).id);
    expect(order.indexOf('r')).toBeLessThan(order.indexOf('a'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    for (const i of addNodes) expect('linkedCanvasId' in i).toBe(false);
    expect(intents.filter((i) => i.op === 'add_edge')).toHaveLength(1);
  });

  it('dış ebeveyne işaret eden düğüm kök yapılır; sarkan kenar atlanır', () => {
    const bundle = serializeCanvas(state(
      [node('x', 'yok')],
      [edge('e', 'x', 'silinen')],
    ), { name: 'K' });
    const intents = bundleToIntents(parseCanvasBundle(JSON.parse(JSON.stringify(bundle))));
    const add = intents.find((i) => i.op === 'add_node') as { parentId: string | null };
    expect(add.parentId).toBeNull();
    expect(intents.some((i) => i.op === 'add_edge')).toBe(false);
  });
});
