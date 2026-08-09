import type { CanvasBriefInfo, Commit, GraphState, MemberInfo, NodeClaimInfo, PlanProposalInfo, RegionInfo } from './types.js';

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
  | { type: 'branch_resolved'; branchId: string; status: 'merged' | 'discarded'; commit?: Commit; state?: GraphState }
  /** Who is connected to this canvas right now (usernames, deduped). */
  | { type: 'presence'; users: string[] }
  | { type: 'members'; members: MemberInfo[] }
  | { type: 'regions'; regions: RegionInfo[] }
  /** Co-Pronoia öneri listesi değişti (tam liste — regions ile aynı tazeleme deseni). */
  | { type: 'proposals'; proposals: PlanProposalInfo[] }
  /** Yumuşak claim/lease listesi değişti (tam liste — regions/proposals ile aynı tazeleme deseni). */
  | { type: 'claims'; claims: NodeClaimInfo[] }
  /** Kanvas brifing dokümanı güncellendi (güncel içerik — regions ile aynı tazeleme deseni). */
  | { type: 'brief'; brief: CanvasBriefInfo }
  /** Canvas deleted by its owner (or you were removed) — drop to the dashboard. */
  | { type: 'canvas_gone'; reason: 'deleted' | 'removed' };
