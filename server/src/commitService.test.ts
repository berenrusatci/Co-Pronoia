import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { hashPassword, verifyPassword } from './auth.js';
import type { CommitOutcome } from './commitService.js';
import type { GraphState, OpInput } from '@treemapper/shared';

let db: ReturnType<typeof testDbFactory>;
beforeAll(() => {
  db = testDbFactory();
});
afterAll(() => db.cleanup());

const opened: Array<{ prisma: { $disconnect(): Promise<void> } }> = [];
afterAll(async () => {
  for (const { prisma } of opened) await prisma.$disconnect();
});

async function fresh() {
  const built = await buildApp(db.fresh());
  opened.push(built);
  return built;
}

function committed(outcome: CommitOutcome) {
  if (outcome.result !== 'committed') throw new Error(`expected committed, got ${outcome.result}`);
  return outcome;
}
function branched(outcome: CommitOutcome) {
  if (outcome.result !== 'branched') throw new Error(`expected branched, got ${outcome.result}`);
  return outcome;
}

describe('commit engine', () => {
  it('numbers commits sequentially and materializes state', async () => {
    const { service } = await fresh();
    const r1 = committed(await service.commit([{ op: 'add_node', id: 'root', title: 'Root' }]));
    expect(r1.commit.seq).toBe(1);
    const r2 = committed(await service.commit([{ op: 'add_node', id: 'kid', parentId: 'root', title: 'Kid' }]));
    expect(r2.commit.seq).toBe(2);
    expect(r2.state.nodes).toHaveLength(2);
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('auto-generates messages', async () => {
    const { service } = await fresh();
    const { commit } = committed(await service.commit([{ op: 'add_node', title: 'Login page' }]));
    expect(commit.message).toBe('Add node "Login page"');
  });

  it('delete cascades subtree and incident edges atomically', async () => {
    const { service } = await fresh();
    await service.commit([
      { op: 'add_node', id: 'a', title: 'A' },
      { op: 'add_node', id: 'b', parentId: 'a', title: 'B' },
      { op: 'add_node', id: 'c', parentId: 'b', title: 'C' },
      { op: 'add_node', id: 'z', title: 'Z' },
      { op: 'add_edge', id: 'e1', sourceId: 'z', targetId: 'c' },
    ]);
    const { state, commit } = committed(await service.commit([{ op: 'delete_node', id: 'a' }]));
    expect(state.nodes.map((n) => n.id)).toEqual(['z']);
    expect(state.edges).toHaveLength(0);
    expect(commit.ops.filter((o) => o.op === 'delete_node')).toHaveLength(3);
    expect(commit.ops.filter((o) => o.op === 'delete_edge')).toHaveLength(1);
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('rejects cyclic reparent', async () => {
    const { service } = await fresh();
    await service.commit([
      { op: 'add_node', id: 'a', title: 'A' },
      { op: 'add_node', id: 'b', parentId: 'a', title: 'B' },
    ]);
    await expect(service.commit([{ op: 'update_node', id: 'a', fields: { parentId: 'b' } }])).rejects.toThrow(/cycle/);
  });

  it('supports self-loops, parallel edges, kinds and directions', async () => {
    const { service } = await fresh();
    await service.commit([
      { op: 'add_node', id: 'a', title: 'A' },
      { op: 'add_node', id: 'b', title: 'B' },
    ]);
    const { state } = committed(
      await service.commit([
        { op: 'add_edge', id: 'self', sourceId: 'a', targetId: 'a', kind: 'loop' },
        { op: 'add_edge', id: 'p1', sourceId: 'a', targetId: 'b', kind: 'dependency' },
        { op: 'add_edge', id: 'p2', sourceId: 'a', targetId: 'b', kind: 'relation', direction: 'bidirectional' },
      ]),
    );
    expect(state.edges).toHaveLength(3);
    expect(state.edges.find((e) => e.id === 'self')?.targetId).toBe('a');
    expect(state.edges.find((e) => e.id === 'p2')?.direction).toBe('bidirectional');
    // edit = delete + re-add same id in one commit
    const edited = committed(
      await service.commit([
        { op: 'delete_edge', id: 'p1' },
        { op: 'add_edge', id: 'p1', sourceId: 'a', targetId: 'b', kind: 'flow', label: 'yeni' },
      ]),
    );
    expect(edited.state.edges.find((e) => e.id === 'p1')?.label).toBe('yeni');
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('time-travel: stateAt(n) replays exactly', async () => {
    const { service } = await fresh();
    await service.commit([{ op: 'add_node', id: 'a', title: 'A' }]);
    await service.commit([{ op: 'add_node', id: 'b', title: 'B' }]);
    await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'A2' } }]);
    await service.commit([{ op: 'delete_node', id: 'b' }]);
    const at2 = await service.stateAt(2);
    expect(at2.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(at2.nodes.find((n) => n.id === 'a')?.title).toBe('A');
    expect((await service.stateAt(0)).nodes).toHaveLength(0);
  });

  it('revert applies inverse as a new commit; history is append-only', async () => {
    const { service } = await fresh();
    await service.commit([{ op: 'add_node', id: 'a', title: 'A' }]);
    const { commit } = await service.revert(1);
    expect(commit.seq).toBe(2);
    expect(commit.message).toMatch(/^Revert #1/);
    expect((await service.getState()).nodes).toHaveLength(0);
    const again = await service.revert(2);
    expect(again.state.nodes.map((n) => n.id)).toEqual(['a']);
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('revert conflicts throw ConflictError', async () => {
    const { service } = await fresh();
    await service.commit([{ op: 'add_node', id: 'a', title: 'A' }]);
    await service.commit([{ op: 'delete_node', id: 'a' }]);
    await expect(service.revert(1)).rejects.toThrow(/Cannot revert/);
  });

  it('restore resets to an earlier state as one commit', async () => {
    const { service } = await fresh();
    await service.commit([{ op: 'add_node', id: 'a', title: 'A' }]);
    await service.commit([{ op: 'add_node', id: 'b', parentId: 'a', title: 'B' }]);
    await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'Renamed' } }]);
    await service.commit([{ op: 'delete_node', id: 'b' }]);
    const { commit, state } = await service.restore(2);
    expect(commit.seq).toBe(5);
    expect(state.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(state.nodes.find((n) => n.id === 'a')?.title).toBe('A');
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('fuzz: replay equals materialized state after ~150 random ops', async () => {
    const { service } = await fresh();
    let rng = 42;
    const rand = (n: number) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
    const ids: string[] = [];
    let counter = 0;
    for (let i = 0; i < 150; i++) {
      const state = await service.getState();
      const roll = rand(10);
      try {
        if (roll < 4 || ids.length === 0) {
          const id = `n${counter++}`;
          const parent = ids.length > 0 && rand(2) === 0 ? ids[rand(ids.length)] : null;
          await service.commit([{ op: 'add_node', id, parentId: parent, title: `T${id}` }]);
          ids.push(id);
        } else if (roll < 6) {
          await service.commit([{ op: 'update_node', id: ids[rand(ids.length)], fields: { title: `T${counter++}`, status: 'done' } }]);
        } else if (roll < 7) {
          await service.commit([{ op: 'move_node', id: ids[rand(ids.length)], x: rand(500), y: rand(500) }]);
        } else if (roll < 8 && ids.length >= 2) {
          const kinds = ['flow', 'loop', 'dependency', 'relation'] as const;
          await service.commit([{ op: 'add_edge', sourceId: ids[rand(ids.length)], targetId: ids[rand(ids.length)], kind: kinds[rand(4)] }]);
        } else if (roll < 9 && state.edges.length > 0) {
          await service.commit([{ op: 'delete_edge', id: state.edges[rand(state.edges.length)].id }]);
        } else {
          const outcome = await service.commit([{ op: 'delete_node', id: ids[rand(ids.length)] }]);
          if (outcome.result === 'committed') {
            const alive = new Set(outcome.state.nodes.map((n) => n.id));
            ids.length = 0;
            ids.push(...alive);
          }
        }
      } catch {
        // some random ops legitimately fail validation; skip them
      }
    }
    expect(await service.headSeq()).toBeGreaterThan(40);
    expect(await service.rebuildCheck()).toBe(true);
    const mid = Math.floor((await service.headSeq()) / 2);
    const s: GraphState = await service.stateAt(mid);
    for (const e of s.edges) {
      expect(s.nodes.some((n) => n.id === e.sourceId)).toBe(true);
      expect(s.nodes.some((n) => n.id === e.targetId)).toBe(true);
    }
  });
});

describe('branching & co-op', () => {
  async function withUsers() {
    const built = await fresh();
    const u1 = await built.prisma.user.create({ data: { username: 'user1', passwordHash: 'x' } });
    const u2 = await built.prisma.user.create({ data: { username: 'user2', passwordHash: 'x' } });
    await built.service.commit([
      { op: 'add_node', id: 'a', title: 'A' },
      { op: 'add_node', id: 'b', title: 'B' },
    ], { authorId: u1.id });
    return { ...built, u1, u2 };
  }

  it('stale baseSeq with disjoint targets auto-merges onto main', async () => {
    const { service, u1, u2 } = await withUsers();
    const head = await service.headSeq(); // 1
    committed(await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'A-u1' } }], { authorId: u1.id, baseSeq: head }));
    // u2 saw head=1, edits a DIFFERENT node
    const out = committed(await service.commit([{ op: 'update_node', id: 'b', fields: { title: 'B-u2' } }], { authorId: u2.id, baseSeq: head }));
    expect(out.commit.author).toBe('user2');
    const state = await service.getState();
    expect(state.nodes.find((n) => n.id === 'a')?.title).toBe('A-u1');
    expect(state.nodes.find((n) => n.id === 'b')?.title).toBe('B-u2');
    expect(await service.listBranches()).toHaveLength(0);
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('same-field conflict creates a branch named after the user', async () => {
    const { service, u1, u2 } = await withUsers();
    const head = await service.headSeq();
    committed(await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'A-u1' } }], { authorId: u1.id, baseSeq: head }));
    const out = branched(await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'A-u2' } }], { authorId: u2.id, baseSeq: head }));
    expect(out.branch.name).toMatch(/^user2\/cakisma-/);
    expect(out.branch.createdBy).toBe('user2');
    // main untouched by the branched commit
    expect((await service.getState()).nodes.find((n) => n.id === 'a')?.title).toBe('A-u1');
    // branch state has u2's version
    const bs = await service.branchState(out.branch.id);
    expect(bs.nodes.find((n) => n.id === 'a')?.title).toBe('A-u2');
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('delete-vs-update conflict creates a branch', async () => {
    const { service, u1, u2 } = await withUsers();
    const head = await service.headSeq();
    committed(await service.commit([{ op: 'update_node', id: 'a', fields: { status: 'done' } }], { authorId: u1.id, baseSeq: head }));
    const out = await service.commit([{ op: 'delete_node', id: 'a' }], { authorId: u2.id, baseSeq: head });
    expect(out.result).toBe('branched');
  });

  it('update touching different fields of the same node still conflicts only on overlap', async () => {
    const { service, u1, u2 } = await withUsers();
    const head = await service.headSeq();
    committed(await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'X' } }], { authorId: u1.id, baseSeq: head }));
    // different field of the same node → disjoint targets → auto-merge
    const out = await service.commit([{ op: 'update_node', id: 'a', fields: { status: 'done' } }], { authorId: u2.id, baseSeq: head });
    expect(out.result).toBe('committed');
    const node = (await service.getState()).nodes.find((n) => n.id === 'a');
    expect(node?.title).toBe('X');
    expect(node?.status).toBe('done');
  });

  it('merging a branch takes its state wholesale as one commit and closes it', async () => {
    const { service, u1, u2 } = await withUsers();
    const head = await service.headSeq();
    committed(await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'A-u1' } }], { authorId: u1.id, baseSeq: head }));
    const out = branched(await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'A-u2' } }], { authorId: u2.id, baseSeq: head }));
    const { commit, state } = await service.mergeBranch(out.branch.id, u1.id);
    expect(commit.message).toBe(`Merge branch '${out.branch.name}'`);
    expect(commit.author).toBe('user1');
    expect(state.nodes.find((n) => n.id === 'a')?.title).toBe('A-u2');
    expect(await service.listBranches()).toHaveLength(0);
    await expect(service.mergeBranch(out.branch.id, u1.id)).rejects.toThrow(/not open/);
    expect(await service.rebuildCheck()).toBe(true);
    // time-travel still consistent after merge
    expect((await service.stateAt(2)).nodes.find((n) => n.id === 'a')?.title).toBe('A-u1');
  });

  it('discarding a branch keeps main clean and closes it', async () => {
    const { service, u1, u2 } = await withUsers();
    const head = await service.headSeq();
    committed(await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'A-u1' } }], { authorId: u1.id, baseSeq: head }));
    const out = branched(await service.commit([{ op: 'update_node', id: 'a', fields: { title: 'A-u2' } }], { authorId: u2.id, baseSeq: head }));
    await service.discardBranch(out.branch.id);
    expect(await service.listBranches()).toHaveLength(0);
    expect((await service.getState()).nodes.find((n) => n.id === 'a')?.title).toBe('A-u1');
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('concurrent in-flight commits serialize through the mutex', async () => {
    const { service, u1 } = await withUsers();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.commit([{ op: 'add_node', id: `p${i}`, title: `P${i}` }], { authorId: u1.id }),
      ),
    );
    const seqs = results.map((r) => committed(r).commit.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(10);
    expect(await service.rebuildCheck()).toBe(true);
  });
});

