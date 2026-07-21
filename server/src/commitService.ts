import type { Prisma, PrismaClient } from '@prisma/client';
import {
  applyOp, autoMessage, dataEqual, depthOf, emptyGraph, expandAll, invertOps, normalizeData,
  OpError, regionViolation, summarizeOps, ValidationError,
  type CanvasRole, type Commit, type CommitSummary, type Graph, type GraphDelta, type GraphState, type Op,
  type OpInput, type PlanEdge, type PlanNode,
} from '@treemapper/shared';
import { listRegions } from './canvasService.js';

export class ConflictError extends Error {}
/** A commit that touches a region the actor is not a member of (HTTP 403). */
export class RegionError extends Error {}
export { ValidationError };

/** Who is performing a mutation; omitted for system paths (seed) and engine tests → no region check. */
export interface Actor {
  userId: string;
  role: CanvasRole;
}

export interface BranchSummary {
  id: string;
  name: string;
  baseSeq: number;
  status: string;
  createdBy: string;
  createdAt: string;
}

export interface CommitOptions {
  message?: string;
  authorId?: string | null;
  baseSeq?: number;
  actor?: Actor;
}

export type CommitOutcome =
  | { result: 'committed'; commit: Commit; state: GraphState; droppedMoves?: number }
  | { result: 'branched'; branch: BranchSummary; commit: Commit };

type Tx = Prisma.TransactionClient;

type NodeRow = {
  id: string; parentId: string | null; title: string; description: string;
  nodeType: string; status: string; x: number | null; y: number | null;
  linkedCanvasId: string | null;
  notes: string; url: string; urlBy: string | null; data: unknown;
  createdCommit: number; updatedCommit: number;
};
type EdgeRow = {
  id: string; sourceId: string; targetId: string; kind: string; direction: string;
  label: string; createdCommit: number;
};

const rowToNode = (r: NodeRow): PlanNode => ({
  id: r.id, parentId: r.parentId, title: r.title, description: r.description,
  nodeType: r.nodeType as PlanNode['nodeType'], status: r.status as PlanNode['status'],
  x: r.x, y: r.y, linkedCanvasId: r.linkedCanvasId,
  notes: r.notes, url: r.url, urlBy: r.urlBy, data: normalizeData(r.data),
  createdCommit: r.createdCommit, updatedCommit: r.updatedCommit,
});
const rowToEdge = (r: EdgeRow): PlanEdge => ({
  id: r.id, sourceId: r.sourceId, targetId: r.targetId,
  kind: r.kind as PlanEdge['kind'], direction: r.direction as PlanEdge['direction'],
  label: r.label, createdCommit: r.createdCommit,
});

export class CommitService {
  /**
   * All mutating paths run through this promise-chain mutex. The service is async now,
   * so without it two in-flight commits could interleave between trial replay and write,
   * corrupting head numbering and conflict detection. Load-bearing — do not remove.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /** One instance per canvas (see `serviceFor` in app.ts) so the mutex serializes per canvas. */
  constructor(private prisma: PrismaClient, private canvasId: string) {}

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // ---------- Reads ----------

  async getState(): Promise<GraphState> {
    const [nodes, edges, headSeq] = await Promise.all([
      this.prisma.node.findMany({ where: { canvasId: this.canvasId } }),
      this.prisma.edge.findMany({ where: { canvasId: this.canvasId } }),
      this.headSeq(),
    ]);
    return { nodes: nodes.map(rowToNode), edges: edges.map(rowToEdge), headSeq };
  }

  async headSeq(): Promise<number> {
    const agg = await this.prisma.commit.aggregate({
      _max: { seq: true },
      where: { canvasId: this.canvasId, branchId: null },
    });
    return agg._max.seq ?? 0;
  }

  async getCommit(seq: number): Promise<Commit | null> {
    const row = await this.prisma.commit.findUnique({
      where: { canvasId_seq: { canvasId: this.canvasId, seq } },
      include: { author: { select: { username: true } } },
    });
    if (!row) return null;
    return {
      seq: row.seq, message: row.message, createdAt: row.createdAt.toISOString(),
      ops: JSON.parse(row.ops), author: row.author?.username ?? null, branchId: row.branchId,
    };
  }

