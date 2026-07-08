import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { GraphState, OpInput } from '@treemapper/shared';

function fresh() {
  const { app, service } = buildApp(':memory:');
  return { app, service };
}

describe('commit engine', () => {
  it('numbers commits sequentially and materializes state', () => {
    const { service } = fresh();
    const r1 = service.commit([{ op: 'add_node', id: 'root', title: 'Root' }]);
    expect(r1.commit.seq).toBe(1);
    const r2 = service.commit([{ op: 'add_node', id: 'kid', parentId: 'root', title: 'Kid' }]);
    expect(r2.commit.seq).toBe(2);
    expect(r2.state.nodes).toHaveLength(2);
    expect(service.rebuildCheck()).toBe(true);
  });

  it('auto-generates messages', () => {
    const { service } = fresh();
    const { commit } = service.commit([{ op: 'add_node', title: 'Login page' }]);
    expect(commit.message).toBe('Add node "Login page"');
  });

  it('delete cascades subtree and incident edges atomically', () => {
    const { service } = fresh();
    service.commit([
      { op: 'add_node', id: 'a', title: 'A' },
      { op: 'add_node', id: 'b', parentId: 'a', title: 'B' },
      { op: 'add_node', id: 'c', parentId: 'b', title: 'C' },
      { op: 'add_node', id: 'z', title: 'Z' },
      { op: 'add_edge', id: 'e1', sourceId: 'z', targetId: 'c' },
    ]);
    const { state, commit } = service.commit([{ op: 'delete_node', id: 'a' }]);
    expect(state.nodes.map((n) => n.id)).toEqual(['z']);
    expect(state.edges).toHaveLength(0);
    // one commit for the whole cascade
    expect(commit.ops.filter((o) => o.op === 'delete_node')).toHaveLength(3);
    expect(commit.ops.filter((o) => o.op === 'delete_edge')).toHaveLength(1);
    expect(service.rebuildCheck()).toBe(true);
  });

  it('rejects cyclic reparent with 400-style error', () => {
    const { service } = fresh();
    service.commit([
      { op: 'add_node', id: 'a', title: 'A' },
      { op: 'add_node', id: 'b', parentId: 'a', title: 'B' },
    ]);
    expect(() => service.commit([{ op: 'update_node', id: 'a', fields: { parentId: 'b' } }])).toThrow(/cycle/);
  });

  it('time-travel: stateAt(n) replays exactly', () => {
    const { service } = fresh();
    service.commit([{ op: 'add_node', id: 'a', title: 'A' }]);
    service.commit([{ op: 'add_node', id: 'b', title: 'B' }]);
    service.commit([{ op: 'update_node', id: 'a', fields: { title: 'A2' } }]);
    service.commit([{ op: 'delete_node', id: 'b' }]);
    const at2 = service.stateAt(2);
    expect(at2.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(at2.nodes.find((n) => n.id === 'a')?.title).toBe('A');
    const at0 = service.stateAt(0);
    expect(at0.nodes).toHaveLength(0);
  });

  it('revert applies inverse as a new commit; history is append-only', () => {
    const { service } = fresh();
    service.commit([{ op: 'add_node', id: 'a', title: 'A' }]);
    const { commit } = service.revert(1);
    expect(commit.seq).toBe(2);
    expect(commit.message).toMatch(/^Revert #1/);
    expect(service.getState().nodes).toHaveLength(0);
    // revert the revert
    const again = service.revert(2);
    expect(again.state.nodes.map((n) => n.id)).toEqual(['a']);
    expect(service.rebuildCheck()).toBe(true);
  });

  it('revert conflicts return ConflictError', () => {
    const { service } = fresh();
    service.commit([{ op: 'add_node', id: 'a', title: 'A' }]); // #1
    service.commit([{ op: 'delete_node', id: 'a' }]); // #2
    expect(() => service.revert(1)).toThrow(/Cannot revert/); // 'a' already gone
  });

  it('restore resets to an earlier state as one commit', () => {
    const { service } = fresh();
    service.commit([{ op: 'add_node', id: 'a', title: 'A' }]);
    service.commit([{ op: 'add_node', id: 'b', parentId: 'a', title: 'B' }]);
    service.commit([{ op: 'update_node', id: 'a', fields: { title: 'Renamed' } }]);
    service.commit([{ op: 'delete_node', id: 'b' }]);
    const { commit, state } = service.restore(2);
    expect(commit.seq).toBe(5);
    expect(state.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(state.nodes.find((n) => n.id === 'a')?.title).toBe('A');
    expect(service.rebuildCheck()).toBe(true);
  });

  it('fuzz: replay equals materialized state after ~200 random ops', () => {
    const { service } = fresh();
    let rng = 42;
    const rand = (n: number) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
    const ids: string[] = [];
    let counter = 0;
    for (let i = 0; i < 200; i++) {
      const state = service.getState();
      const roll = rand(10);
      try {
        let input: OpInput;
        if (roll < 4 || ids.length === 0) {
          const id = `n${counter++}`;
          const parent = ids.length > 0 && rand(2) === 0 ? ids[rand(ids.length)] : null;
          input = { op: 'add_node', id, parentId: parent, title: `T${id}` };
          service.commit([input]);
          ids.push(id);
        } else if (roll < 6) {
          const id = ids[rand(ids.length)];
          service.commit([{ op: 'update_node', id, fields: { title: `T${counter++}`, status: 'done' } }]);
        } else if (roll < 7) {
          const id = ids[rand(ids.length)];
          service.commit([{ op: 'move_node', id, x: rand(500), y: rand(500) }]);
        } else if (roll < 8 && ids.length >= 2) {
          service.commit([{ op: 'add_edge', sourceId: ids[rand(ids.length)], targetId: ids[rand(ids.length)] }]);
        } else if (roll < 9 && state.edges.length > 0) {
          service.commit([{ op: 'delete_edge', id: state.edges[rand(state.edges.length)].id }]);
        } else {
          const id = ids[rand(ids.length)];
          const { state: after } = service.commit([{ op: 'delete_node', id }]);
          const alive = new Set(after.nodes.map((n) => n.id));
          ids.length = 0;
          ids.push(...alive);
        }
      } catch {
        // some random ops legitimately fail validation; skip them
      }
    }
    expect(service.headSeq()).toBeGreaterThan(50);
    expect(service.rebuildCheck()).toBe(true);
    // spot-check time travel at a middle commit doesn't throw and is internally consistent
    const mid = Math.floor(service.headSeq() / 2);
    const s: GraphState = service.stateAt(mid);
    for (const e of s.edges) {
      expect(s.nodes.some((n) => n.id === e.sourceId)).toBe(true);
      expect(s.nodes.some((n) => n.id === e.targetId)).toBe(true);
    }
  });
});

describe('API integration', () => {
  it('full loop: add, connect, update, delete, state-at, revert, restore', async () => {
    const { app } = fresh();
    const post = (url: string, body?: unknown) =>
      app.inject({ method: 'POST', url, payload: body ?? {} }).then((r) => ({ code: r.statusCode, body: r.json() }));
    const get = (url: string) => app.inject({ method: 'GET', url }).then((r) => ({ code: r.statusCode, body: r.json() }));

    let r = await post('/api/commit', { ops: [{ op: 'add_node', id: 'a', title: 'A' }] });
    expect(r.code).toBe(200);
    expect(r.body.commit.seq).toBe(1);
    await post('/api/commit', { ops: [{ op: 'add_node', id: 'b', parentId: 'a', title: 'B' }] });
    await post('/api/commit', { ops: [{ op: 'add_edge', id: 'e1', sourceId: 'a', targetId: 'b' }] });
    await post('/api/commit', { ops: [{ op: 'update_node', id: 'b', fields: { status: 'done' } }], message: 'B bitti' });

    r = await get('/api/state');
    expect(r.body.headSeq).toBe(4);
    expect(r.body.nodes).toHaveLength(2);
    expect(r.body.edges).toHaveLength(1);

    r = await get('/api/state-at/2');
    expect(r.body.nodes).toHaveLength(2);
    expect(r.body.edges).toHaveLength(0);

    r = await get('/api/commits');
    expect(r.body.commits[0].message).toBe('B bitti');
    expect(r.body.commits).toHaveLength(4);

    r = await post('/api/commits/3/revert');
    expect(r.code).toBe(200);
    expect(r.body.state.edges).toHaveLength(0);

    r = await post('/api/commits/4/restore');
    expect(r.code).toBe(200);
    expect(r.body.state.edges).toHaveLength(1);

    // conflict: revert an add whose node was since deleted
    await post('/api/commit', { ops: [{ op: 'delete_node', id: 'b' }] });
    r = await post('/api/commits/2/revert');
    expect(r.code).toBe(409);

    // validation errors
    r = await post('/api/commit', { ops: [{ op: 'add_edge', sourceId: 'a', targetId: 'ghost' }] });
    expect(r.code).toBe(400);
    r = await get('/api/state-at/999');
    expect(r.code).toBe(404);
  });
});
