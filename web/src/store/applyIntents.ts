import type { OpInput, PlanEdge, PlanNode } from '@treemapper/shared';

/** Client-side id for staged entities; the server keeps ids the client sends. */
export const genId = (): string => 'c' + Math.random().toString(36).slice(2, 11);

/**
 * Local preview of staged intents on top of the server state, mirroring the server's
 * expansion semantics (delete cascades subtree + incident edges). `createdCommit: 0`
 * marks entities that are not pushed yet.
 */
export function applyIntents(
  nodes: PlanNode[],
  edges: PlanEdge[],
  intents: OpInput[],
): { nodes: PlanNode[]; edges: PlanEdge[] } {
  const nmap = new Map(nodes.map((n) => [n.id, { ...n }]));
  const emap = new Map(edges.map((e) => [e.id, { ...e }]));
  for (const it of intents) {
    switch (it.op) {
      case 'add_node':
        if (!it.id) break;
        nmap.set(it.id, {
          id: it.id, parentId: it.parentId ?? null, title: it.title,
          description: it.description ?? '', nodeType: it.nodeType ?? 'task', status: it.status ?? 'planned',
          x: it.x ?? null, y: it.y ?? null, createdCommit: 0, updatedCommit: 0,
        });
        break;
      case 'update_node': {
        const n = nmap.get(it.id);
        if (n) Object.assign(n, it.fields);
        break;
      }
      case 'move_node': {
        const n = nmap.get(it.id);
        if (n) {
          n.x = it.x;
          n.y = it.y;
        }
        break;
      }
      case 'delete_node': {
        const doomed = new Set([it.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of nmap.values()) {
            if (n.parentId !== null && doomed.has(n.parentId) && !doomed.has(n.id)) {
              doomed.add(n.id);
              grew = true;
            }
          }
        }
        for (const id of doomed) nmap.delete(id);
        for (const e of [...emap.values()]) if (doomed.has(e.sourceId) || doomed.has(e.targetId)) emap.delete(e.id);
        break;
      }
      case 'add_edge':
        if (!it.id) break;
        emap.set(it.id, {
          id: it.id, sourceId: it.sourceId, targetId: it.targetId,
          kind: it.kind ?? 'flow', direction: it.direction ?? 'directed', label: it.label ?? '', createdCommit: 0,
        });
        break;
      case 'delete_edge':
        emap.delete(it.id);
        break;
    }
  }
  return { nodes: [...nmap.values()], edges: [...emap.values()] };
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