describe('auth', () => {
  it('scrypt hash round-trips and rejects wrong passwords', async () => {
    const hash = await hashPassword('gizli123');
    expect(await verifyPassword('gizli123', hash)).toBe(true);
    expect(await verifyPassword('yanlis', hash)).toBe(false);
  });

  it('register/login/me flow with cookies; protected routes 401 without session', async () => {
    const { app } = await fresh();

    let res = await app.inject({ method: 'GET', url: '/api/state' });
    expect(res.statusCode).toBe(401);

    res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'beren', password: 'sifre1' } });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'tm_session');
    expect(cookie).toBeDefined();
    const cookies = { tm_session: cookie!.value };

    res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(res.json().user.username).toBe('beren');

    res = await app.inject({ method: 'GET', url: '/api/state', cookies });
    expect(res.statusCode).toBe(200);

    // commits get the author
    res = await app.inject({ method: 'POST', url: '/api/commit', cookies, payload: { ops: [{ op: 'add_node', title: 'X' }] } });
    expect(res.json().commit.author).toBe('beren');

    // duplicate username
    res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'beren', password: 'baska' } });
    expect(res.statusCode).toBe(409);

    // wrong password
    res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'beren', password: 'yanlis' } });
    expect(res.statusCode).toBe(401);

    // logout kills the session
    res = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies });
    res = await app.inject({ method: 'GET', url: '/api/state', cookies });
    expect(res.statusCode).toBe(401);
  });
});