  async listCommits(limit = 50, before?: number, branchId: string | null = null): Promise<CommitSummary[]> {
    const rows = await this.prisma.commit.findMany({
      where: { canvasId: this.canvasId, branchId, ...(before !== undefined ? { seq: { lt: before } } : {}) },
      orderBy: { seq: 'desc' },
      take: limit,
      include: { author: { select: { username: true } } },
    });
    return rows.map((r) => ({
      seq: r.seq, message: r.message, createdAt: r.createdAt.toISOString(),
      opSummary: summarizeOps(JSON.parse(r.ops)), author: r.author?.username ?? null,
    }));
  }

  /** Replay main commits 1..seq from empty. */
  async stateAt(seq: number): Promise<GraphState> {
    const graph = await this.replayGraph(seq);
    return { nodes: [...graph.nodes.values()], edges: [...graph.edges.values()], headSeq: seq };
  }

  /**
   * `sinceSeq`'ten güncel head'e kadarki fark: değişen/eklenen düğüm-kenarlar + silinen id'ler.
   * `sinceSeq` head'e eşit/büyükse tüm listeler boştur. Ajanların tüm durumu tekrar çekmeden
   * güncel kalması için (MCP get_state {sinceSeq}). Değişiklik testi düğüm/kenar nesnesinin
   * tam eşitliği (createdCommit/updatedCommit dahil) üzerinden yapılır.
   */
  async stateDelta(sinceSeq: number): Promise<GraphDelta> {
    const [current, previous] = await Promise.all([this.getState(), this.stateAt(sinceSeq)]);
    const prevNodes = new Map(previous.nodes.map((n) => [n.id, n]));
    const prevEdges = new Map(previous.edges.map((e) => [e.id, e]));
    const curNodeIds = new Set(current.nodes.map((n) => n.id));
    const curEdgeIds = new Set(current.edges.map((e) => e.id));
    const differs = (a: unknown, b: unknown) => a === undefined || JSON.stringify(a) !== JSON.stringify(b);
    return {
      headSeq: current.headSeq,
      sinceSeq,
      changedNodes: current.nodes.filter((n) => differs(prevNodes.get(n.id), n)),
      deletedNodeIds: previous.nodes.filter((n) => !curNodeIds.has(n.id)).map((n) => n.id),
      changedEdges: current.edges.filter((e) => differs(prevEdges.get(e.id), e)),
      deletedEdgeIds: previous.edges.filter((e) => !curEdgeIds.has(e.id)).map((e) => e.id),
    };
  }

  private async replayGraph(uptoSeq: number, branchId: string | null = null, branchBase?: number): Promise<Graph> {
    const graph = emptyGraph();
    const mainRows = await this.prisma.commit.findMany({
      where: { canvasId: this.canvasId, branchId: null, seq: { lte: branchId === null ? uptoSeq : branchBase! } },
      orderBy: { seq: 'asc' },
    });
    for (const row of mainRows) for (const op of JSON.parse(row.ops) as Op[]) applyOp(graph, op, row.seq);
    if (branchId !== null) {
      const branchRows = await this.prisma.commit.findMany({
        where: { canvasId: this.canvasId, branchId, seq: { lte: uptoSeq } },
        orderBy: { seq: 'asc' },
      });
      for (const row of branchRows) for (const op of JSON.parse(row.ops) as Op[]) applyOp(graph, op, row.seq);
    }
    return graph;
  }

  // ---------- Branches ----------

  async listBranches(status = 'open'): Promise<BranchSummary[]> {
    const rows = await this.prisma.branch.findMany({
      where: { canvasId: this.canvasId, ...(status === 'all' ? {} : { status }) },
      orderBy: { createdAt: 'desc' },
      include: { creator: { select: { username: true } } },
    });
    return rows.map((b) => ({
      id: b.id, name: b.name, baseSeq: b.baseSeq, status: b.status,
      createdBy: b.creator.username, createdAt: b.createdAt.toISOString(),
    }));
  }

