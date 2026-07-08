import type { Commit, CommitSummary, GraphState, NodeFields, NodeType, OpInput } from '@treemapper/shared';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface CommitResult {
  commit: Commit;
  state: GraphState;
}

function postCommit(ops: OpInput[], message?: string): Promise<CommitResult> {
  return request('/api/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops, message }),
  });
}

export const api = {
  getState: () => request<GraphState>('/api/state'),
  getStateAt: (seq: number) => request<GraphState>(`/api/state-at/${seq}`),
  getCommits: (limit = 100, before?: number) =>
    request<{ commits: CommitSummary[] }>(`/api/commits?limit=${limit}${before !== undefined ? `&before=${before}` : ''}`),
  getCommit: (seq: number) => request<Commit>(`/api/commits/${seq}`),
  commit: postCommit,
  addNode: (fields: { title: string; parentId?: string | null; x?: number; y?: number; nodeType?: NodeType }, message?: string) =>
    postCommit([{ op: 'add_node', ...fields }], message),
  updateNode: (id: string, fields: Partial<NodeFields>, message?: string) =>
    postCommit([{ op: 'update_node', id, fields }], message),
  deleteNode: (id: string, message?: string) => postCommit([{ op: 'delete_node', id }], message),
  moveNode: (id: string, x: number, y: number) => postCommit([{ op: 'move_node', id, x, y }]),
  connect: (sourceId: string, targetId: string, label?: string) =>
    postCommit([{ op: 'add_edge', sourceId, targetId, label }]),
  deleteEdge: (id: string) => postCommit([{ op: 'delete_edge', id }]),
  revert: (seq: number) => request<CommitResult>(`/api/commits/${seq}/revert`, { method: 'POST' }),
  restore: (seq: number) => request<CommitResult>(`/api/commits/${seq}/restore`, { method: 'POST' }),
};
