import type {
  AdminCanvasInfo, AdminGroupInfo, AdminStats, AdminUserInfo,
  BranchInfo, CanvasAccess, CanvasInfo, CanvasPreview, Commit, CommitSummary, EdgeDirection, EdgeKind,
  GraphState, GroupInfo, GroupMemberInfo, GroupRole, GroupRoleDefInfo, MemberInfo, NodeFields, NodeType,
  OpInput, RegionInfo, SiteAppearance,
} from '@treemapper/shared';

export interface RoleDefInput {
  name: string;
  canManageMembers?: boolean;
  canManageRoles?: boolean;
  canCreateCanvas?: boolean;
  defaultCanvasAccess?: CanvasAccess;
}

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

export type CommitResult = { result: 'committed'; commit: Commit; state: GraphState; droppedMoves?: number };
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

export interface AgentResponse {
  reply: string;
  committed: boolean;
  commitSeq?: number;
  opCount?: number;
  branched?: boolean;
  branch?: string;
  error?: string;
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
  createRegion: (data: { name: string; x: number; y: number; width: number; height: number; color?: string; description?: string; aiAllowed?: boolean }) =>
    post<{ region: RegionInfo }>(`${base()}/regions`, data),
  updateRegion: (id: string, data: Partial<{ name: string; x: number; y: number; width: number; height: number; color: string; description: string; aiAllowed: boolean }>) =>
    patch<{ region: RegionInfo }>(`${base()}/regions/${id}`, data),
  deleteRegion: (id: string) => del<{ ok: boolean }>(`${base()}/regions/${id}`),
  setRegionMembers: (id: string, userIds: string[], roleIds?: string[]) =>
    put<{ region: RegionInfo }>(`${base()}/regions/${id}/members`, { userIds, ...(roleIds !== undefined ? { roleIds } : {}) }),

  agent: (
    prompt: string,
    detail: 'proto' | 'detailed' = 'proto',
    selectedIds: string[] = [],
    selectedRegionIds: string[] = [],
    stepwise = false,
  ) => post<AgentResponse>(`${base()}/agent`, { prompt, detail, stepwise, selectedIds, selectedRegionIds }),
};

