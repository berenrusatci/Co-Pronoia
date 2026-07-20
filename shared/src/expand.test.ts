import { describe, expect, it } from 'vitest';
import { applyOp, emptyGraph, type Graph } from './ops.js';
import { collectSubtree, expand, expandAll, ValidationError } from './expand.js';
import type { PlanNode } from './types.js';

const node = (id: string, parentId: string | null = null, extra: Partial<PlanNode> = {}): PlanNode => ({
  id, parentId, title: `Node ${id}`, description: '', nodeType: 'task', status: 'planned',
  x: null, y: null, linkedCanvasId: null, notes: '', data: {}, createdCommit: 1, updatedCommit: 1, ...extra,
});

/** root ← a ← b, root ← c, edges a→c and b→root. */
function fixture(): Graph {
  const g = emptyGraph();
  applyOp(g, { op: 'add_node', node: node('root') }, 1);
  applyOp(g, { op: 'add_node', node: node('a', 'root') }, 2);
  applyOp(g, { op: 'add_node', node: node('b', 'a') }, 3);
  applyOp(g, { op: 'add_node', node: node('c', 'root') }, 4);
  applyOp(g, { op: 'add_edge', edge: { id: 'e-ac', sourceId: 'a', targetId: 'c', kind: 'flow', direction: 'directed', label: '', createdCommit: 5 } }, 5);
  applyOp(g, { op: 'add_edge', edge: { id: 'e-br', sourceId: 'b', targetId: 'root', kind: 'relation', direction: 'directed', label: '', createdCommit: 5 } }, 5);
  return g;
}

describe('expand', () => {
  it('fills defaults for add_node/add_edge and honors provided ids', () => {
    const g = fixture();
    const [addNode] = expand(g, { op: 'add_node', id: 'my-id', title: 'T', parentId: 'root' }, []);
    expect(addNode).toMatchObject({
      op: 'add_node',
      node: { id: 'my-id', title: 'T', description: '', nodeType: 'task', status: 'planned', x: null, y: null },
    });
    const [addEdge] = expand(g, { op: 'add_edge', sourceId: 'a', targetId: 'b' }, []);
    if (addEdge.op !== 'add_edge') throw new Error('expected add_edge');
    expect(addEdge.edge).toMatchObject({ kind: 'flow', direction: 'directed', label: '' });
    expect(addEdge.edge.id).toBeTruthy();
  });

  it('delete_node cascades: incident edges first, then nodes leaf-first', () => {
    const g = fixture();
    const ops = expand(g, { op: 'delete_node', id: 'a' }, []);
    expect(ops.map((o) => o.op)).toEqual(['delete_edge', 'delete_edge', 'delete_node', 'delete_node']);
    const edgeIds = ops.slice(0, 2).map((o) => (o.op === 'delete_edge' ? o.edge.id : '')).sort();
    expect(edgeIds).toEqual(['e-ac', 'e-br']); // b's edge cascades with the subtree
    const nodeIds = ops.slice(2).map((o) => (o.op === 'delete_node' ? o.node.id : ''));
    expect(nodeIds).toEqual(['b', 'a']); // leaf before parent
    // Sanity: the expanded ops apply cleanly.
    for (const op of ops) applyOp(g, op, 6);
    expect(g.nodes.has('a')).toBe(false);
  });

  it('linkedCanvasId: add_node honors it, update records before/after, unchanged is a no-op', () => {
    const g = fixture();
    const [added] = expand(g, { op: 'add_node', id: 'linked', title: 'L', linkedCanvasId: 'canvas-2' }, []);
    expect(added).toMatchObject({ op: 'add_node', node: { id: 'linked', linkedCanvasId: 'canvas-2' } });

    const [op] = expand(g, { op: 'update_node', id: 'a', fields: { linkedCanvasId: 'canvas-2' } }, []);
    expect(op).toEqual({
      op: 'update_node', id: 'a',
      before: { linkedCanvasId: null },
      after: { linkedCanvasId: 'canvas-2' },
    });
    expect(expand(g, { op: 'update_node', id: 'a', fields: { linkedCanvasId: null } }, [])).toEqual([]);
  });

  it('notes/data: add_node fills defaults, update canonicalizes, deep-equal data is a no-op', () => {
    const g = fixture();
    const [added] = expand(g, { op: 'add_node', id: 'n1', title: 'N' }, []);
    expect(added).toMatchObject({ op: 'add_node', node: { notes: '', data: {} } });

    const [op] = expand(g, { op: 'update_node', id: 'a', fields: { notes: 'uzun not', data: { b: '2', a: '1' } } }, []);
    expect(op).toEqual({
      op: 'update_node', id: 'a',
      before: { notes: '', data: {} },
      after: { notes: 'uzun not', data: { a: '1', b: '2' } }, // kanonik: anahtarlar sıralı
    });
    applyOp(g, op, 6);
    // Aynı içerik, farklı referans ve anahtar sırası → değişiklik yok.
    expect(expand(g, { op: 'update_node', id: 'a', fields: { data: { b: '2', a: '1' } } }, [])).toEqual([]);
    expect(expand(g, { op: 'update_node', id: 'a', fields: { data: { a: '1', b: '3' } } }, [])).toHaveLength(1);
  });

  it('no-op update/move expand to []', () => {
    const g = fixture();
    expect(expand(g, { op: 'update_node', id: 'a', fields: { title: 'Node a' } }, [])).toEqual([]);
    expect(expand(g, { op: 'move_node', id: 'a', x: null as unknown as number, y: null as unknown as number }, [])).toEqual([]);
  });

  it('update_node records before/after and rejects cycles', () => {
    const g = fixture();
    const [op] = expand(g, { op: 'update_node', id: 'b', fields: { title: 'New', status: 'done' } }, []);
    expect(op).toEqual({
      op: 'update_node', id: 'b',
      before: { title: 'Node b', status: 'planned' },
      after: { title: 'New', status: 'done' },
    });
    expect(() => expand(g, { op: 'update_node', id: 'a', fields: { parentId: 'b' } }, [])).toThrow(ValidationError);
  });

  it('expandAll lets later intents see earlier ones (add then connect)', () => {
    const g = fixture();
    const ops = expandAll(g, [
      { op: 'add_node', id: 'new1', title: 'N', parentId: null },
      { op: 'add_edge', id: 'e-new', sourceId: 'new1', targetId: 'c' },
    ]);
    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ op: 'add_edge', edge: { sourceId: 'new1' } });
  });

  it('rejects references to missing entities', () => {
    const g = fixture();
    expect(() => expand(g, { op: 'delete_node', id: 'ghost' }, [])).toThrow(ValidationError);
    expect(() => expand(g, { op: 'add_edge', sourceId: 'ghost', targetId: 'a' }, [])).toThrow(ValidationError);
    expect(() => expand(g, { op: 'delete_edge', id: 'ghost' }, [])).toThrow(ValidationError);
    expect(() => expand(g, { op: 'add_node', title: 'X', parentId: 'ghost' }, [])).toThrow(ValidationError);
  });

  it('collectSubtree walks descendants', () => {
    expect([...collectSubtree(fixture(), 'a')].sort()).toEqual(['a', 'b']);
    expect([...collectSubtree(fixture(), 'root')].sort()).toEqual(['a', 'b', 'c', 'root']);
  });
});