  async branchState(branchId: string): Promise<GraphState> {
    const branch = await this.findBranch(branchId);
    // Postgres seq column is a 4-byte int; Number.MAX_SAFE_INTEGER overflows it as a query value.
    const graph = await this.replayGraph(2147483647, branchId, branch.baseSeq);
    return { nodes: [...graph.nodes.values()], edges: [...graph.edges.values()], headSeq: branch.baseSeq };
  }

  /** Merge = take the branch's state wholesale as one new main commit (diff-based). */
  mergeBranch(branchId: string, authorId?: string | null, actor?: Actor): Promise<{ commit: Commit; state: GraphState }> {
    return this.locked(async () => {
      const branch = await this.findBranch(branchId);
      if (branch.status !== 'open') throw new ValidationError(`branch '${branch.name}' is not open`);
      const target = await this.branchState(branchId);
      const current = await this.getState();
      const ops = diffStates(current, target);
      let commit: Commit;
      if (ops.length === 0) {
        // Branch state already matches main; nothing to apply.
        await this.prisma.branch.update({ where: { id: branchId }, data: { status: 'merged' } });
        return { commit: (await this.getCommit(current.headSeq))!, state: current };
      }
      commit = (await this.applyCommit(ops, `Merge branch '${branch.name}'`, authorId ?? null, actor)).commit;
      await this.prisma.branch.update({ where: { id: branchId }, data: { status: 'merged' } });
      return { commit, state: await this.getState() };
    });
  }

  discardBranch(branchId: string): Promise<BranchSummary> {
    return this.locked(async () => {
      const branch = await this.findBranch(branchId);
      if (branch.status !== 'open') throw new ValidationError(`branch '${branch.name}' is not open`);
      await this.prisma.branch.update({ where: { id: branchId }, data: { status: 'discarded' } });
      const list = await this.listBranches('all');
      return list.find((b) => b.id === branchId)!;
    });
  }

  // ---------- Mutations ----------

