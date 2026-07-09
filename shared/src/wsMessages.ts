import type { Commit, GraphState } from './types.js';

export interface BranchInfo {
  id: string;
  name: string;
  baseSeq: number;
  status: string;
  createdBy: string;
  createdAt: string;
}

/** Server → client broadcast messages. Clients never send WS messages; mutations stay on HTTP. */
export type ServerMessage =
  | { type: 'hello'; clientId: string }
  | { type: 'commit'; commit: Commit; state: GraphState; clientId: string | null }
  | { type: 'branch_created'; branch: BranchInfo; clientId: string | null }
  | { type: 'branch_resolved'; branchId: string; status: 'merged' | 'discarded'; commit?: Commit; state?: GraphState };
