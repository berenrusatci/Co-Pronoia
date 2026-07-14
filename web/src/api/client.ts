import type {
  BranchInfo, CanvasInfo, Commit, CommitSummary, EdgeDirection, EdgeKind, GraphState,
  GroupInfo, GroupMemberInfo, GroupRole, MemberInfo, NodeFields, NodeType, OpInput, RegionInfo,
} from '@treemapper/shared';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Set by App: called on any 401 so the auth store can drop the session. */
export let onUnauthorized: () => void = () => {};
export function setOnUnauthorized(fn: () => void): void {
  onUnauthorized = fn;
}

/** All graph endpoints live under the active canvas; the dashboard sets this before loading. */
let activeCanvasId: string | null = null;
export function setActiveCanvasId(id: string | null): void {
  activeCanvasId = id;
}
function base(): string {
  if (!activeCanvasId) throw new ApiError(0, 'aktif kanvas yok');
  return `/api/canvases/${activeCanvasId}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

function withBody<T>(method: string) {
  return (url: string, body?: unknown): Promise<T> =>
    request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
}
const post = <T>(url: string, body?: unknown) => withBody<T>('POST')(url, body);
const patch = <T>(url: string, body?: unknown) => withBody<T>('PATCH')(url, body);
const put = <T>(url: string, body?: unknown) => withBody<T>('PUT')(url, body);
const del = <T>(url: string) => request<T>(url, { method: 'DELETE' });

export type CommitResult = { result: 'committed'; commit: Commit; state: GraphState };
export type BranchedResult = { result: 'branched'; branch: BranchInfo; commit: Commit };
export type CommitOutcome = CommitResult | BranchedResult;

export interface CommitContext {
  baseSeq: number;
  clientId: string | null;
  message?: string;
}

function postCommit(ops: OpInput[], ctx: CommitContext): Promise<CommitOutcome> {
  return post(`${base()}/commit`, { ops, message: ctx.message, baseSeq: ctx.baseSeq, clientId: ctx.clientId });
}

export interface EdgeFields {
  sourceId: string;
  targetId: string;
  kind?: EdgeKind;
  direction?: EdgeDirection;
  label?: string;
}

export const api = {
  getState: () => request<GraphState>(`${base()}/state`),
  getStateAt: (seq: number) => request<GraphState>(`${base()}/state-at/${seq}`),
  getCommits: (limit = 100, before?: number) =>
    request<{ commits: CommitSummary[] }>(`${base()}/commits?limit=${limit}${before !== undefined ? `&before=${before}` : ''}`),
  getCommit: (seq: number) => request<Commit>(`${base()}/commits/${seq}`),

  commit: postCommit,
  addNode: (fields: { title: string; parentId?: string | null; x?: number; y?: number; nodeType?: NodeType }, ctx: CommitContext) =>
    postCommit([{ op: 'add_node', ...fields }], ctx),
  updateNode: (id: string, fields: Partial<NodeFields>, ctx: CommitContext) =>
    postCommit([{ op: 'update_node', id, fields }], ctx),
  deleteNode: (id: string, ctx: CommitContext) => postCommit([{ op: 'delete_node', id }], ctx),
  moveNode: (id: string, x: number, y: number, ctx: CommitContext) => postCommit([{ op: 'move_node', id, x, y }], ctx),
  connect: (fields: EdgeFields, ctx: CommitContext) => postCommit([{ op: 'add_edge', ...fields }], ctx),
  deleteEdge: (id: string, ctx: CommitContext) => postCommit([{ op: 'delete_edge', id }], ctx),
  /** Edge edit = delete + re-add with the same id in one commit. */
  updateEdge: (id: string, fields: EdgeFields, ctx: CommitContext) =>
    postCommit([{ op: 'delete_edge', id }, { op: 'add_edge', id, ...fields }], ctx),

  revert: (seq: number, clientId: string | null) => post<CommitResult>(`${base()}/commits/${seq}/revert`, { clientId }),
  restore: (seq: number, clientId: string | null) => post<CommitResult>(`${base()}/commits/${seq}/restore`, { clientId }),

  getBranches: () => request<{ branches: BranchInfo[] }>(`${base()}/branches`),
  getBranchState: (id: string) => request<GraphState>(`${base()}/branches/${id}/state`),
  mergeBranch: (id: string) => post<{ commit: Commit; state: GraphState }>(`${base()}/branches/${id}/merge`),
  discardBranch: (id: string) => post<{ branch: BranchInfo }>(`${base()}/branches/${id}/discard`),

  getMembers: () => request<{ members: MemberInfo[] }>(`${base()}/members`),
  setMemberRole: (userId: string, role: 'editor' | 'viewer') =>
    patch<{ members: MemberInfo[] }>(`${base()}/members/${userId}`, { role }),
  removeMember: (userId: string) => del<{ members: MemberInfo[] }>(`${base()}/members/${userId}`),

  getRegions: () => request<{ regions: RegionInfo[] }>(`${base()}/regions`),
  createRegion: (data: { name: string; x: number; y: number; width: number; height: number; color?: string }) =>
    post<{ region: RegionInfo }>(`${base()}/regions`, data),
  updateRegion: (id: string, data: Partial<{ name: string; x: number; y: number; width: number; height: number; color: string }>) =>
    patch<{ region: RegionInfo }>(`${base()}/regions/${id}`, data),
  deleteRegion: (id: string) => del<{ ok: boolean }>(`${base()}/regions/${id}`),
  setRegionMembers: (id: string, userIds: string[]) =>
    put<{ region: RegionInfo }>(`${base()}/regions/${id}/members`, { userIds }),
};

/** Dashboard-level endpoints (not canvas-scoped). */
export const canvasApi = {
  list: () => request<{ canvases: CanvasInfo[] }>('/api/canvases'),
  create: (name: string, groupId?: string) => post<{ canvas: CanvasInfo }>('/api/canvases', { name, groupId }),
  createInvite: (canvasId: string) => post<{ token: string }>(`/api/canvases/${canvasId}/invites`),
  inviteInfo: (token: string) =>
    request<{ canvasName: string; invitedBy: string }>(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => post<{ canvas: CanvasInfo }>(`/api/invites/${encodeURIComponent(token)}/accept`),
  deleteCanvas: (canvasId: string) => del<{ ok: boolean }>(`/api/canvases/${canvasId}`),
  changePassword: (current: string, next: string) => post<{ ok: boolean }>('/api/auth/password', { current, next }),
};

/** Dashboard-level group endpoints. */
export const groupApi = {
  list: () => request<{ groups: GroupInfo[] }>('/api/groups'),
  create: (name: string) => post<{ group: GroupInfo }>('/api/groups', { name }),
  members: (groupId: string) => request<{ members: GroupMemberInfo[] }>(`/api/groups/${groupId}/members`),
  approveMember: (groupId: string, userId: string) =>
    patch<{ members: GroupMemberInfo[] }>(`/api/groups/${groupId}/members/${userId}`, { status: 'approved' }),
  setMemberRole: (groupId: string, userId: string, role: GroupRole) =>
    patch<{ members: GroupMemberInfo[] }>(`/api/groups/${groupId}/members/${userId}`, { role }),
  removeMember: (groupId: string, userId: string) =>
    del<{ members: GroupMemberInfo[] }>(`/api/groups/${groupId}/members/${userId}`),
  createInvite: (groupId: string) => post<{ token: string }>(`/api/groups/${groupId}/invites`),
  inviteInfo: (token: string) =>
    request<{ groupName: string; invitedBy: string }>(`/api/group-invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, jobTitle: string) =>
    post<{ group: GroupInfo }>(`/api/group-invites/${encodeURIComponent(token)}/accept`, { jobTitle }),
};