  commit(inputs: OpInput[], opts: CommitOptions = {}): Promise<CommitOutcome> {
    return this.locked(async () => {
      if (inputs.length === 0) throw new ValidationError('commit requires at least one op');
      const head = await this.headSeq();
      const { baseSeq, authorId = null, message, actor } = opts;

      if (baseSeq === undefined || baseSeq === head) {
        const graph = await this.loadGraph();
        const ops = expandAll(graph, inputs);
        await this.assertLinkedCanvases(ops);
        const titleOf = (id: string) => graph.nodes.get(id)?.title;
        const { commit, state } = await this.applyCommit(ops, message ?? autoMessage(ops, titleOf), authorId, actor);
        return { result: 'committed', commit, state };
      }

      if (baseSeq > head) throw new ValidationError(`baseSeq ${baseSeq} is ahead of head ${head}`);

      // Head moved since the client last saw it: try to auto-merge.
      const graph = await this.loadGraph();
      let ops: Op[] | null = null;
      try {
        ops = expandAll(graph, inputs);
      } catch {
        ops = null; // does not even apply to current state → conflict
      }
      if (ops !== null) {
        const intervening = await this.prisma.commit.findMany({
          where: { canvasId: this.canvasId, branchId: null, seq: { gt: baseSeq, lte: head } },
        });
        const interveningOps = intervening.flatMap((c) => JSON.parse(c.ops) as Op[]);
        // Yumuşak çakışma: yalnızca konum (move_node) çakışan op'lar — main referans alınır,
        // kullanıcının taşıması sessizce düşer. Kalanlar çakışmıyorsa otomatik merge devam eder.
        const { kept, droppedMoves } = dropSoftConflicts(ops, interveningOps);
        if (!opsConflict(kept, interveningOps)) {
          if (kept.length === 0) {
            // Her şey konum çakışmasıydı; commit edilecek bir şey kalmadı.
            const state = await this.getState();
            return { result: 'committed', commit: (await this.getCommit(head))!, state, droppedMoves };
          }
          await this.assertLinkedCanvases(kept);
          const titleOf = (id: string) => graph.nodes.get(id)?.title;
          const { commit, state } = await this.applyCommit(
            kept, message ?? autoMessage(kept, titleOf), authorId, actor,
          );
          return { result: 'committed', commit, state, ...(droppedMoves > 0 ? { droppedMoves } : {}) };
        }
      }

      // İçerik/durum çakışması → kullanıcının kalıcı kişisel branch'ine park et;
      // kullanıcı dallar panelinden inceleyip (yetkisi varsa) birleştirir.
      const username = authorId
        ? (await this.prisma.user.findUnique({ where: { id: authorId } }))?.username ?? 'anon'
        : 'anon';
      const personal = authorId
        ? await this.prisma.branch.findFirst({
            where: { canvasId: this.canvasId, createdBy: authorId, status: 'open' },
            orderBy: { createdAt: 'desc' },
          })
        : null;

      let branchId: string;
      let expandBase: Graph;
      if (personal && (await this.appliesTo(personal, inputs))) {
        // Açık kişisel dal varsa VE değişiklik oraya uyuyorsa aynı dala eklenir.
        branchId = personal.id;
        expandBase = await this.replayGraph(2147483647, personal.id, personal.baseSeq);
      } else {
        // Açık dal yok ya da değişiklik ona uymuyor → kullanıcıyı engellemeden yeni bir dala park et
        // (ilk çakışmadaki davranışın aynısı). Eski hata "önce dalını birleştir" ölü uçtu.
        expandBase = await this.replayGraph(baseSeq);
        branchId = '';
      }
      const branchOps = expandAll(expandBase, inputs);
      // First line of defense on historical positions; merging re-checks against current state.
      await this.assertRegions(expandBase, branchOps, actor);
      await this.assertLinkedCanvases(branchOps);
      const titleOf = (id: string) => expandBase.nodes.get(id)?.title;
      const { created, seq } = await this.prisma.$transaction(async (tx) => {
        const seq = await this.nextSeq(tx);
        let id = branchId;
        if (!id) {
          const branch = await tx.branch.create({
            data: {
              canvasId: this.canvasId,
              name: await this.uniqueBranchName(username),
              baseSeq,
              createdBy: authorId ?? (await this.systemUserId(tx)),
            },
          });
          id = branch.id;
        }
        await tx.commit.create({
          data: {
            canvasId: this.canvasId, seq, message: message ?? autoMessage(branchOps, titleOf),
            ops: JSON.stringify(branchOps), authorId, branchId: id,
          },
        });
        return { created: id, seq };
      });
      const commit = (await this.getCommit(seq))!;
      const list = await this.listBranches('all');
      return { result: 'branched', branch: list.find((b) => b.id === created)!, commit };
    });
  }

  revert(seq: number, authorId?: string | null, actor?: Actor): Promise<{ commit: Commit; state: GraphState }> {
    return this.locked(async () => {
      const target = await this.getCommit(seq);
      if (!target || target.branchId) throw new ValidationError(`commit #${seq} does not exist on main`);
      const ops = invertOps(target.ops);
      try {
        return await this.applyCommit(ops, `Revert #${seq}: ${target.message}`, authorId ?? null, actor);
      } catch (err) {
        if (err instanceof OpError)
          throw new ConflictError(`Cannot revert #${seq} cleanly: ${err.message}. Use restore instead.`);
        throw err;
      }
    });
  }

  restore(seq: number, authorId?: string | null, actor?: Actor): Promise<{ commit: Commit; state: GraphState }> {
    return this.locked(async () => {
      const head = await this.headSeq();
      if (seq < 0 || seq > head) throw new ValidationError(`commit #${seq} does not exist`);
      const target = await this.stateAt(seq);
      const ops = diffStates(await this.getState(), target);
      if (ops.length === 0) throw new ValidationError('already at that state');
      return this.applyCommit(ops, `Restore to #${seq}`, authorId ?? null, actor);
    });
  }

  // ---------- Internals ----------

  /** True when `inputs` expand cleanly against an open branch's state (so they can be appended to it). */
  private async appliesTo(branch: { id: string; baseSeq: number }, inputs: OpInput[]): Promise<boolean> {
    const branchGraph = await this.replayGraph(2147483647, branch.id, branch.baseSeq);
    try {
      expandAll(branchGraph, inputs);
      return true;
    } catch {
      return false;
    }
  }

