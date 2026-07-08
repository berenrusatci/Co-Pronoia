import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import {
  applyOp, autoMessage, emptyGraph, invertOps, OpError, summarizeOps, wouldCreateCycle,
  type Commit, type CommitSummary, type Graph, type GraphState, type Op, type OpInput,
  type PlanEdge, type PlanNode,
} from '@treemapper/shared';

export class ConflictError extends Error {}
export class ValidationError extends Error {}

interface NodeRow {
  id: string; parent_id: string | null; title: string; description: string;
  node_type: string; status: string; x: number | null; y: number | null;
  created_commit: number; updated_commit: number;
}
interface EdgeRow {
  id: string; source_id: string; target_id: string; kind: string; label: string; created_commit: number;
}
interface CommitRow { seq: number; message: string; created_at: string; ops: string }

const rowToNode = (r: NodeRow): PlanNode => ({
  id: r.id, parentId: r.parent_id, title: r.title, description: r.description,
  nodeType: r.node_type as PlanNode['nodeType'], status: r.status as PlanNode['status'],
  x: r.x, y: r.y, createdCommit: r.created_commit, updatedCommit: r.updated_commit,
});
const rowToEdge = (r: EdgeRow): PlanEdge => ({
  id: r.id, sourceId: r.source_id, targetId: r.target_id,
  kind: r.kind as PlanEdge['kind'], label: r.label, createdCommit: r.created_commit,
});

export class CommitService {
  constructor(private db: Database.Database) {}

  getState(): GraphState {
    const nodes = (this.db.prepare('SELECT * FROM nodes').all() as NodeRow[]).map(rowToNode);
    const edges = (this.db.prepare('SELECT * FROM edges').all() as EdgeRow[]).map(rowToEdge);
    return { nodes, edges, headSeq: this.headSeq() };
  }

  headSeq(): number {
    const row = this.db.prepare('SELECT MAX(seq) AS m FROM commits').get() as { m: number | null };
    return row.m ?? 0;
  }

  getCommit(seq: number): Commit | null {
    const row = this.db.prepare('SELECT * FROM commits WHERE seq = ?').get(seq) as CommitRow | undefined;
    if (!row) return null;
    return { seq: row.seq, message: row.message, createdAt: row.created_at, ops: JSON.parse(row.ops) };
  }

  listCommits(limit = 50, before?: number): CommitSummary[] {
    const rows = (before !== undefined
      ? this.db.prepare('SELECT * FROM commits WHERE seq < ? ORDER BY seq DESC LIMIT ?').all(before, limit)
      : this.db.prepare('SELECT * FROM commits ORDER BY seq DESC LIMIT ?').all(limit)) as CommitRow[];
    return rows.map((r) => ({
      seq: r.seq, message: r.message, createdAt: r.created_at,
      opSummary: summarizeOps(JSON.parse(r.ops)),
    }));
  }

  /** Replay commits 1..seq from empty into an in-memory graph. */
  stateAt(seq: number): GraphState {
    const graph = emptyGraph();
    const rows = this.db
      .prepare('SELECT * FROM commits WHERE seq <= ? ORDER BY seq ASC')
      .all(seq) as CommitRow[];
    for (const row of rows) {
      for (const op of JSON.parse(row.ops) as Op[]) applyOp(graph, op, row.seq);
    }
    return { nodes: [...graph.nodes.values()], edges: [...graph.edges.values()], headSeq: seq };
  }

  /** Expand client intents into full before/after ops against current state, validate, apply, record. */
  commit(inputs: OpInput[], message?: string): { commit: Commit; state: GraphState } {
    if (inputs.length === 0) throw new ValidationError('commit requires at least one op');
    const graph = this.loadGraph();
    const ops: Op[] = [];
    for (const input of inputs) ops.push(...this.expand(graph, input, ops));
    const titleOf = (id: string) => graph.nodes.get(id)?.title;
    return this.applyCommit(ops, message ?? autoMessage(ops, titleOf));
  }

  /** Apply the inverse of commit `seq` as a new commit. Throws ConflictError if it no longer applies. */
  revert(seq: number): { commit: Commit; state: GraphState } {
    const target = this.getCommit(seq);
    if (!target) throw new ValidationError(`commit #${seq} does not exist`);
    const ops = invertOps(target.ops);
    try {
      return this.applyCommit(ops, `Revert #${seq}: ${target.message}`);
    } catch (err) {
      if (err instanceof OpError)
        throw new ConflictError(`Cannot revert #${seq} cleanly: ${err.message}. Use restore instead.`);
      throw err;
    }
  }

  /** Reset the graph to its state at commit `seq`, as one new commit. */
  restore(seq: number): { commit: Commit; state: GraphState } {
    if (seq < 0 || seq > this.headSeq()) throw new ValidationError(`commit #${seq} does not exist`);
    const target = this.stateAt(seq);
    const ops = diffStates(this.getState(), target);
    if (ops.length === 0) throw new ValidationError('already at that state');
    return this.applyCommit(ops, `Restore to #${seq}`);
  }

