import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { hashPassword, verifyPassword } from './auth.js';
import { createCanvas } from './canvasService.js';
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

/** Blank canvas (no seed commit) so seq expectations start at 1. Engine tests bypass route-level membership. */
async function freshCanvas() {
  const built = await fresh();
  const owner = await built.prisma.user.create({ data: { username: 'owner', passwordHash: 'x' } });
  const canvas = await createCanvas(built.prisma, built.serviceFor, 'Test', owner.id, { seedRoot: false });
  return { ...built, service: built.serviceFor(canvas.id), owner, canvas };
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
    const { service } = await freshCanvas();
    const r1 = committed(await service.commit([{ op: 'add_node', id: 'root', title: 'Root' }]));
    expect(r1.commit.seq).toBe(1);
    const r2 = committed(await service.commit([{ op: 'add_node', id: 'kid', parentId: 'root', title: 'Kid' }]));
    expect(r2.commit.seq).toBe(2);
    expect(r2.state.nodes).toHaveLength(2);
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('auto-generates messages', async () => {
    const { service } = await freshCanvas();
    const { commit } = committed(await service.commit([{ op: 'add_node', title: 'Login page' }]));
    expect(commit.message).toBe('Add node "Login page"');
  });

  it('delete cascades subtree and incident edges atomically', async () => {
    const { service } = await freshCanvas();
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
    const { service } = await freshCanvas();
    await service.commit([
      { op: 'add_node', id: 'a', title: 'A' },
      { op: 'add_node', id: 'b', parentId: 'a', title: 'B' },
    ]);
    await expect(service.commit([{ op: 'update_node', id: 'a', fields: { parentId: 'b' } }])).rejects.toThrow(/cycle/);
  });

  it('supports self-loops, parallel edges, kinds and directions', async () => {
    const { service } = await freshCanvas();
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
    const { service } = await freshCanvas();
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
    const { service } = await freshCanvas();
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
    const { service } = await freshCanvas();
    await service.commit([{ op: 'add_node', id: 'a', title: 'A' }]);
    await service.commit([{ op: 'delete_node', id: 'a' }]);
    await expect(service.revert(1)).rejects.toThrow(/Cannot revert/);
  });

  it('restore resets to an earlier state as one commit', async () => {
    const { service } = await freshCanvas();
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
    const { service } = await freshCanvas();
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
    const built = await freshCanvas();
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

    let res = await app.inject({ method: 'GET', url: '/api/canvases' });
    expect(res.statusCode).toBe(401);

    res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'beren', password: 'sifre1' } });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'tm_session');
    expect(cookie).toBeDefined();
    const cookies = { tm_session: cookie!.value };

    res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(res.json().user.username).toBe('beren');

    // fresh account starts with no canvases — the user creates the first one
    res = await app.inject({ method: 'GET', url: '/api/canvases', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().canvases).toHaveLength(0);

    res = await app.inject({ method: 'POST', url: '/api/canvases', cookies, payload: { name: 'Plan' } });
    expect(res.statusCode).toBe(200);
    const canvasId = res.json().canvas.id;
    expect(res.json().canvas.role).toBe('owner');
    expect(res.json().canvas.headSeq).toBe(1); // seed root commit

    res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/state`, cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().nodes).toHaveLength(1);
    expect(res.json().nodes[0].title).toBe('Plan');

    // commits get the author
    res = await app.inject({ method: 'POST', url: `/api/canvases/${canvasId}/commit`, cookies, payload: { ops: [{ op: 'add_node', title: 'X' }] } });
    expect(res.json().commit.author).toBe('beren');

    // duplicate username
    res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'beren', password: 'baska' } });
    expect(res.statusCode).toBe(409);

    // wrong password
    res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'beren', password: 'yanlis' } });
    expect(res.statusCode).toBe(401);

    // logout kills the session
    res = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies });
    res = await app.inject({ method: 'GET', url: '/api/canvases', cookies });
    expect(res.statusCode).toBe(401);
  });
});

describe('canvases & invites', () => {
  async function twoUsers() {
    const built = await fresh();
    const reg1 = await built.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'u1', password: 'pass1' } });
    const reg2 = await built.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'u2', password: 'pass2' } });
    return {
      ...built,
      c1: { tm_session: reg1.cookies.find((c) => c.name === 'tm_session')!.value },
      c2: { tm_session: reg2.cookies.find((c) => c.name === 'tm_session')!.value },
    };
  }

  it('membership gates every canvas route; invite link is the only way in', async () => {
    const { app, c1, c2 } = await twoUsers();
    const created = await app.inject({ method: 'POST', url: '/api/canvases', cookies: c1, payload: { name: 'Gizli plan' } });
    const canvasId = created.json().canvas.id;

    // u2 is not a member: canvas is invisible
    let res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/state`, cookies: c2 });
    expect(res.statusCode).toBe(404);
    res = await app.inject({ method: 'POST', url: `/api/canvases/${canvasId}/commit`, cookies: c2, payload: { ops: [{ op: 'add_node', title: 'X' }] } });
    expect(res.statusCode).toBe(404);
    res = await app.inject({ method: 'GET', url: '/api/canvases', cookies: c2 });
    expect(res.json().canvases).toHaveLength(0);

    // u1 mints an invite; u2 accepts it
    res = await app.inject({ method: 'POST', url: `/api/canvases/${canvasId}/invites`, cookies: c1 });
    expect(res.statusCode).toBe(200);
    const token = res.json().token;

    res = await app.inject({ method: 'GET', url: `/api/invites/${token}`, cookies: c2 });
    expect(res.json()).toEqual({ canvasName: 'Gizli plan', invitedBy: 'u1' });

    res = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, cookies: c2 });
    expect(res.statusCode).toBe(200);
    expect(res.json().canvas.role).toBe('editor');
    expect(res.json().canvas.memberCount).toBe(2);

    // accepting twice is idempotent
    res = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, cookies: c2 });
    expect(res.json().canvas.memberCount).toBe(2);

    // now the canvas opens for u2
    res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/state`, cookies: c2 });
    expect(res.statusCode).toBe(200);

    // bogus token → 404
    res = await app.inject({ method: 'POST', url: '/api/invites/yok-boyle-bir-sey/accept', cookies: c2 });
    expect(res.statusCode).toBe(404);
  });

  it('commit numbering is independent per canvas', async () => {
    const { app, c1 } = await twoUsers();
    const a = (await app.inject({ method: 'POST', url: '/api/canvases', cookies: c1, payload: { name: 'A' } })).json().canvas;
    const post = (canvasId: string, title: string) =>
      app.inject({ method: 'POST', url: `/api/canvases/${canvasId}/commit`, cookies: c1, payload: { ops: [{ op: 'add_node', title }] } });
    await post(a.id, 'x'); // A: seq 2 (after seed)
    await post(a.id, 'y'); // A: seq 3
    const b = (await app.inject({ method: 'POST', url: '/api/canvases', cookies: c1, payload: { name: 'B' } })).json().canvas;
    expect(b.headSeq).toBe(1); // B's seed is #1 regardless of A's history
    const r = await post(b.id, 'z');
    expect(r.json().commit.seq).toBe(2);
    const aCommits = await app.inject({ method: 'GET', url: `/api/canvases/${a.id}/commits`, cookies: c1 });
    expect(aCommits.json().commits.map((c: { seq: number }) => c.seq)).toEqual([3, 2, 1]);
  });
});

describe('roles, regions & owner tools', () => {
  async function canvasWithTwo() {
    const built = await fresh();
    const reg1 = await built.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'sahip', password: 'pass1' } });
    const reg2 = await built.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'uye', password: 'pass2' } });
    const c1 = { tm_session: reg1.cookies.find((c) => c.name === 'tm_session')!.value };
    const c2 = { tm_session: reg2.cookies.find((c) => c.name === 'tm_session')!.value };
    const u2Id = reg2.json().user.id as string;
    const canvas = (await built.app.inject({ method: 'POST', url: '/api/canvases', cookies: c1, payload: { name: 'Ekip' } })).json().canvas;
    const token = (await built.app.inject({ method: 'POST', url: `/api/canvases/${canvas.id}/invites`, cookies: c1 })).json().token;
    await built.app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, cookies: c2 });
    return { ...built, c1, c2, u2Id, base: `/api/canvases/${canvas.id}`, canvasId: canvas.id };
  }

  it('owner assigns roles; viewers are read-only; members can be removed', async () => {
    const { app, c1, c2, u2Id, base } = await canvasWithTwo();

    // joined as editor → can commit
    let res = await app.inject({ method: 'POST', url: `${base}/commit`, cookies: c2, payload: { ops: [{ op: 'add_node', title: 'X' }] } });
    expect(res.statusCode).toBe(200);

    // non-owner cannot manage roles
    res = await app.inject({ method: 'PATCH', url: `${base}/members/${u2Id}`, cookies: c2, payload: { role: 'viewer' } });
    expect(res.statusCode).toBe(403);

    // owner demotes u2 to viewer → all mutations blocked
    res = await app.inject({ method: 'PATCH', url: `${base}/members/${u2Id}`, cookies: c1, payload: { role: 'viewer' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().members.find((m: { userId: string }) => m.userId === u2Id).role).toBe('viewer');
    res = await app.inject({ method: 'POST', url: `${base}/commit`, cookies: c2, payload: { ops: [{ op: 'add_node', title: 'Y' }] } });
    expect(res.statusCode).toBe(403);
    res = await app.inject({ method: 'POST', url: `${base}/invites`, cookies: c2 });
    expect(res.statusCode).toBe(403);
    // reading still works
    res = await app.inject({ method: 'GET', url: `${base}/state`, cookies: c2 });
    expect(res.statusCode).toBe(200);

    // owner's own role is untouchable; owner cannot be removed
    const ownerId = (await app.inject({ method: 'GET', url: '/api/auth/me', cookies: c1 })).json().user.id;
    res = await app.inject({ method: 'PATCH', url: `${base}/members/${ownerId}`, cookies: c1, payload: { role: 'viewer' } });
    expect(res.statusCode).toBe(400);
    res = await app.inject({ method: 'DELETE', url: `${base}/members/${ownerId}`, cookies: c1 });
    expect(res.statusCode).toBe(400);

    // removing u2 revokes access entirely
    res = await app.inject({ method: 'DELETE', url: `${base}/members/${u2Id}`, cookies: c1 });
    expect(res.statusCode).toBe(200);
    res = await app.inject({ method: 'GET', url: `${base}/state`, cookies: c2 });
    expect(res.statusCode).toBe(404);
  });

  it('only the owner can delete the canvas; it disappears for everyone', async () => {
    const { app, c1, c2, base } = await canvasWithTwo();
    let res = await app.inject({ method: 'DELETE', url: base, cookies: c2 });
    expect(res.statusCode).toBe(403);
    res = await app.inject({ method: 'DELETE', url: base, cookies: c1 });
    expect(res.statusCode).toBe(200);
    res = await app.inject({ method: 'GET', url: `${base}/state`, cookies: c1 });
    expect(res.statusCode).toBe(404);
    res = await app.inject({ method: 'GET', url: '/api/canvases', cookies: c1 });
    expect(res.json().canvases).toHaveLength(0);
  });

  it('regions restrict edits to their members; the owner bypasses', async () => {
    const { app, c1, c2, u2Id, base } = await canvasWithTwo();
    // a node inside the future region and one outside
    await app.inject({
      method: 'POST', url: `${base}/commit`, cookies: c1,
      payload: { ops: [
        { op: 'add_node', id: 'in', title: 'İçeride', x: 100, y: 100 },
        { op: 'add_node', id: 'out', title: 'Dışarıda', x: 900, y: 900 },
      ] },
    });

    // only owner defines regions
    let res = await app.inject({ method: 'POST', url: `${base}/regions`, cookies: c2, payload: { name: 'Backend', x: 0, y: 0, width: 300, height: 300 } });
    expect(res.statusCode).toBe(403);
    res = await app.inject({ method: 'POST', url: `${base}/regions`, cookies: c1, payload: { name: 'Backend', x: 0, y: 0, width: 300, height: 300 } });
    expect(res.statusCode).toBe(200);
    const regionId = res.json().region.id;

    // u2 (editor, not in region): inside blocked, outside fine, adding into the region blocked
    res = await app.inject({ method: 'POST', url: `${base}/commit`, cookies: c2, payload: { ops: [{ op: 'update_node', id: 'in', fields: { title: 'Hack' } }] } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/Backend/);
    res = await app.inject({ method: 'POST', url: `${base}/commit`, cookies: c2, payload: { ops: [{ op: 'move_node', id: 'out', x: 150, y: 150 }] } });
    expect(res.statusCode).toBe(403); // moving INTO the region is also blocked
    res = await app.inject({ method: 'POST', url: `${base}/commit`, cookies: c2, payload: { ops: [{ op: 'add_node', title: 'Sızma', x: 50, y: 50 }] } });
    expect(res.statusCode).toBe(403);
    res = await app.inject({ method: 'POST', url: `${base}/commit`, cookies: c2, payload: { ops: [{ op: 'update_node', id: 'out', fields: { title: 'Serbest' } }] } });
    expect(res.statusCode).toBe(200);

    // owner bypasses the region rule
    res = await app.inject({ method: 'POST', url: `${base}/commit`, cookies: c1, payload: { ops: [{ op: 'update_node', id: 'in', fields: { status: 'done' } }] } });
    expect(res.statusCode).toBe(200);

    // assign u2 to the region → allowed now
    res = await app.inject({ method: 'PUT', url: `${base}/regions/${regionId}/members`, cookies: c1, payload: { userIds: [u2Id] } });
    expect(res.statusCode).toBe(200);
    res = await app.inject({ method: 'POST', url: `${base}/commit`, cookies: c2, payload: { ops: [{ op: 'update_node', id: 'in', fields: { title: 'Artık yetkili' } }] } });
    expect(res.statusCode).toBe(200);
  });

  it('password change verifies the current password and rotates sessions', async () => {
    const { app } = await fresh();
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ayar', password: 'eski1' } });
    const cookies = { tm_session: reg.cookies.find((c) => c.name === 'tm_session')!.value };

    let res = await app.inject({ method: 'POST', url: '/api/auth/password', cookies, payload: { current: 'yanlis', next: 'yeni1' } });
    expect(res.statusCode).toBe(401);
    res = await app.inject({ method: 'POST', url: '/api/auth/password', cookies, payload: { current: 'eski1', next: 'yeni1' } });
    expect(res.statusCode).toBe(200);

    res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ayar', password: 'eski1' } });
    expect(res.statusCode).toBe(401);
    res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ayar', password: 'yeni1' } });
    expect(res.statusCode).toBe(200);
    // the session used for the change stays valid
    res = await app.inject({ method: 'GET', url: '/api/canvases', cookies });
    expect(res.statusCode).toBe(200);
  });
});

describe('API integration', () => {
  it('full loop incl. invite + branches over HTTP', async () => {
    const { app } = await fresh();
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'u1', password: 'pass1' } });
    const cookies = { tm_session: reg.cookies.find((c) => c.name === 'tm_session')!.value };
    const reg2 = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'u2', password: 'pass2' } });
    const cookies2 = { tm_session: reg2.cookies.find((c) => c.name === 'tm_session')!.value };

    const post = (url: string, body?: unknown, c = cookies) =>
      app.inject({ method: 'POST', url, payload: body ?? {}, cookies: c }).then((r) => ({ code: r.statusCode, body: r.json() }));
    const get = (url: string, c = cookies) =>
      app.inject({ method: 'GET', url, cookies: c }).then((r) => ({ code: r.statusCode, body: r.json() }));

    // u1 creates a canvas (seed commit = #1) and invites u2
    const canvasId = (await post('/api/canvases', { name: 'Ortak plan' })).body.canvas.id;
    const base = `/api/canvases/${canvasId}`;
    const token = (await post(`${base}/invites`)).body.token;
    await post(`/api/invites/${token}/accept`, {}, cookies2);

    await post(`${base}/commit`, { ops: [{ op: 'add_node', id: 'a', title: 'A' }] }); // #2
    await post(`${base}/commit`, { ops: [{ op: 'add_node', id: 'b', parentId: 'a', title: 'B' }] }); // #3

    // u1 and u2 both edit node a's title from baseSeq 3 → u2 branches
    await post(`${base}/commit`, { ops: [{ op: 'update_node', id: 'a', fields: { title: 'A-u1' } }], baseSeq: 3 });
    let r = await post(`${base}/commit`, { ops: [{ op: 'update_node', id: 'a', fields: { title: 'A-u2' } }], baseSeq: 3 }, cookies2);
    expect(r.body.result).toBe('branched');
    const branchId = r.body.branch.id;

    r = await get(`${base}/branches`);
    expect(r.body.branches).toHaveLength(1);
    expect(r.body.branches[0].createdBy).toBe('u2');

    r = await get(`${base}/branches/${branchId}/state`);
    expect(r.body.nodes.find((n: { id: string }) => n.id === 'a').title).toBe('A-u2');

    r = await post(`${base}/branches/${branchId}/merge`);
    expect(r.code).toBe(200);
    expect(r.body.state.nodes.find((n: { id: string }) => n.id === 'a').title).toBe('A-u2');

    r = await get(`${base}/commits`);
    expect(r.body.commits[0].message).toMatch(/^Merge branch/);
    expect(r.body.commits[0].author).toBe('u1');

    // validation + 404s still work
    r = await post(`${base}/commit`, { ops: [{ op: 'add_edge', sourceId: 'a', targetId: 'ghost' }] });
    expect(r.code).toBe(400);
    r = await get(`${base}/state-at/999`);
    expect(r.code).toBe(404);
  });
});