  /** Branches must exist AND belong to this canvas — never leak another canvas's branch. */
  private async findBranch(branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, canvasId: this.canvasId } });
    if (!branch) throw new ValidationError(`branch ${branchId} does not exist`);
    return branch;
  }

  /**
   * Per-canvas numbering (incl. branch commits). The in-process mutex serializes writes within
   * one server, but max+1 computed outside the write transaction races across processes (two
   * instances mint the same seq). The Canvas row lock serializes seq assignment at the DB level;
   * it MUST be called inside the transaction that writes the commit so the lock is held until
   * the new seq is visible.
   */
  private async nextSeq(tx: Tx): Promise<number> {
    await tx.$queryRaw`SELECT id FROM "Canvas" WHERE id = ${this.canvasId} FOR UPDATE`;
    const agg = await tx.commit.aggregate({ _max: { seq: true }, where: { canvasId: this.canvasId } });
    return (agg._max.seq ?? 0) + 1;
  }

  private async uniqueBranchName(base: string): Promise<string> {
    let name = base;
    for (let i = 2; await this.prisma.branch.findFirst({ where: { canvasId: this.canvasId, name } }); i++)
      name = `${base}-${i}`;
    return name;
  }

  /** Branch rows require a creator; for author-less contexts use a hidden system user. */
  private async systemUserId(tx: Tx): Promise<string> {
    const existing = await tx.user.findUnique({ where: { username: '__system__' } });
    if (existing) return existing.id;
    const created = await tx.user.create({ data: { username: '__system__', passwordHash: '!' } });
    return created.id;
  }

  /**
   * linkedCanvasId hedefleri: hedef kanvas var olmalı ve bu kanvasla AYNI grupta olmalı;
   * kendine bağlanmak yasak. Yalnızca commit() yolundan çağrılır — revert/restore/mergeBranch
   * bilerek atlar ki silinmiş kanvasa işaret eden tarihî durumlar geri yüklenebilsin.
   */
  private async assertLinkedCanvases(ops: Op[]): Promise<void> {
    const targets = new Set<string>();
    for (const op of ops) {
      if (op.op === 'add_node' && op.node.linkedCanvasId) targets.add(op.node.linkedCanvasId);
      if (op.op === 'update_node' && op.after.linkedCanvasId) targets.add(op.after.linkedCanvasId);
    }
    if (targets.size === 0) return;
    const self = await this.prisma.canvas.findUnique({
      where: { id: this.canvasId }, select: { groupId: true },
    });
    for (const id of targets) {
      if (id === this.canvasId) throw new ValidationError('bir düğüm kendi kanvasına bağlanamaz');
      const target = await this.prisma.canvas.findUnique({ where: { id }, select: { groupId: true } });
      if (!target) throw new ValidationError('bağlanacak kanvas bulunamadı');
      if (!self?.groupId || target.groupId !== self.groupId)
        throw new ValidationError('düğümler yalnızca aynı gruptaki kanvaslara bağlanabilir');
    }
  }

  /**
   * Region rule (non-owners only): expanded ops may not touch nodes — or edges with an
   * endpoint — inside a region the actor is not a member of. Lives here, not in the routes,
   * so every write path (commit, auto-merge, revert, restore, merge) enforces it.
   */
  private async assertRegions(
    graph: Graph, ops: Op[], actor?: Actor, regions?: Awaited<ReturnType<typeof listRegions>>,
  ): Promise<void> {
    if (!actor || actor.role === 'owner') return;
    const list = regions ?? (await listRegions(this.prisma, this.canvasId));
    const violation = regionViolation(graph, list, actor.userId, ops);
    if (violation) throw new RegionError(violation);
  }

  private async applyCommit(ops: Op[], message: string, authorId: string | null, actor?: Actor): Promise<{ commit: Commit; state: GraphState }> {
    // Seq assignment, trial replay and write share one transaction: after the row lock in
    // nextSeq the state can no longer move under us, so the trial validates exactly what
    // the tables will hold when the commit lands (a validation error rolls everything back).
    // Regions are config, preloaded here so the transaction holds a single pool connection.
    const regions =
      actor && actor.role !== 'owner' ? await listRegions(this.prisma, this.canvasId) : undefined;
    const seq = await this.prisma.$transaction(async (tx) => {
      const seq = await this.nextSeq(tx);
      const trial = await this.loadGraph(tx);
      await this.assertRegions(trial, ops, actor, regions);
      for (const op of ops) applyOp(trial, op, seq); // throws OpError on any invalid op
      for (const op of ops) await this.applyToTables(tx, op, seq);
      await tx.commit.create({ data: { canvasId: this.canvasId, seq, message, ops: JSON.stringify(ops), authorId } });
      return seq;
    });
    const commit = (await this.getCommit(seq))!;
    return { commit, state: await this.getState() };
  }

  private async applyToTables(tx: Tx, op: Op, seq: number): Promise<void> {
    switch (op.op) {
      case 'add_node': {
        const { createdCommit: _c, updatedCommit: _u, ...n } = op.node;
        await tx.node.create({ data: { ...n, canvasId: this.canvasId, createdCommit: seq, updatedCommit: seq } });
        break;
      }
      case 'update_node':
        await tx.node.update({
          where: { canvasId_id: { canvasId: this.canvasId, id: op.id } },
          data: { ...op.after, updatedCommit: seq },
        });
        break;
      case 'delete_node':
        await tx.node.delete({ where: { canvasId_id: { canvasId: this.canvasId, id: op.node.id } } });
        break;
      case 'move_node':
        await tx.node.update({
          where: { canvasId_id: { canvasId: this.canvasId, id: op.id } },
          data: { x: op.after.x, y: op.after.y, updatedCommit: seq },
        });
        break;
      case 'add_edge': {
        const { createdCommit: _c, ...e } = op.edge;
        await tx.edge.create({ data: { ...e, canvasId: this.canvasId, createdCommit: seq } });
        break;
      }
      case 'delete_edge':
        await tx.edge.delete({ where: { canvasId_id: { canvasId: this.canvasId, id: op.edge.id } } });
        break;
    }
  }

  private async loadGraph(db: Tx | PrismaClient = this.prisma): Promise<Graph> {
    const graph = emptyGraph();
    const where = { canvasId: this.canvasId };
    for (const row of await db.node.findMany({ where })) graph.nodes.set(row.id, rowToNode(row));
    for (const row of await db.edge.findMany({ where })) graph.edges.set(row.id, rowToEdge(row));
    return graph;
  }

  /** Rebuild materialized tables from the commit log; false = they diverged (bug oracle). */
  async rebuildCheck(): Promise<boolean> {
    const replayed = await this.stateAt(await this.headSeq());
    const current = await this.getState();
    const key = (s: GraphState) => JSON.stringify({
      nodes: [...s.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...s.edges].sort((a, b) => a.id.localeCompare(b.id)),
    });
    return key(replayed) === key(current);
  }
}

