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

export interface GraphState {
  nodes: PlanNode[];
  edges: PlanEdge[];
  headSeq: number;
}
