import type { GraphState, OpInput, PlanNode, RegionInfo } from '@treemapper/shared';

/**
 * Region rule: a node whose position lies inside a region rectangle may only be changed
 * by that region's members (the canvas owner bypasses this in the route layer).
 * Nodes without coordinates (mind-map only) are outside every region.
 * Returns the Turkish error message of the first violation, or null when allowed.
 */
export function regionViolation(
  state: GraphState,
  regions: RegionInfo[],
  userId: string,
  inputs: OpInput[],
): string | null {
  if (regions.length === 0) return null;
  const nodes = new Map(state.nodes.map((n) => [n.id, n]));
  const edges = new Map(state.edges.map((e) => [e.id, e]));

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

  const subtreeOf = (rootId: string): PlanNode[] => {
    const ids = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of nodes.values()) {
        if (n.parentId !== null && ids.has(n.parentId) && !ids.has(n.id)) {
          ids.add(n.id);
          grew = true;
        }
      }
    }
    return [...ids].map((id) => nodes.get(id)!).filter(Boolean);
  };

  const deny = (r: RegionInfo) => `"${r.name}" bölgesinde değişiklik yetkiniz yok`;

  for (const input of inputs) {
    switch (input.op) {
      case 'add_node': {
        const r = blockingRegion(input.x, input.y);
        if (r) return deny(r);
        break;
      }
      case 'update_node': {
        const r = checkNode(nodes.get(input.id));
        if (r) return deny(r);
        break;
      }
      case 'delete_node': {
        // Deleting cascades to the whole subtree — every descendant must be reachable too.
        for (const n of subtreeOf(input.id)) {
          const r = checkNode(n);
          if (r) return deny(r);
        }
        break;
      }
      case 'move_node': {
        const from = checkNode(nodes.get(input.id));
        if (from) return deny(from);
        const to = blockingRegion(input.x, input.y);
        if (to) return deny(to);
        break;
      }
      case 'add_edge': {
        for (const id of [input.sourceId, input.targetId]) {
          const r = checkNode(nodes.get(id));
          if (r) return deny(r);
        }
        break;
      }
      case 'delete_edge': {
        const edge = edges.get(input.id);
        if (!edge) break;
        for (const id of [edge.sourceId, edge.targetId]) {
          const r = checkNode(nodes.get(id));
          if (r) return deny(r);
        }
        break;
      }
    }
  }
  return null;
}