// ---------- Conflict detection ----------

interface TargetSet {
  nodeWild: Set<string>;                 // add/delete node id — conflicts with any touch of that node
  nodeFields: Map<string, Set<string>>;  // update/move: node id → field names
  edges: Set<string>;
}

function targetsOf(ops: Op[]): TargetSet {
  const t: TargetSet = { nodeWild: new Set(), nodeFields: new Map(), edges: new Set() };
  const addFields = (id: string, fields: string[]) => {
    const set = t.nodeFields.get(id) ?? new Set<string>();
    for (const f of fields) set.add(f);
    t.nodeFields.set(id, set);
  };
  for (const op of ops) {
    switch (op.op) {
      case 'add_node':
      case 'delete_node':
        t.nodeWild.add(op.node.id);
        break;
      case 'update_node':
        addFields(op.id, Object.keys(op.after));
        break;
      case 'move_node':
        addFields(op.id, ['x', 'y']);
        break;
      case 'add_edge':
      case 'delete_edge':
        t.edges.add(op.edge.id);
        break;
    }
  }
  return t;
}

/**
 * Yumuşak çakışma ayıklama: kullanıcının move_node op'u, araya giren commit'ler aynı düğümün
 * konumuna (x/y) dokunduysa ya da düğümü ekleyip/sildiyse düşürülür — main referans alınır,
 * kullanıcıya sorulmaz. Diğer tüm çakışma türleri (alan bazlı update, delete, edge) sert kalır.
 */
