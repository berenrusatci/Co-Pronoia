import { applyOp, dataEqual, normalizeData, wouldCreateCycle, type Graph } from './ops.js';
import type { Op, OpInput, PlanEdge, PlanNode } from './types.js';

/** Intent rejected before it became a commit (bad reference, cycle, …). */
export class ValidationError extends Error {}

/** Dependency-free id (crypto.randomUUID is global in Node 22 and browsers). */
const defaultId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

/** A node id and all of its descendants (parentId hierarchy). */
export function collectSubtree(graph: Graph, rootId: string): Set<string> {
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

export function depthOf(nodes: Map<string, PlanNode>, id: string): number {
  let depth = 0;
  let cur = nodes.get(id)?.parentId ?? null;
  while (cur !== null) { depth++; cur = nodes.get(cur)?.parentId ?? null; }
  return depth;
}

/**
 * Expand one client intent into full, invertible Ops against `graph` with `pending`
 * (ops already expanded from earlier intents of the same batch) applied on top.
 * Pure: fills before-snapshots and delete cascades, never touches storage.
 */
export function expand(graph: Graph, input: OpInput, pending: Op[], genId: () => string = defaultId): Op[] {
  const scratch: Graph = { nodes: new Map(graph.nodes), edges: new Map(graph.edges) };
  for (const op of pending) applyOp(scratch, op, 0);

  switch (input.op) {
    case 'add_node': {
      if (input.parentId != null && !scratch.nodes.has(input.parentId))
        throw new ValidationError(`parent ${input.parentId} does not exist`);
      const node: PlanNode = {
        id: input.id ?? genId(),
        parentId: input.parentId ?? null,
        title: input.title,
        description: input.description ?? '',
        nodeType: input.nodeType ?? 'task',
        status: input.status ?? 'planned',
        x: input.x ?? null,
        y: input.y ?? null,
        linkedCanvasId: input.linkedCanvasId ?? null,
        notes: input.notes ?? '',
        data: normalizeData(input.data),
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
        if (key === 'data') {
          // data tek alan olarak karşılaştırılır; op JSON'una kanonik biçimi yazılır.
          const next = normalizeData(value);
          if (!dataEqual(node.data, next)) { before[key] = cur; after[key] = next; }
        } else if (cur !== value) { before[key] = cur; after[key] = value; }
      }
      if (Object.keys(after).length === 0) return [];
      if ('parentId' in after && after.parentId != null && wouldCreateCycle(scratch, input.id, after.parentId as string))
        throw new ValidationError('reparenting would create a cycle');
      return [{ op: 'update_node', id: input.id, before, after }];
    }
    case 'delete_node': {
      const node = scratch.nodes.get(input.id);
      if (!node) throw new ValidationError(`node ${input.id} does not exist`);
      const subtree = collectSubtree(scratch, input.id);
      const ops: Op[] = [];
      for (const edge of scratch.edges.values())
        if (subtree.has(edge.sourceId) || subtree.has(edge.targetId))
          ops.push({ op: 'delete_edge', edge });
      const ordered = [...subtree].sort((a, b) => depthOf(scratch.nodes, b) - depthOf(scratch.nodes, a));
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
        id: input.id ?? genId(),
        sourceId: input.sourceId, targetId: input.targetId,
        kind: input.kind ?? 'flow', direction: input.direction ?? 'directed',
        label: input.label ?? '', createdCommit: 0,
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

export function expandAll(graph: Graph, inputs: OpInput[], genId?: () => string): Op[] {
  const ops: Op[] = [];
  for (const input of inputs) ops.push(...expand(graph, input, ops, genId));
  return ops;
}
