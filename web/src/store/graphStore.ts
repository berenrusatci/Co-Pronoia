import { create } from 'zustand';
import {
  summarizeOps,
  type BranchInfo, type Commit, type CommitSummary, type EdgeDirection, type EdgeKind,
  type GraphState, type NodeFields, type NodeType, type PlanEdge, type PlanNode, type ServerMessage,
} from '@treemapper/shared';
import { api, ApiError, type CommitOutcome } from '../api/client';

export type ViewMode = 'flow' | 'mindmap' | 'timeline';

interface GraphStore {
  nodes: PlanNode[];
  edges: PlanEdge[];
  headSeq: number;
  commits: CommitSummary[];
  branches: BranchInfo[];
  loaded: boolean;
  error: string | null;
  notice: string | null;

  view: ViewMode;
  selectedNodeId: string | null;
  sidePanel: 'none' | 'history' | 'connections' | 'branches';

  /** WS identity: commits we POST carry this id so our own broadcasts are skipped. */
  clientId: string | null;
  wsConnected: boolean;

  /** Time-travel (commit) or branch viewing — both read-only. */
  viewingSeq: number | null;
  viewingBranchId: string | null;
  viewingState: GraphState | null;

  load: () => Promise<void>;
  connectWs: (canvasId: string) => void;
  disconnectWs: () => void;
  /** Clears graph state when leaving a canvas (back to the dashboard). */
  reset: () => void;
  setView: (view: ViewMode) => void;
  select: (id: string | null) => void;
  togglePanel: (panel: 'history' | 'connections' | 'branches') => void;
  clearError: () => void;
  clearNotice: () => void;

  addNode: (fields: { title: string; parentId?: string | null; x?: number; y?: number; nodeType?: NodeType }) => Promise<void>;
  updateNode: (id: string, fields: Partial<NodeFields>, message?: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  moveNode: (id: string, x: number, y: number) => Promise<void>;
  connect: (sourceId: string, targetId: string, kind?: EdgeKind) => Promise<void>;
  updateEdge: (id: string, fields: { kind: EdgeKind; direction: EdgeDirection; label: string }) => Promise<void>;
  deleteEdge: (id: string) => Promise<void>;

  viewAt: (seq: number) => Promise<void>;
  viewBranch: (id: string) => Promise<void>;
  backToLatest: () => void;
  revert: (seq: number) => Promise<void>;
  restore: (seq: number) => Promise<void>;
  mergeBranch: (id: string) => Promise<void>;
  discardBranch: (id: string) => Promise<void>;
}

let ws: WebSocket | null = null;
let wsRetry: ReturnType<typeof setTimeout> | null = null;

function initialView(): ViewMode {
  const v = new URLSearchParams(window.location.search).get('view');
  return v === 'flow' || v === 'timeline' || v === 'mindmap' ? v : 'mindmap';
}

export const useGraphStore = create<GraphStore>((set, get) => {
  const toSummary = (commit: Commit): CommitSummary => ({
    seq: commit.seq,
    message: commit.message,
    createdAt: commit.createdAt,
    opSummary: summarizeOps(commit.ops),
    author: commit.author,
  });

  const applyState = (state: GraphState, commit?: Commit) => {
    set((s) => ({
      nodes: state.nodes,
      edges: state.edges,
      headSeq: state.headSeq,
      commits: commit && !s.commits.some((c) => c.seq === commit.seq) ? [toSummary(commit), ...s.commits] : s.commits,
      viewingSeq: null,
      viewingBranchId: null,
      viewingState: null,
    }));
  };

  const handleOutcome = (outcome: CommitOutcome) => {
    if (outcome.result === 'committed') {
      applyState(outcome.state, outcome.commit);
    } else {
      set((s) => ({
        branches: [outcome.branch, ...s.branches.filter((b) => b.id !== outcome.branch.id)],
        notice: `Çakışma: değişiklikleriniz '${outcome.branch.name}' dalına kaydedildi. Dallar panelinden birleştirebilir veya silebilirsiniz.`,
        sidePanel: 'branches',
      }));
    }
  };

  const guard = async (fn: () => Promise<void>) => {
    if (get().viewingSeq !== null || get().viewingBranchId !== null) return; // read-only mode
    try {
      await fn();
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
    }
  };

  const ctx = (message?: string) => ({ baseSeq: get().headSeq, clientId: get().clientId, message });

  return {
    nodes: [],
    edges: [],
    headSeq: 0,
    commits: [],
    branches: [],
    loaded: false,
    error: null,
    notice: null,
    view: initialView(),
    selectedNodeId: null,
    sidePanel: 'none',
    clientId: null,
    wsConnected: false,
    viewingSeq: null,
    viewingBranchId: null,
    viewingState: null,

    load: async () => {
      try {
        const [state, { commits }, { branches }] = await Promise.all([
          api.getState(),
          api.getCommits(),
          api.getBranches(),
        ]);
        set({ nodes: state.nodes, edges: state.edges, headSeq: state.headSeq, commits, branches, loaded: true });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err), loaded: true });
      }
    },

