import type { Op, PlanEdge, PlanNode } from './types.js';

/** In-memory graph the ops act on. Used for replay, time-travel and tests. */
export interface Graph {
  nodes: Map<string, PlanNode>;
  edges: Map<string, PlanEdge>;
}

export function emptyGraph(): Graph {
  return { nodes: new Map(), edges: new Map() };
}

export class OpError extends Error {}

/** Apply one op to the graph, mutating it. Throws OpError if the op does not apply cleanly. */
export function applyOp(graph: Graph, op: Op, seq: number): void {
  switch (op.op) {
    case 'add_node': {
      if (graph.nodes.has(op.node.id)) throw new OpError(`add_node: node ${op.node.id} already exists`);
      if (op.node.parentId !== null && !graph.nodes.has(op.node.parentId))
        throw new OpError(`add_node: parent ${op.node.parentId} does not exist`);
      graph.nodes.set(op.node.id, { ...op.node, createdCommit: seq, updatedCommit: seq });
      break;
    }
    case 'update_node': {
      const node = graph.nodes.get(op.id);
      if (!node) throw new OpError(`update_node: node ${op.id} does not exist`);
      if ('parentId' in op.after) {
        const newParent = op.after.parentId ?? null;
        if (newParent !== null) {
          if (!graph.nodes.has(newParent)) throw new OpError(`update_node: parent ${newParent} does not exist`);
          if (wouldCreateCycle(graph, op.id, newParent))
            throw new OpError(`update_node: reparenting ${op.id} under ${newParent} would create a cycle`);
        }
      }
      graph.nodes.set(op.id, { ...node, ...op.after, updatedCommit: seq });
      break;
    }
    case 'delete_node': {
      const node = graph.nodes.get(op.node.id);
      if (!node) throw new OpError(`delete_node: node ${op.node.id} does not exist`);
      for (const other of graph.nodes.values())
        if (other.parentId === op.node.id)
          throw new OpError(`delete_node: node ${op.node.id} still has child ${other.id}`);
      for (const edge of graph.edges.values())
        if (edge.sourceId === op.node.id || edge.targetId === op.node.id)
          throw new OpError(`delete_node: node ${op.node.id} still has edge ${edge.id}`);
      graph.nodes.delete(op.node.id);
      break;
    }
    case 'move_node': {
      const node = graph.nodes.get(op.id);
      if (!node) throw new OpError(`move_node: node ${op.id} does not exist`);
      graph.nodes.set(op.id, { ...node, x: op.after.x, y: op.after.y, updatedCommit: seq });
      break;
    }
    case 'add_edge': {
      if (graph.edges.has(op.edge.id)) throw new OpError(`add_edge: edge ${op.edge.id} already exists`);
      if (!graph.nodes.has(op.edge.sourceId)) throw new OpError(`add_edge: source ${op.edge.sourceId} does not exist`);
      if (!graph.nodes.has(op.edge.targetId)) throw new OpError(`add_edge: target ${op.edge.targetId} does not exist`);
      graph.edges.set(op.edge.id, { ...op.edge, createdCommit: seq });
      break;
    }
    case 'delete_edge': {
      if (!graph.edges.has(op.edge.id)) throw new OpError(`delete_edge: edge ${op.edge.id} does not exist`);
      graph.edges.delete(op.edge.id);
      break;
    }
  }
}

/** Inverse of an op, for revert. apply(invert(op)) undoes apply(op). */
export function invertOp(op: Op): Op {
  switch (op.op) {
    case 'add_node':
      return { op: 'delete_node', node: op.node };
    case 'delete_node':
      return { op: 'add_node', node: op.node };
    case 'update_node':
      return { op: 'update_node', id: op.id, before: op.after, after: op.before };
    case 'move_node':
      // A node that was never placed (before: null) inverts to its pre-move coords or 0,0;
      // restoring x/y to null is indistinguishable from "at origin" for the flow view.
      return {
        op: 'move_node',
        id: op.id,
        before: { x: op.after.x, y: op.after.y },
        after: { x: op.before.x ?? 0, y: op.before.y ?? 0 },
      };
    case 'add_edge':
      return { op: 'delete_edge', edge: op.edge };
    case 'delete_edge':
      return { op: 'add_edge', edge: op.edge };
  }
}

/** Ops within a commit apply in order; the inverse commit applies inverses in reverse order. */
export function invertOps(ops: Op[]): Op[] {
  return [...ops].reverse().map(invertOp);
}

export function wouldCreateCycle(graph: Graph, nodeId: string, newParentId: string): boolean {
  let cur: string | null = newParentId;
  while (cur !== null) {
    if (cur === nodeId) return true;
    cur = graph.nodes.get(cur)?.parentId ?? null;
  }
  return false;
}

/** One-line human summary of a commit's ops, e.g. "+2 nodes, ~1 node, +1 edge". */
export function summarizeOps(ops: Op[]): string {
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const op of ops) {
    switch (op.op) {
      case 'add_node': bump('+node'); break;
      case 'delete_node': bump('-node'); break;
      case 'update_node': bump('~node'); break;
      case 'move_node': bump('⇢node'); break;
      case 'add_edge': bump('+edge'); break;
      case 'delete_edge': bump('-edge'); break;
    }
  }
  return [...counts.entries()]
    .map(([k, n]) => `${k.slice(0, 1)}${n} ${k.slice(1)}${n > 1 ? 's' : ''}`)
    .join(', ');
}

/** Default commit message when the user does not provide one. */
export function autoMessage(ops: Op[], titleOf: (id: string) => string | undefined): string {
  if (ops.length === 0) return 'Empty commit';
  const first = ops[0];
  const name = (id: string) => {
    const t = titleOf(id);
    return t ? `"${t}"` : id;
  };
  let head: string;
  switch (first.op) {
    case 'add_node': head = `Add node "${first.node.title}"`; break;
    case 'delete_node': head = `Delete node "${first.node.title}"`; break;
    case 'update_node': head = `Update node ${name(first.id)}`; break;
    case 'move_node': head = `Move node ${name(first.id)}`; break;
    case 'add_edge': head = `Connect ${name(first.edge.sourceId)} → ${name(first.edge.targetId)}`; break;
    case 'delete_edge': head = `Disconnect ${name(first.edge.sourceId)} → ${name(first.edge.targetId)}`; break;
  }
  return ops.length > 1 ? `${head} (+${ops.length - 1} more)` : head;
}
