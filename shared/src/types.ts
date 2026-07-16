export type NodeType = 'task' | 'idea' | 'feature' | 'milestone';
export type NodeStatus = 'planned' | 'in_progress' | 'done';

export interface PlanNode {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  nodeType: NodeType;
  status: NodeStatus;
  x: number | null;
  y: number | null;
  createdCommit: number;
  updatedCommit: number;
}

export type EdgeKind = 'flow' | 'loop' | 'dependency' | 'relation';
export type EdgeDirection = 'directed' | 'bidirectional';

export interface PlanEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  direction: EdgeDirection;
  label: string;
  createdCommit: number;
}

/** Mutable node fields an update_node op may touch. */
export interface NodeFields {
  parentId: string | null;
  title: string;
  description: string;
  nodeType: NodeType;
  status: NodeStatus;
}

export type Op =
  | { op: 'add_node'; node: PlanNode }
  | { op: 'update_node'; id: string; before: Partial<NodeFields>; after: Partial<NodeFields> }
  | { op: 'delete_node'; node: PlanNode }
  | { op: 'move_node'; id: string; before: { x: number | null; y: number | null }; after: { x: number; y: number } }
  | { op: 'add_edge'; edge: PlanEdge }
  | { op: 'delete_edge'; edge: PlanEdge };

/** Client-side intent: the server expands these into full Ops (fills before-fields, cascades). */
export type OpInput =
  | { op: 'add_node'; id?: string; parentId?: string | null; title: string; description?: string; nodeType?: NodeType; status?: NodeStatus; x?: number | null; y?: number | null }
  | { op: 'update_node'; id: string; fields: Partial<NodeFields> }
  | { op: 'delete_node'; id: string }
  | { op: 'move_node'; id: string; x: number; y: number }
  | { op: 'add_edge'; id?: string; sourceId: string; targetId: string; label?: string; kind?: EdgeKind; direction?: EdgeDirection }
  | { op: 'delete_edge'; id: string };

export interface Commit {
  seq: number;
  message: string;
  createdAt: string;
  ops: Op[];
  author: string | null;
  branchId?: string | null;
}

export interface CommitSummary {
  seq: number;
  message: string;
  createdAt: string;
  opSummary: string;
  author: string | null;
}

/** owner: tek kişi, her şeyi yapar · editor: grafiği düzenler · viewer: salt okunur */
export type CanvasRole = 'owner' | 'editor' | 'viewer';

export interface CanvasInfo {
  id: string;
  name: string;
  owner: string;
  role: CanvasRole;
  memberCount: number;
  headSeq: number;
  createdAt: string;
  groupId: string | null;
  groupName: string | null;
}

/** admin: onaylar + davet gönderir · member: yetkileri atanmış özel rolünden (GroupRoleDefInfo) gelir */
export type GroupRole = 'admin' | 'member';
export type GroupMemberStatus = 'pending' | 'approved';
/** Rolün bir grup kanvasına erişim düzeyi. */
export type CanvasAccess = 'none' | 'view' | 'edit';

/** Grup kurucusunun/yetkilinin tanımladığı özel rol ve yetkileri. */
export interface GroupRoleDefInfo {
  id: string;
  name: string;
  canManageMembers: boolean;
  canManageRoles: boolean;
  canCreateCanvas: boolean;
  defaultCanvasAccess: CanvasAccess;
}

export interface GroupInfo {
  id: string;
  name: string;
  myRole: GroupRole;
  myStatus: GroupMemberStatus;
  memberCount: number;
  pendingCount: number;
  canvasCount: number;
  createdAt: string;
}

export interface GroupMemberInfo {
  userId: string;
  username: string;
  role: GroupRole;
  status: GroupMemberStatus;
  jobTitle: string | null;
  roleDefId: string | null;
  roleDefName: string | null;
  requestedAt: string;
}

export interface MemberInfo {
  userId: string;
  username: string;
  role: CanvasRole;
  joinedAt: string;
}

/** Owner-defined rectangle: only its members (and the owner) may change nodes inside it.
 * memberIds, doğrudan atanan kullanıcılar ile bölgeye erişimli rollerin üyelerinin
 * birleşimi olarak server tarafında genişletilmiş gelir — regionGuard yalnızca bunu okur. */
export interface RegionInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** Owner-written note about the region; the AI agent uses it as context for work inside the region. */
  description: string;
  /** When false, the built-in AI agent may not touch nodes inside this region (independent of user membership). */
  aiAllowed: boolean;
  memberIds: string[];
  memberNames: string[];
  /** Yalnızca doğrudan atanan kullanıcılar (yönetim UI'ının checkbox durumu; memberIds bunun üst kümesi). */
  directMemberIds: string[];
  /** Bölgeye erişimi olan grup rolü id'leri (yönetim UI'ı için; enforcement memberIds üzerinden). */
  roleIds: string[];
}

export interface GraphState {
  nodes: PlanNode[];
  edges: PlanEdge[];
  headSeq: number;
}

// ---------- Site yönetim paneli (yalnızca isAdmin kullanıcılar) ----------

export interface AdminStats {
  userCount: number;
  canvasCount: number;
  groupCount: number;
  commitCount: number;
  /** expiresAt > şimdi olan oturum sayısı. */
  activeSessionCount: number;
  /** Son 7 günde kayıt olan kullanıcı sayısı. */
  newUsers7d: number;
}

export interface AdminUserInfo {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  createdAt: string;
  ownedCanvasCount: number;
  membershipCount: number;
  groupCount: number;
  sessionCount: number;
  lastCommitAt: string | null;
}

export interface AdminCanvasInfo {
  id: string;
  name: string;
  ownerId: string;
  owner: string;
  memberCount: number;
  commitCount: number;
  groupId: string | null;
  groupName: string | null;
  createdAt: string;
}

export interface AdminGroupInfo {
  id: string;
  name: string;
  memberCount: number;
  pendingCount: number;
  canvasCount: number;
  createdAt: string;
}
