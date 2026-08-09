import { applyOp, expand, type Graph, type OpInput, type PlanEdge, type PlanNode } from '@co-pronoia/shared';

/** Client-side id for staged entities; the server keeps ids the client sends. */
export const genId = (): string => 'c' + Math.random().toString(36).slice(2, 11);

export function toGraph(nodes: PlanNode[], edges: PlanEdge[]): Graph {
  return { nodes: new Map(nodes.map((n) => [n.id, n])), edges: new Map(edges.map((e) => [e.id, e])) };
}

/**
 * Local preview of staged intents on top of the server state, using the same shared
 * expansion the server commits with. Seq 0 marks entities that are not pushed yet
 * ("yeni" badge). Lenient on purpose: a WS commit can invalidate a staged intent
 * (e.g. someone deleted the node it edits) — such intents are skipped in the preview
 * and the server re-validates everything on push.
 */
export function applyIntents(
  nodes: PlanNode[],
  edges: PlanEdge[],
  intents: OpInput[],
): { nodes: PlanNode[]; edges: PlanEdge[] } {
  const graph = toGraph(nodes, edges);
  for (const it of intents) {
    try {
      for (const op of expand(graph, it, [], genId)) applyOp(graph, op, 0);
    } catch {
      // stale intent — skip
    }
  }
  return { nodes: [...graph.nodes.values()], edges: [...graph.edges.values()] };
}

/** Appends an intent, collapsing repeat moves/updates of the same node into one entry. */
export function pushIntent(pending: OpInput[], it: OpInput): OpInput[] {
  if (it.op === 'move_node') {
    return [...pending.filter((p) => !(p.op === 'move_node' && p.id === it.id)), it];
  }
  if (it.op === 'update_node') {
    const last = pending[pending.length - 1];
    if (last && last.op === 'update_node' && last.id === it.id) {
      return [...pending.slice(0, -1), { op: 'update_node', id: it.id, fields: { ...last.fields, ...it.fields } }];
    }
  }
  return [...pending, it];
}