export function dropSoftConflicts(ops: Op[], intervening: Op[]): { kept: Op[]; droppedMoves: number } {
  const ti = targetsOf(intervening);
  const kept: Op[] = [];
  let droppedMoves = 0;
  for (const op of ops) {
    if (op.op === 'move_node') {
      const fields = ti.nodeFields.get(op.id);
      const positionTouched = ti.nodeWild.has(op.id) || (fields !== undefined && (fields.has('x') || fields.has('y')));
      if (positionTouched) {
        droppedMoves += 1;
        continue;
      }
    }
    kept.push(op);
  }
  return { kept, droppedMoves };
}

/** True when two op sets touch overlapping targets (same node wholesale, same node fields, or same edge). */
export function opsConflict(a: Op[], b: Op[]): boolean {
  const ta = targetsOf(a);
  const tb = targetsOf(b);
  for (const id of ta.nodeWild)
    if (tb.nodeWild.has(id) || tb.nodeFields.has(id)) return true;
  for (const id of tb.nodeWild)
    if (ta.nodeFields.has(id)) return true;
  for (const [id, fields] of ta.nodeFields) {
    const other = tb.nodeFields.get(id);
    if (other && [...fields].some((f) => other.has(f))) return true;
  }
  for (const id of ta.edges) if (tb.edges.has(id)) return true;
  return false;
}

/** Ops that transform `from` into `to`. Used by restore and branch merge. */
export function diffStates(from: GraphState, to: GraphState): Op[] {
  const ops: Op[] = [];
  const fromNodes = new Map(from.nodes.map((n) => [n.id, n]));
  const toNodes = new Map(to.nodes.map((n) => [n.id, n]));
  const fromEdges = new Map(from.edges.map((e) => [e.id, e]));
  const toEdges = new Map(to.edges.map((e) => [e.id, e]));

  const edgeChanged = (a: PlanEdge, b: PlanEdge) =>
    a.sourceId !== b.sourceId || a.targetId !== b.targetId || a.label !== b.label ||
    a.kind !== b.kind || a.direction !== b.direction;

  for (const edge of fromEdges.values()) {
    const want = toEdges.get(edge.id);
    if (!want || edgeChanged(edge, want)) ops.push({ op: 'delete_edge', edge });
  }
  const doomed = [...fromNodes.values()].filter((n) => !toNodes.has(n.id));
  doomed.sort((a, b) => depthOf(fromNodes, b.id) - depthOf(fromNodes, a.id));
  for (const node of doomed) ops.push({ op: 'delete_node', node });

  const added = [...toNodes.values()].filter((n) => !fromNodes.has(n.id));
  added.sort((a, b) => depthOf(toNodes, a.id) - depthOf(toNodes, b.id));
  for (const node of added) ops.push({ op: 'add_node', node });

  for (const node of toNodes.values()) {
    const cur = fromNodes.get(node.id);
    if (!cur) continue;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['parentId', 'title', 'description', 'nodeType', 'status', 'linkedCanvasId', 'notes', 'url', 'urlBy'] as const) {
      if (cur[key] !== node[key]) { before[key] = cur[key]; after[key] = node[key]; }
    }
    if (!dataEqual(cur.data, node.data)) { before.data = cur.data; after.data = node.data; }
    if (Object.keys(after).length > 0)
      ops.push({ op: 'update_node', id: node.id, before, after });
    if ((cur.x !== node.x || cur.y !== node.y) && node.x !== null && node.y !== null)
      ops.push({ op: 'move_node', id: node.id, before: { x: cur.x, y: cur.y }, after: { x: node.x, y: node.y } });
  }
  for (const edge of toEdges.values()) {
    const cur = fromEdges.get(edge.id);
    if (!cur || edgeChanged(cur, edge)) ops.push({ op: 'add_edge', edge });
  }
  return ops;
}