    connectWs: (canvasId) => {
      if (ws) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const open = () => {
        ws = new WebSocket(`${proto}://${window.location.host}/api/ws?canvas=${canvasId}`);
        ws.onopen = () => set({ wsConnected: true });
        ws.onclose = () => {
          set({ wsConnected: false, clientId: null });
          ws = null;
          wsRetry = setTimeout(() => get().connectWs(canvasId), 2000);
        };
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data) as ServerMessage;
          switch (msg.type) {
            case 'hello':
              set({ clientId: msg.clientId });
              break;
            case 'commit': {
              if (msg.clientId !== null && msg.clientId === get().clientId) break; // own commit, already applied
              if (msg.state.headSeq <= get().headSeq) break;
              set((s) => ({
                nodes: msg.state.nodes,
                edges: msg.state.edges,
                headSeq: msg.state.headSeq,
                commits: s.commits.some((c) => c.seq === msg.commit.seq) ? s.commits : [toSummary(msg.commit), ...s.commits],
              }));
              break;
            }
            case 'branch_created':
              set((s) => ({
                branches: s.branches.some((b) => b.id === msg.branch.id) ? s.branches : [msg.branch, ...s.branches],
                notice:
                  msg.clientId !== null && msg.clientId === get().clientId
                    ? s.notice
                    : `${msg.branch.createdBy} çakışan bir değişiklik gönderdi → '${msg.branch.name}' dalı oluştu.`,
              }));
              break;
            case 'branch_resolved':
              set((s) => ({ branches: s.branches.filter((b) => b.id !== msg.branchId) }));
              if (msg.commit && msg.state && msg.state.headSeq > get().headSeq) {
                set((s) => ({
                  nodes: msg.state!.nodes,
                  edges: msg.state!.edges,
                  headSeq: msg.state!.headSeq,
                  commits: s.commits.some((c) => c.seq === msg.commit!.seq) ? s.commits : [toSummary(msg.commit!), ...s.commits],
                }));
              }
              break;
          }
        };
      };
      open();
    },

    disconnectWs: () => {
      if (wsRetry) clearTimeout(wsRetry);
      wsRetry = null;
      const sock = ws;
      ws = null;
      sock?.close();
      set({ wsConnected: false, clientId: null });
    },

    reset: () =>
      set({
        nodes: [], edges: [], headSeq: 0, commits: [], branches: [], loaded: false,
        error: null, notice: null, selectedNodeId: null, sidePanel: 'none',
        viewingSeq: null, viewingBranchId: null, viewingState: null,
      }),

    setView: (view) => set({ view }),
    select: (selectedNodeId) => set({ selectedNodeId }),
    togglePanel: (panel) => set((s) => ({ sidePanel: s.sidePanel === panel ? 'none' : panel })),
    clearError: () => set({ error: null }),
    clearNotice: () => set({ notice: null }),

    addNode: (fields) => guard(async () => handleOutcome(await api.addNode(fields, ctx()))),
    updateNode: (id, fields, message) => guard(async () => handleOutcome(await api.updateNode(id, fields, ctx(message)))),
    deleteNode: (id) =>
      guard(async () => {
        handleOutcome(await api.deleteNode(id, ctx()));
        if (get().selectedNodeId === id) set({ selectedNodeId: null });
      }),
    moveNode: (id, x, y) => guard(async () => handleOutcome(await api.moveNode(id, x, y, ctx()))),
    connect: (sourceId, targetId, kind) =>
      guard(async () => handleOutcome(await api.connect({ sourceId, targetId, kind }, ctx()))),
    updateEdge: (id, fields) =>
      guard(async () => {
        const edge = get().edges.find((e) => e.id === id);
        if (!edge) return;
        handleOutcome(await api.updateEdge(id, { sourceId: edge.sourceId, targetId: edge.targetId, ...fields }, ctx()));
      }),
    deleteEdge: (id) => guard(async () => handleOutcome(await api.deleteEdge(id, ctx()))),

    viewAt: async (seq) => {
      try {
        const viewingState = await api.getStateAt(seq);
        set({ viewingSeq: seq, viewingBranchId: null, viewingState, selectedNodeId: null });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    viewBranch: async (id) => {
      try {
        const viewingState = await api.getBranchState(id);
        set({ viewingBranchId: id, viewingSeq: null, viewingState, selectedNodeId: null });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    backToLatest: () => set({ viewingSeq: null, viewingBranchId: null, viewingState: null }),

    revert: async (seq) => {
      set({ viewingSeq: null, viewingBranchId: null, viewingState: null });
      try {
        const r = await api.revert(seq, get().clientId);
        applyState(r.state, r.commit);
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    restore: async (seq) => {
      set({ viewingSeq: null, viewingBranchId: null, viewingState: null });
      try {
        const r = await api.restore(seq, get().clientId);
        applyState(r.state, r.commit);
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    mergeBranch: async (id) => {
      try {
        const r = await api.mergeBranch(id);
        set((s) => ({ branches: s.branches.filter((b) => b.id !== id) }));
        applyState(r.state, r.commit);
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    discardBranch: async (id) => {
      try {
        await api.discardBranch(id);
        set((s) => ({
          branches: s.branches.filter((b) => b.id !== id),
          viewingBranchId: s.viewingBranchId === id ? null : s.viewingBranchId,
          viewingState: s.viewingBranchId === id ? null : s.viewingState,
        }));
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
  };
});

/** The graph currently displayed: live state, or historical/branch state in read-only mode. */
export function useDisplayedGraph(): { nodes: PlanNode[]; edges: PlanEdge[]; readOnly: boolean } {
  const nodes = useGraphStore((s) => (s.viewingState ? s.viewingState.nodes : s.nodes));
  const edges = useGraphStore((s) => (s.viewingState ? s.viewingState.edges : s.edges));
  const readOnly = useGraphStore((s) => s.viewingSeq !== null || s.viewingBranchId !== null);
  return { nodes, edges, readOnly };
}
