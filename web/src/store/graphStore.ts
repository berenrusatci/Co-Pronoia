import { create } from 'zustand';
import type { CommitSummary, GraphState, NodeFields, NodeType, PlanEdge, PlanNode } from '@treemapper/shared';
import { api, ApiError, type CommitResult } from '../api/client';

export type ViewMode = 'flow' | 'mindmap' | 'timeline';

interface GraphStore {
  nodes: PlanNode[];
  edges: PlanEdge[];
  headSeq: number;
  commits: CommitSummary[];
  loaded: boolean;
  error: string | null;

  view: ViewMode;
  selectedNodeId: string | null;
  historyOpen: boolean;

  /** Non-null = time-travel: viewing the graph as of this commit, read-only. */
  viewingSeq: number | null;
  viewingState: GraphState | null;

  load: () => Promise<void>;
  setView: (view: ViewMode) => void;
  select: (id: string | null) => void;
  toggleHistory: () => void;
  clearError: () => void;

  addNode: (fields: { title: string; parentId?: string | null; x?: number; y?: number; nodeType?: NodeType }) => Promise<void>;
  updateNode: (id: string, fields: Partial<NodeFields>, message?: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  moveNode: (id: string, x: number, y: number) => Promise<void>;
  connect: (sourceId: string, targetId: string) => Promise<void>;
  deleteEdge: (id: string) => Promise<void>;

  viewAt: (seq: number) => Promise<void>;
  backToLatest: () => void;
  revert: (seq: number) => Promise<void>;
  restore: (seq: number) => Promise<void>;
}

function initialView(): ViewMode {
  const v = new URLSearchParams(window.location.search).get('view');
  return v === 'flow' || v === 'timeline' || v === 'mindmap' ? v : 'mindmap';
}

export const useGraphStore = create<GraphStore>((set, get) => {
  const applyResult = ({ commit, state }: CommitResult) => {
    set((s) => ({
      nodes: state.nodes,
      edges: state.edges,
      headSeq: state.headSeq,
      commits: [
        { seq: commit.seq, message: commit.message, createdAt: commit.createdAt, opSummary: summarize(commit.ops.length) },
        ...s.commits,
      ],
      viewingSeq: null,
      viewingState: null,
    }));
  };

  const summarize = (n: number) => `${n} işlem`;

  const guard = async (fn: () => Promise<void>) => {
    if (get().viewingSeq !== null) return; // read-only while time-traveling
    try {
      await fn();
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
    }
  };

  return {
    nodes: [],
    edges: [],
    headSeq: 0,
    commits: [],
    loaded: false,
    error: null,
    view: initialView(),
    selectedNodeId: null,
    historyOpen: false,
    viewingSeq: null,
    viewingState: null,

    load: async () => {
      try {
        const [state, { commits }] = await Promise.all([api.getState(), api.getCommits()]);
        set({ nodes: state.nodes, edges: state.edges, headSeq: state.headSeq, commits, loaded: true });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err), loaded: true });
      }
    },

    setView: (view) => set({ view }),
    select: (selectedNodeId) => set({ selectedNodeId }),
    toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen })),
    clearError: () => set({ error: null }),

    addNode: (fields) => guard(async () => applyResult(await api.addNode(fields))),
    updateNode: (id, fields, message) => guard(async () => applyResult(await api.updateNode(id, fields, message))),
    deleteNode: (id) =>
      guard(async () => {
        applyResult(await api.deleteNode(id));
        if (get().selectedNodeId === id) set({ selectedNodeId: null });
      }),
    moveNode: (id, x, y) => guard(async () => applyResult(await api.moveNode(id, x, y))),
    connect: (sourceId, targetId) => guard(async () => applyResult(await api.connect(sourceId, targetId))),
    deleteEdge: (id) => guard(async () => applyResult(await api.deleteEdge(id))),

    viewAt: async (seq) => {
      try {
        const viewingState = await api.getStateAt(seq);
        set({ viewingSeq: seq, viewingState, selectedNodeId: null });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    backToLatest: () => set({ viewingSeq: null, viewingState: null }),

    revert: async (seq) => {
      set({ viewingSeq: null, viewingState: null });
      try {
        applyResult(await api.revert(seq));
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    restore: async (seq) => {
      set({ viewingSeq: null, viewingState: null });
      try {
        applyResult(await api.restore(seq));
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
  };
});

/** The graph currently being displayed: live state, or historical state in time-travel mode. */
export function useDisplayedGraph(): { nodes: PlanNode[]; edges: PlanEdge[]; readOnly: boolean } {
  const nodes = useGraphStore((s) => (s.viewingState ? s.viewingState.nodes : s.nodes));
  const edges = useGraphStore((s) => (s.viewingState ? s.viewingState.edges : s.edges));
  const readOnly = useGraphStore((s) => s.viewingSeq !== null);
  return { nodes, edges, readOnly };
}