describe('API integration', () => {
  it('full loop incl. branches over HTTP', async () => {
    const { app } = await fresh();
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'u1', password: 'pass1' } });
    const cookies = { tm_session: reg.cookies.find((c) => c.name === 'tm_session')!.value };
    const reg2 = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'u2', password: 'pass2' } });
    const cookies2 = { tm_session: reg2.cookies.find((c) => c.name === 'tm_session')!.value };

    const post = (url: string, body?: unknown, c = cookies) =>
      app.inject({ method: 'POST', url, payload: body ?? {}, cookies: c }).then((r) => ({ code: r.statusCode, body: r.json() }));
    const get = (url: string, c = cookies) =>
      app.inject({ method: 'GET', url, cookies: c }).then((r) => ({ code: r.statusCode, body: r.json() }));

    await post('/api/commit', { ops: [{ op: 'add_node', id: 'a', title: 'A' }] });
    await post('/api/commit', { ops: [{ op: 'add_node', id: 'b', parentId: 'a', title: 'B' }] });

    // u1 and u2 both edit node a's title from baseSeq 2 → u2 branches
    await post('/api/commit', { ops: [{ op: 'update_node', id: 'a', fields: { title: 'A-u1' } }], baseSeq: 2 });
    let r = await post('/api/commit', { ops: [{ op: 'update_node', id: 'a', fields: { title: 'A-u2' } }], baseSeq: 2 }, cookies2);
    expect(r.body.result).toBe('branched');
    const branchId = r.body.branch.id;

    r = await get('/api/branches');
    expect(r.body.branches).toHaveLength(1);
    expect(r.body.branches[0].createdBy).toBe('u2');

    r = await get(`/api/branches/${branchId}/state`);
    expect(r.body.nodes.find((n: { id: string }) => n.id === 'a').title).toBe('A-u2');

    r = await post(`/api/branches/${branchId}/merge`);
    expect(r.code).toBe(200);
    expect(r.body.state.nodes.find((n: { id: string }) => n.id === 'a').title).toBe('A-u2');

    r = await get('/api/commits');
    expect(r.body.commits[0].message).toMatch(/^Merge branch/);
    expect(r.body.commits[0].author).toBe('u1');

    // validation + 404s still work
    r = await post('/api/commit', { ops: [{ op: 'add_edge', sourceId: 'a', targetId: 'ghost' }] });
    expect(r.code).toBe(400);
    r = await get('/api/state-at/999');
    expect(r.code).toBe(404);
  });
});
