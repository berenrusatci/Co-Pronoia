import { hierarchy, tree } from 'd3-hierarchy';
import type { PlanNode } from '@treemapper/shared';

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

/**
 * Horizontal tidy-tree layout from parentId links. Computed on the fly,
 * never persisted — flow-view coordinates are untouched.
 * Orphan roots (multiple parentless nodes) are stacked vertically.
 */
export function computeMindmapLayout(nodes: PlanNode[]): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return { positions };

  const byParent = new Map<string | null, PlanNode[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    // A parent outside the visible set (shouldn't happen, but be safe) makes the node a root.
    const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(node);
    byParent.set(parent, list);
  }

  const roots = byParent.get(null) ?? [];
  let yOffset = 0;
  for (const root of roots) {
    interface TreeDatum { id: string; children?: TreeDatum[] }
    const build = (node: PlanNode): TreeDatum => ({
      id: node.id,
      children: (byParent.get(node.id) ?? []).map(build),
    });
    const h = hierarchy(build(root));
    const nodeH = 70;
    const nodeW = 260;
    const layout = tree<TreeDatum>().nodeSize([nodeH, nodeW]);
    const laid = layout(h);
    let minX = Infinity;
    let maxX = -Infinity;
    laid.each((d) => {
      minX = Math.min(minX, d.x);
      maxX = Math.max(maxX, d.x);
    });
    laid.each((d) => {
      // d3 tree: x = cross-axis, y = depth. Render depth left→right.
      positions.set(d.data.id, { x: d.y, y: d.x - minX + yOffset });
    });
    yOffset += maxX - minX + nodeH * 2;
  }
  return { positions };
}
