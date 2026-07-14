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

/** admin: onaylar + davet gönderir · member: onaylandıktan sonra grubun kanvaslarına editör erişimi olur */
export type GroupRole = 'admin' | 'member';
export type GroupMemberStatus = 'pending' | 'approved';

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
  requestedAt: string;
}

export interface MemberInfo {
  userId: string;
  username: string;
  role: CanvasRole;
  joinedAt: string;
}

/** Owner-defined rectangle: only its members (and the owner) may change nodes inside it. */
export interface RegionInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  memberIds: string[];
  memberNames: string[];
}

export interface GraphState {
  nodes: PlanNode[];
  edges: PlanEdge[];
  headSeq: number;
}
