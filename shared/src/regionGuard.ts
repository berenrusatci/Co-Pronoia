import { applyOp, type Graph } from './ops.js';
import type { Op, PlanNode, RegionInfo } from './types.js';

/**
 * Region rule over EXPANDED ops: an entity whose position lies inside a region rectangle
 * may only be changed by that region's members (canvas-owner bypass is the caller's job).
 * Edges belong to their endpoint nodes — touching an edge with an in-region endpoint counts.
 * Runs on expanded ops so delete cascades arrive as individual delete_edge/delete_node ops;
 * ops are replayed onto a scratch copy so later ops see the batch's earlier effects.
 * Nodes without coordinates (mind-map only) are outside every region.
 * Returns the Turkish error message of the first violation, or null when allowed.
 */
export function regionViolation(
  graph: Graph,
  regions: RegionInfo[],
  userId: string,
  ops: Op[],
): string | null {
  if (regions.length === 0) return null;
  const scratch: Graph = { nodes: new Map(graph.nodes), edges: new Map(graph.edges) };

  const blockingRegion = (x: number | null | undefined, y: number | null | undefined): RegionInfo | null => {
    if (x == null || y == null) return null;
    for (const r of regions) {
      const inside = x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
      if (inside && !r.memberIds.includes(userId)) return r;
    }
    return null;
  };
  const checkNode = (node: PlanNode | undefined): RegionInfo | null =>
    node ? blockingRegion(node.x, node.y) : null;
  const checkEndpoints = (sourceId: string, targetId: string): RegionInfo | null =>
    checkNode(scratch.nodes.get(sourceId)) ?? checkNode(scratch.nodes.get(targetId));

  const deny = (r: RegionInfo) => `"${r.name}" bölgesinde değişiklik yetkiniz yok`;

  for (const op of ops) {
    let violated: RegionInfo | null = null;
    switch (op.op) {
      case 'add_node':
        violated = blockingRegion(op.node.x, op.node.y);
        break;
      case 'update_node':
        violated = checkNode(scratch.nodes.get(op.id));
        break;
      case 'delete_node':
        violated = checkNode(scratch.nodes.get(op.node.id) ?? op.node);
        break;
      case 'move_node': {
        // Current position from scratch (not the op's before-snapshot) AND the destination.
        violated = checkNode(scratch.nodes.get(op.id)) ?? blockingRegion(op.after.x, op.after.y);
        break;
      }
      case 'add_edge':
        violated = checkEndpoints(op.edge.sourceId, op.edge.targetId);
        break;
      case 'delete_edge': {
        const edge = scratch.edges.get(op.edge.id) ?? op.edge;
        violated = checkEndpoints(edge.sourceId, edge.targetId);
        break;
      }
    }
    if (violated) return deny(violated);
    applyOp(scratch, op, 0);
  }
  return null;
}