  /** Validate ops against a copy of the current graph, then apply to SQLite in one transaction. */
  private applyCommit(ops: Op[], message: string): { commit: Commit; state: GraphState } {
    const seq = this.headSeq() + 1;
    const trial = this.loadGraph();
    for (const op of ops) applyOp(trial, op, seq); // throws OpError on any invalid op

    const txn = this.db.transaction(() => {
      for (const op of ops) this.applyToTables(op, seq);
      this.db.prepare('INSERT INTO commits (seq, message, ops) VALUES (?, ?, ?)').run(seq, message, JSON.stringify(ops));
    });
    txn();
    const commit = this.getCommit(seq)!;
    return { commit, state: this.getState() };
  }

  private applyToTables(op: Op, seq: number): void {
    switch (op.op) {
      case 'add_node': {
        const n = op.node;
        this.db.prepare(
          `INSERT INTO nodes (id, parent_id, title, description, node_type, status, x, y, created_commit, updated_commit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(n.id, n.parentId, n.title, n.description, n.nodeType, n.status, n.x, n.y, seq, seq);
        break;
      }
      case 'update_node': {
        const sets: string[] = [];
        const vals: unknown[] = [];
        const map: Record<string, string> = { parentId: 'parent_id', title: 'title', description: 'description', nodeType: 'node_type', status: 'status' };
        for (const [key, col] of Object.entries(map)) {
          if (key in op.after) { sets.push(`${col} = ?`); vals.push((op.after as Record<string, unknown>)[key]); }
        }
        sets.push('updated_commit = ?'); vals.push(seq, op.id);
        this.db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        break;
      }
      case 'delete_node':
        this.db.prepare('DELETE FROM nodes WHERE id = ?').run(op.node.id);
        break;
      case 'move_node':
        this.db.prepare('UPDATE nodes SET x = ?, y = ?, updated_commit = ? WHERE id = ?').run(op.after.x, op.after.y, seq, op.id);
        break;
      case 'add_edge': {
        const e = op.edge;
        this.db.prepare('INSERT INTO edges (id, source_id, target_id, kind, label, created_commit) VALUES (?, ?, ?, ?, ?, ?)')
          .run(e.id, e.sourceId, e.targetId, e.kind, e.label, seq);
        break;
      }
      case 'delete_edge':
        this.db.prepare('DELETE FROM edges WHERE id = ?').run(op.edge.id);
        break;
    }
  }

  /** Expand one intent into full ops. `pending` = ops already queued in this commit (affects cascades). */
  private expand(graph: Graph, input: OpInput, pending: Op[]): Op[] {
    // Apply already-queued ops to a scratch graph so later intents in the same commit see them.
    const scratch: Graph = { nodes: new Map(graph.nodes), edges: new Map(graph.edges) };
    for (const op of pending) applyOp(scratch, op, 0);

    switch (input.op) {
      case 'add_node': {
        if (input.parentId != null && !scratch.nodes.has(input.parentId))
          throw new ValidationError(`parent ${input.parentId} does not exist`);
        const node: PlanNode = {
          id: input.id ?? nanoid(10),
          parentId: input.parentId ?? null,
          title: input.title,
          description: input.description ?? '',
          nodeType: input.nodeType ?? 'task',
          status: input.status ?? 'planned',
          x: input.x ?? null,
          y: input.y ?? null,
          createdCommit: 0,
          updatedCommit: 0,
        };
        return [{ op: 'add_node', node }];
      }
      case 'update_node': {
        const node = scratch.nodes.get(input.id);
        if (!node) throw new ValidationError(`node ${input.id} does not exist`);
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input.fields)) {
          const cur = (node as unknown as Record<string, unknown>)[key];
          if (cur !== value) { before[key] = cur; after[key] = value; }
        }
        if (Object.keys(after).length === 0) return [];
        if ('parentId' in after && after.parentId != null && wouldCreateCycle(scratch, input.id, after.parentId as string))
          throw new ValidationError('reparenting would create a cycle');
        return [{ op: 'update_node', id: input.id, before, after }];
      }
      case 'delete_node': {
        const node = scratch.nodes.get(input.id);
        if (!node) throw new ValidationError(`node ${input.id} does not exist`);
        // Cascade: delete the whole subtree plus every edge touching it, deepest first.
        const subtree = collectSubtree(scratch, input.id);
        const ops: Op[] = [];
        for (const edge of scratch.edges.values())
          if (subtree.has(edge.sourceId) || subtree.has(edge.targetId))
            ops.push({ op: 'delete_edge', edge });
        const ordered = [...subtree].sort((a, b) => depthOf(scratch, b) - depthOf(scratch, a));
        for (const id of ordered) ops.push({ op: 'delete_node', node: scratch.nodes.get(id)! });
        return ops;
      }
      case 'move_node': {
        const node = scratch.nodes.get(input.id);
        if (!node) throw new ValidationError(`node ${input.id} does not exist`);
        if (node.x === input.x && node.y === input.y) return [];
        return [{ op: 'move_node', id: input.id, before: { x: node.x, y: node.y }, after: { x: input.x, y: input.y } }];
      }
      case 'add_edge': {
        if (!scratch.nodes.has(input.sourceId)) throw new ValidationError(`source ${input.sourceId} does not exist`);
        if (!scratch.nodes.has(input.targetId)) throw new ValidationError(`target ${input.targetId} does not exist`);
        const edge: PlanEdge = {
          id: input.id ?? nanoid(10),
          sourceId: input.sourceId, targetId: input.targetId,
          kind: 'flow', label: input.label ?? '', createdCommit: 0,
        };
        return [{ op: 'add_edge', edge }];
      }
      case 'delete_edge': {
        const edge = scratch.edges.get(input.id);
        if (!edge) throw new ValidationError(`edge ${input.id} does not exist`);
        return [{ op: 'delete_edge', edge }];
      }
    }
  }

  private loadGraph(): Graph {
    const graph = emptyGraph();
    for (const row of this.db.prepare('SELECT * FROM nodes').all() as NodeRow[]) {
      const n = rowToNode(row);
      graph.nodes.set(n.id, n);
    }
    for (const row of this.db.prepare('SELECT * FROM edges').all() as EdgeRow[]) {
      const e = rowToEdge(row);
      graph.edges.set(e.id, e);
    }
    return graph;
  }

  /** Rebuild materialized tables from the commit log. Returns false if they diverged (bug oracle). */
  rebuildCheck(): boolean {
    const replayed = this.stateAt(this.headSeq());
    const current = this.getState();
    const key = (s: GraphState) => JSON.stringify({
      nodes: [...s.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...s.edges].sort((a, b) => a.id.localeCompare(b.id)),
    });
    return key(replayed) === key(current);
  }
}

function collectSubtree(graph: Graph, rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of graph.nodes.values()) {
      if (node.parentId !== null && result.has(node.parentId) && !result.has(node.id)) {
        result.add(node.id);
        grew = true;
      }
    }
  }
  return result;
}

function depthOf(graph: Graph, id: string): number {
  let depth = 0;
  let cur = graph.nodes.get(id)?.parentId ?? null;
  while (cur !== null) { depth++; cur = graph.nodes.get(cur)?.parentId ?? null; }
  return depth;
}

/** Ops that transform `from` into `to`. Used by restore. */
export function diffStates(from: GraphState, to: GraphState): Op[] {
  const ops: Op[] = [];
  const fromNodes = new Map(from.nodes.map((n) => [n.id, n]));
  const toNodes = new Map(to.nodes.map((n) => [n.id, n]));
  const fromEdges = new Map(from.edges.map((e) => [e.id, e]));
  const toEdges = new Map(to.edges.map((e) => [e.id, e]));

  // Remove edges that shouldn't exist (before nodes they depend on go away).
  for (const edge of fromEdges.values()) {
    const want = toEdges.get(edge.id);
    if (!want || want.sourceId !== edge.sourceId || want.targetId !== edge.targetId || want.label !== edge.label)
      ops.push({ op: 'delete_edge', edge });
  }
  // Delete nodes not in target, children before parents.
  const doomed = [...fromNodes.values()].filter((n) => !toNodes.has(n.id));
  const depth = (n: PlanNode, nodes: Map<string, PlanNode>): number => {
    let d = 0; let cur = n.parentId;
    while (cur !== null) { d++; cur = nodes.get(cur)?.parentId ?? null; }
    return d;
  };
  doomed.sort((a, b) => depth(b, fromNodes) - depth(a, fromNodes));
  for (const node of doomed) ops.push({ op: 'delete_node', node });

  // Add nodes missing from current, parents before children.
  const added = [...toNodes.values()].filter((n) => !fromNodes.has(n.id));
  added.sort((a, b) => depth(a, toNodes) - depth(b, toNodes));
  for (const node of added) ops.push({ op: 'add_node', node });

  // Update changed nodes (fields + position).
  for (const node of toNodes.values()) {
    const cur = fromNodes.get(node.id);
    if (!cur) continue;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['parentId', 'title', 'description', 'nodeType', 'status'] as const) {
      if (cur[key] !== node[key]) { before[key] = cur[key]; after[key] = node[key]; }
    }
    if (Object.keys(after).length > 0)
      ops.push({ op: 'update_node', id: node.id, before, after });
    if ((cur.x !== node.x || cur.y !== node.y) && node.x !== null && node.y !== null)
      ops.push({ op: 'move_node', id: node.id, before: { x: cur.x, y: cur.y }, after: { x: node.x, y: node.y } });
  }
  // Re-add edges.
  for (const edge of toEdges.values()) {
    const cur = fromEdges.get(edge.id);
    if (!cur || cur.sourceId !== edge.sourceId || cur.targetId !== edge.targetId || cur.label !== edge.label)
      ops.push({ op: 'add_edge', edge });
  }
  return ops;
}