/** Dashboard-level endpoints (not canvas-scoped). */
export const canvasApi = {
  list: () => request<{ canvases: CanvasInfo[] }>('/api/canvases'),
  create: (name: string, groupId: string) => post<{ canvas: CanvasInfo }>('/api/canvases', { name, groupId }),
  /** Bağlı-kanvas kartının mini haritası; aktif olmayan kanvaslar için de çalışır (düz URL). */
  preview: (canvasId: string) => request<{ preview: CanvasPreview }>(`/api/canvases/${canvasId}/preview`),
  /** Bağlı kanvası panoya uğramadan açabilmek için CanvasInfo. */
  info: (canvasId: string) => request<{ canvas: CanvasInfo }>(`/api/canvases/${canvasId}/info`),
  createInvite: (canvasId: string) => post<{ token: string }>(`/api/canvases/${canvasId}/invites`),
  inviteInfo: (token: string) =>
    request<{ canvasName: string; invitedBy: string }>(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => post<{ canvas: CanvasInfo }>(`/api/invites/${encodeURIComponent(token)}/accept`),
  deleteCanvas: (canvasId: string) => del<{ ok: boolean }>(`/api/canvases/${canvasId}`),
  setRoleAccess: (canvasId: string, roleId: string, access: CanvasAccess | null) =>
    put<{ ok: boolean }>(`/api/canvases/${canvasId}/role-access`, { roleId, access }),
  getRoleAccess: (canvasId: string) =>
    request<{ access: { roleId: string; access: CanvasAccess }[] }>(`/api/canvases/${canvasId}/role-access`),
  changePassword: (current: string, next: string) => post<{ ok: boolean }>('/api/auth/password', { current, next }),
};

/** Dashboard-level group endpoints. */
export const groupApi = {
  list: () => request<{ groups: GroupInfo[] }>('/api/groups'),
  create: (name: string, roles?: RoleDefInput[]) => post<{ group: GroupInfo }>('/api/groups', { name, roles }),
  roles: (groupId: string) => request<{ roles: GroupRoleDefInfo[] }>(`/api/groups/${groupId}/roles`),
  createRole: (groupId: string, role: RoleDefInput) =>
    post<{ role: GroupRoleDefInfo }>(`/api/groups/${groupId}/roles`, role),
  updateRole: (groupId: string, roleId: string, role: Partial<RoleDefInput>) =>
    patch<{ role: GroupRoleDefInfo }>(`/api/groups/${groupId}/roles/${roleId}`, role),
  deleteRole: (groupId: string, roleId: string) => del<{ ok: boolean }>(`/api/groups/${groupId}/roles/${roleId}`),
  setMemberRoleDef: (groupId: string, userId: string, roleDefId: string | null) =>
    patch<{ members: GroupMemberInfo[] }>(`/api/groups/${groupId}/members/${userId}`, { roleDefId }),
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

/** Site yönetim paneli uçları (yalnızca isAdmin kullanıcılar; sunucu 403 ile korur). */
/** Oturum gerektirmeyen site uçları — giriş ekranı bunları açılışta okur. */
export const siteApi = {
  appearance: () => request<{ appearance: SiteAppearance }>('/api/site/appearance'),
};

export const adminApi = {
  stats: () => request<{ stats: AdminStats }>('/api/admin/stats'),
  setLoginPreview: (body: { dataUrl: string } | { url: string }) =>
    put<{ ok: boolean }>('/api/admin/appearance/login-preview', body),
  clearLoginPreview: () => del<{ ok: boolean }>('/api/admin/appearance/login-preview'),
  users: (q = '') =>
    request<{ users: AdminUserInfo[] }>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  setUserAdmin: (userId: string, isAdmin: boolean) =>
    patch<{ ok: boolean }>(`/api/admin/users/${userId}`, { isAdmin }),
  setUserPassword: (userId: string, password: string) =>
    post<{ ok: boolean }>(`/api/admin/users/${userId}/password`, { password }),
  revokeSessions: (userId: string) => del<{ ok: boolean; deleted: number }>(`/api/admin/users/${userId}/sessions`),
  deleteUser: (userId: string) => del<{ ok: boolean }>(`/api/admin/users/${userId}`),
  canvases: (q = '') =>
    request<{ canvases: AdminCanvasInfo[] }>(`/api/admin/canvases${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  deleteCanvas: (canvasId: string) => del<{ ok: boolean }>(`/api/admin/canvases/${canvasId}`),
  canvasMembers: (canvasId: string) =>
    request<{ members: MemberInfo[] }>(`/api/admin/canvases/${canvasId}/members`),
  setCanvasMemberRole: (canvasId: string, userId: string, role: 'editor' | 'viewer') =>
    patch<{ members: MemberInfo[] }>(`/api/admin/canvases/${canvasId}/members/${userId}`, { role }),
  removeCanvasMember: (canvasId: string, userId: string) =>
    del<{ members: MemberInfo[] }>(`/api/admin/canvases/${canvasId}/members/${userId}`),
  revokeCanvasInvites: (canvasId: string) =>
    del<{ ok: boolean; deleted: number }>(`/api/admin/canvases/${canvasId}/invites`),
  groups: (q = '') =>
    request<{ groups: AdminGroupInfo[] }>(`/api/admin/groups${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  deleteGroup: (groupId: string) => del<{ ok: boolean }>(`/api/admin/groups/${groupId}`),
  groupMembers: (groupId: string) =>
    request<{ members: GroupMemberInfo[] }>(`/api/admin/groups/${groupId}/members`),
  approveGroupMember: (groupId: string, userId: string) =>
    patch<{ members: GroupMemberInfo[] }>(`/api/admin/groups/${groupId}/members/${userId}`, { status: 'approved' }),
  setGroupMemberRole: (groupId: string, userId: string, role: GroupRole) =>
    patch<{ members: GroupMemberInfo[] }>(`/api/admin/groups/${groupId}/members/${userId}`, { role }),
  removeGroupMember: (groupId: string, userId: string) =>
    del<{ members: GroupMemberInfo[] }>(`/api/admin/groups/${groupId}/members/${userId}`),
};
