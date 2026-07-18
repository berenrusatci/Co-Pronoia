import { create } from 'zustand';
import {
  expandAll, regionViolation, summarizeOps,
  type BranchInfo, type Commit, type CommitSummary, type EdgeDirection, type EdgeKind,
  type GraphState, type MemberInfo, type NodeFields, type NodeType, type OpInput,
  type PlanEdge, type PlanNode, type PlanProposalInfo, type RegionInfo, type ServerMessage,
} from '@treemapper/shared';
import { api, ApiError, type CommitOutcome } from '../api/client';
import { applyIntents, genId, pushIntent, toGraph } from './applyIntents';
import { useCanvasStore } from './canvasStore';
import { useAuthStore } from './authStore';

export type ViewMode = 'flow' | 'mindmap' | 'timeline';

export interface AgentChatEntry {
  who: 'user' | 'agent';
  text: string;
  /** Ajan yanıtı bir commit attıysa numarası; dala düştüyse branched. */
  commitSeq?: number;
  branched?: boolean;
  isError?: boolean;
}

interface GraphStore {
  /** Canonical state from the server (pushed commits only). */
  serverNodes: PlanNode[];
  serverEdges: PlanEdge[];
  /** Preview = server state + pending intents. Every view reads these. */
  nodes: PlanNode[];
  edges: PlanEdge[];
  /** Staged intents; nothing hits the DB or the timeline until push(). */
  pending: OpInput[];
  headSeq: number;
  commits: CommitSummary[];
  branches: BranchInfo[];
  members: MemberInfo[];
  regions: RegionInfo[];
  /** Co-Pronoia ajan önerileri (yalnızca co-pronoia kanvaslarında yüklenir; WS ile canlı). */
  proposals: PlanProposalInfo[];
  /** Usernames connected to this canvas right now (WS presence). */
  activeUsers: string[];
  loaded: boolean;
  error: string | null;
  notice: string | null;

  view: ViewMode;
  selectedNodeId: string | null;
  /** Çoklu seçim (Ctrl/Shift+tık): ajan komutlarına bağlam olarak gider. */
  selectedNodeIds: string[];
  /** Ctrl/Shift+tık ile seçilen bölgeler: ajana açıklamaları ve içlerindeki düğümler bağlam olarak gider. */
  selectedRegionIds: string[];
  sidePanel: 'none' | 'history' | 'connections' | 'branches' | 'members' | 'regions' | 'agent' | 'copronoia';

  /** Ajan paneli sohbeti; panel kapansa da kanvastan çıkana dek korunur. */
  agentLog: AgentChatEntry[];
  agentBusy: boolean;
  /** Çizim ayrıntısı: proto = hızlı iskelet (3-6 düğüm), detailed = kapsamlı döküm. Modeli bu seçer. */
  agentDetail: 'proto' | 'detailed';
  setAgentDetail: (detail: 'proto' | 'detailed') => void;
  /** Parça parça üretim (detay düzeyiyle birleşir): her parça ayrı istek + ayrı commit, canlı belirir. */
  agentStepwise: boolean;
  setAgentStepwise: (stepwise: boolean) => void;
  /** PDF dışa aktarma sürüyor: kartlar/bölgeler açıklamalarını gösterir, zihin haritası ferah dizilir. */
  exporting: boolean;
  setExporting: (exporting: boolean) => void;
  /** Ctrl+tık seçiminde solda açılan açıklama paneli. */
  selectionInfoOpen: boolean;
  setSelectionInfoOpen: (open: boolean) => void;
  askAgent: (prompt: string) => Promise<void>;

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
  /** Ctrl/Shift+tık: düğümü çoklu seçime ekler/çıkarır. */
  toggleSelect: (id: string) => void;
  /** Ctrl/Shift+tık: bölgeyi ajan bağlam seçimine ekler/çıkarır. */
  toggleSelectRegion: (id: string) => void;
  togglePanel: (panel: 'history' | 'connections' | 'branches' | 'members' | 'regions' | 'agent' | 'copronoia') => void;
  /** Sahip temizliği: bekleyen bir öneriyi reddeder (onay yalnızca süpervizör ajanla olur). */
  rejectProposal: (id: string) => Promise<void>;
  clearError: () => void;
  clearNotice: () => void;

  // Staged mutations (local only until push)
  addNode: (fields: { title: string; parentId?: string | null; x?: number; y?: number; nodeType?: NodeType }) => void;
  updateNode: (id: string, fields: Partial<NodeFields>) => void;
  deleteNode: (id: string) => void;
  moveNode: (id: string, x: number, y: number) => void;
  connect: (sourceId: string, targetId: string, kind?: EdgeKind) => void;
  updateEdge: (id: string, fields: { kind: EdgeKind; direction: EdgeDirection; label: string }) => void;
  deleteEdge: (id: string) => void;
  /** Sends everything staged as ONE commit. */
  push: () => Promise<void>;
  discardPending: () => void;

  viewAt: (seq: number) => Promise<void>;
  viewBranch: (id: string) => Promise<void>;
  backToLatest: () => void;
  revert: (seq: number) => Promise<void>;
  restore: (seq: number) => Promise<void>;
  mergeBranch: (id: string) => Promise<void>;
  discardBranch: (id: string) => Promise<void>;

  // Owner tools
  setMemberRole: (userId: string, role: 'editor' | 'viewer') => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  createRegion: (data: { name: string; x: number; y: number; width: number; height: number; color?: string; description?: string; aiAllowed?: boolean }) => Promise<void>;
  updateRegion: (id: string, data: Partial<{ name: string; x: number; y: number; width: number; height: number; color: string; description: string; aiAllowed: boolean }>) => Promise<void>;
  deleteRegion: (id: string) => Promise<void>;
  setRegionMembers: (id: string, userIds: string[], roleIds?: string[]) => Promise<void>;
}

let ws: WebSocket | null = null;
let wsRetry: ReturnType<typeof setTimeout> | null = null;
/** Incremented on every (re)connect/disconnect so a stale socket's onclose can't schedule a rogue retry. */
let wsGen = 0;

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

  /** Recompute the preview after server state or pending changed. */
  const withPreview = (s: { serverNodes: PlanNode[]; serverEdges: PlanEdge[] }, pending: OpInput[]) => {
    const preview = applyIntents(s.serverNodes, s.serverEdges, pending);
    return { pending, nodes: preview.nodes, edges: preview.edges };
  };

  /** New canonical state from the server (HTTP response or WS broadcast) + preview recompute. */
  const withServerState = (s: { pending: OpInput[]; commits: CommitSummary[] }, state: GraphState, commit?: Commit) => ({
    serverNodes: state.nodes,
    serverEdges: state.edges,
    ...withPreview({ serverNodes: state.nodes, serverEdges: state.edges }, s.pending),
    headSeq: state.headSeq,
    commits: commit && !s.commits.some((c) => c.seq === commit.seq) ? [toSummary(commit), ...s.commits] : s.commits,
  });

  const applyState = (state: GraphState, commit?: Commit) => {
    set((s) => ({
      ...withServerState(s, state, commit),
      viewingSeq: null,
      viewingBranchId: null,
      viewingState: null,
    }));
  };

  const handleOutcome = (outcome: CommitOutcome) => {
    if (outcome.result === 'committed') {
      applyState(outcome.state, outcome.commit);
      if (outcome.droppedMoves) {
        set({
          notice: `${outcome.droppedMoves} konum değişikliğiniz uygulanmadı — o düğümler ana hatta zaten taşınmıştı (ana hat esas alındı).`,
        });
      }
    } else {
      set((s) => ({
        branches: [outcome.branch, ...s.branches.filter((b) => b.id !== outcome.branch.id)],
        notice: `Çakışma: değişiklikleriniz '${outcome.branch.name}' dalına kaydedildi. Dallar panelinden birleştirebilir veya silebilirsiniz.`,
        sidePanel: 'branches',
      }));
    }
  };

  const isViewer = () => useCanvasStore.getState().active?.role === 'viewer';

  /** Staged mutations: read-only in time-travel/branch view and for viewers. */
  const stage = (intents: OpInput[]) => {
    if (get().viewingSeq !== null || get().viewingBranchId !== null) return;
    if (isViewer()) {
      set({ error: 'Görüntüleyici rolündesiniz — değişiklik yapamazsınız.' });
      return;
    }
    // Region feedback at staging time, with the same shared check the server enforces
    // on push. Advisory only — the server stays authoritative.
    const { nodes, edges, regions } = get();
    const me = useAuthStore.getState().user;
    if (regions.length > 0 && me && useCanvasStore.getState().active?.role !== 'owner') {
      try {
        const graph = toGraph(nodes, edges);
        const violation = regionViolation(graph, regions, me.id, expandAll(graph, intents, genId));
        if (violation) {
          set({ error: violation });
          return;
        }
      } catch {
        // expansion failed against the preview — stage anyway; push surfaces the real error
      }
    }
    set((s) => {
      let pending = s.pending;
      for (const it of intents) pending = pushIntent(pending, it);
      return withPreview(s, pending);
    });
  };

  /** Direct server ops (revert/restore/merge…) are blocked while changes are staged. */
  const direct = async (fn: () => Promise<void>) => {
    if (get().viewingSeq === null && get().viewingBranchId === null && isViewer()) {
      set({ error: 'Görüntüleyici rolündesiniz — değişiklik yapamazsınız.' });
      return;
    }
    if (get().pending.length > 0) {
      set({ error: 'Bekleyen değişiklikleriniz var — önce Push edin veya vazgeçin.' });
      return;
    }
    try {
      await fn();
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
    }
  };

  return {
    serverNodes: [],
    serverEdges: [],
    nodes: [],
    edges: [],
    pending: [],
    headSeq: 0,
    commits: [],
    branches: [],
    members: [],
    regions: [],
    proposals: [],
    activeUsers: [],
    loaded: false,
    error: null,
    notice: null,
    view: initialView(),
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedRegionIds: [],
    sidePanel: 'none',
    agentLog: [],
    agentBusy: false,
    agentDetail: 'proto',
    agentStepwise: false,
    exporting: false,
    selectionInfoOpen: false,
    clientId: null,
    wsConnected: false,
    viewingSeq: null,
    viewingBranchId: null,
    viewingState: null,

    load: async () => {
      try {
        // Öneri listesi yalnızca co-pronoia kanvaslarında var (diğerlerinde uç boş liste döndürür ama hiç sormayalım).
        const isCoPronoia = useCanvasStore.getState().active?.type === 'co-pronoia';
        const [state, { commits }, { branches }, { members }, { regions }, proposalsRes] = await Promise.all([
          api.getState(),
          api.getCommits(),
          api.getBranches(),
          api.getMembers(),
          api.getRegions(),
          isCoPronoia ? api.getProposals() : Promise.resolve({ proposals: [] }),
        ]);
        set({
          serverNodes: state.nodes,
          serverEdges: state.edges,
          nodes: state.nodes,
          edges: state.edges,
          pending: [],
          headSeq: state.headSeq,
          commits, branches, members, regions,
          proposals: proposalsRes.proposals,
          loaded: true,
        });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err), loaded: true });
      }
    },

    connectWs: (canvasId) => {
      if (ws) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const open = () => {
        const gen = ++wsGen;
        ws = new WebSocket(`${proto}://${window.location.host}/api/ws?canvas=${canvasId}`);
        ws.onopen = () => set({ wsConnected: true });
        ws.onclose = () => {
          if (gen !== wsGen) return; // superseded or deliberately closed
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
              set((s) => withServerState(s, msg.state, msg.commit));
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
                set((s) => withServerState(s, msg.state!, msg.commit));
              }
              break;
            case 'presence':
              set({ activeUsers: msg.users });
              break;
            case 'members': {
              set({ members: msg.members });
              // Own role may have changed — reflect it on the active canvas immediately.
              const active = useCanvasStore.getState().active;
              const me = useAuthStore.getState().user;
              if (active && me) {
                const mine = msg.members.find((m) => m.userId === me.id);
                if (mine && mine.role !== active.role) {
                  useCanvasStore.setState({ active: { ...active, role: mine.role } });
                }
              }
              break;
            }
            case 'regions':
              set({ regions: msg.regions });
              break;
            case 'proposals':
              set({ proposals: msg.proposals });
              break;
            case 'canvas_gone':
              useCanvasStore.setState({
                error: msg.reason === 'deleted' ? 'Kanvas, sahibi tarafından silindi.' : 'Bu kanvastan çıkarıldınız.',
              });
              useCanvasStore.getState().close();
              break;
          }
        };
      };
      open();
    },

    disconnectWs: () => {
      wsGen++;
      if (wsRetry) clearTimeout(wsRetry);
      wsRetry = null;
      const sock = ws;
      ws = null;
      sock?.close();
      set({ wsConnected: false, clientId: null });
    },

    reset: () =>
      set({
        serverNodes: [], serverEdges: [], nodes: [], edges: [], pending: [],
        headSeq: 0, commits: [], branches: [], members: [], regions: [], proposals: [], activeUsers: [],
        loaded: false, error: null, notice: null, selectedNodeId: null, selectedNodeIds: [], selectedRegionIds: [], sidePanel: 'none',
        viewingSeq: null, viewingBranchId: null, viewingState: null,
        agentLog: [], agentBusy: false, exporting: false, selectionInfoOpen: false,
      }),

    setAgentDetail: (agentDetail) => set({ agentDetail }),
    setAgentStepwise: (agentStepwise) => set({ agentStepwise }),
    setExporting: (exporting) => set({ exporting }),
    setSelectionInfoOpen: (selectionInfoOpen) => set({ selectionInfoOpen }),

    askAgent: async (prompt) => {
      const trimmed = prompt.trim();
      if (!trimmed || get().agentBusy) return;
      set((s) => ({ agentLog: [...s.agentLog, { who: 'user', text: trimmed }], agentBusy: true }));
      try {
        // Commit atarsa sunucu WS'ten clientId: null ile yayınlar; state oradan güncellenir.
        // Seçili düğümler komuta bağlam olarak eklenir ("şu adımları detaylandır" bunlara işaret eder).
        const res = await api.agent(trimmed, get().agentDetail, get().selectedNodeIds, get().selectedRegionIds, get().agentStepwise);
        set((s) => ({
          agentLog: [...s.agentLog, {
            who: 'agent',
            text: res.reply || res.error || 'Yanıt alınamadı.',
            ...(res.commitSeq !== undefined ? { commitSeq: res.commitSeq } : {}),
            ...(res.branched ? { branched: true } : {}),
            ...(res.error ? { isError: true } : {}),
          }],
        }));
      } catch (err) {
        const text = err instanceof ApiError ? err.message : String(err);
        set((s) => ({ agentLog: [...s.agentLog, { who: 'agent', text, isError: true }] }));
      } finally {
        set({ agentBusy: false });
      }
    },

    setView: (view) => set({ view }),
    select: (selectedNodeId) =>
      set({ selectedNodeId, selectedNodeIds: selectedNodeId ? [selectedNodeId] : [], selectedRegionIds: [], selectionInfoOpen: false }),
    // Ctrl/Shift+tık seçimleri soldaki açıklama panelini açar; seçim boşalınca panel kapanır.
    toggleSelect: (id) =>
      set((s) => {
        const has = s.selectedNodeIds.includes(id);
        const selectedNodeIds = has ? s.selectedNodeIds.filter((x) => x !== id) : [...s.selectedNodeIds, id];
        return {
          selectedNodeIds,
          selectedNodeId: has ? (selectedNodeIds.at(-1) ?? null) : id,
          selectionInfoOpen: selectedNodeIds.length + s.selectedRegionIds.length > 0,
        };
      }),
    toggleSelectRegion: (id) =>
      set((s) => {
        const selectedRegionIds = s.selectedRegionIds.includes(id)
          ? s.selectedRegionIds.filter((x) => x !== id)
          : [...s.selectedRegionIds, id];
        return { selectedRegionIds, selectionInfoOpen: selectedRegionIds.length + s.selectedNodeIds.length > 0 };
      }),
    togglePanel: (panel) => set((s) => ({ sidePanel: s.sidePanel === panel ? 'none' : panel })),
    clearError: () => set({ error: null }),
    clearNotice: () => set({ notice: null }),

    addNode: (fields) => stage([{ op: 'add_node', id: genId(), ...fields }]),
    updateNode: (id, fields) => stage([{ op: 'update_node', id, fields }]),
    deleteNode: (id) => {
      stage([{ op: 'delete_node', id }]);
      set((s) => ({
        selectedNodeIds: s.selectedNodeIds.filter((x) => x !== id),
        ...(s.selectedNodeId === id ? { selectedNodeId: null } : {}),
      }));
    },
    moveNode: (id, x, y) => stage([{ op: 'move_node', id, x, y }]),
    connect: (sourceId, targetId, kind) => stage([{ op: 'add_edge', id: genId(), sourceId, targetId, kind }]),
    updateEdge: (id, fields) => {
      const edge = get().edges.find((e) => e.id === id);
      if (!edge) return;
      stage([
        { op: 'delete_edge', id },
        { op: 'add_edge', id, sourceId: edge.sourceId, targetId: edge.targetId, ...fields },
      ]);
    },
    deleteEdge: (id) => stage([{ op: 'delete_edge', id }]),

    push: async () => {
      const { pending, headSeq, clientId } = get();
      if (pending.length === 0) return;
      try {
        const outcome = await api.commit(pending, { baseSeq: headSeq, clientId });
        set({ pending: [] });
        handleOutcome(outcome);
      } catch (err) {
        // Keep the staged changes so the user can fix or discard them.
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },

    discardPending: () =>
      set((s) => ({ pending: [], nodes: s.serverNodes, edges: s.serverEdges, selectedNodeId: null })),

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

    revert: (seq) =>
      direct(async () => {
        set({ viewingSeq: null, viewingBranchId: null, viewingState: null });
        const r = await api.revert(seq, get().clientId);
        applyState(r.state, r.commit);
      }),
    restore: (seq) =>
      direct(async () => {
        set({ viewingSeq: null, viewingBranchId: null, viewingState: null });
        const r = await api.restore(seq, get().clientId);
        applyState(r.state, r.commit);
      }),
    mergeBranch: (id) =>
      direct(async () => {
        const r = await api.mergeBranch(id);
        set((s) => ({ branches: s.branches.filter((b) => b.id !== id) }));
        applyState(r.state, r.commit);
      }),
    discardBranch: (id) =>
      direct(async () => {
        await api.discardBranch(id);
        set((s) => ({
          branches: s.branches.filter((b) => b.id !== id),
          viewingBranchId: s.viewingBranchId === id ? null : s.viewingBranchId,
          viewingState: s.viewingBranchId === id ? null : s.viewingState,
        }));
      }),

    setMemberRole: async (userId, role) => {
      try {
        const { members } = await api.setMemberRole(userId, role);
        set({ members });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    removeMember: async (userId) => {
      try {
        const { members } = await api.removeMember(userId);
        set({ members });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    createRegion: async (data) => {
      try {
        await api.createRegion(data);
        set({ regions: (await api.getRegions()).regions });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    updateRegion: async (id, data) => {
      try {
        await api.updateRegion(id, data);
        set({ regions: (await api.getRegions()).regions });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    deleteRegion: async (id) => {
      try {
        await api.deleteRegion(id);
        set((s) => ({
          regions: s.regions.filter((r) => r.id !== id),
          selectedRegionIds: s.selectedRegionIds.filter((x) => x !== id),
        }));
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    setRegionMembers: async (id, userIds, roleIds) => {
      try {
        const { region } = await api.setRegionMembers(id, userIds, roleIds);
        set((s) => ({ regions: s.regions.map((r) => (r.id === id ? region : r)) }));
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
    rejectProposal: async (id) => {
      try {
        const { proposal } = await api.rejectProposal(id);
        set((s) => ({ proposals: s.proposals.map((p) => (p.id === id ? proposal : p)) }));
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : String(err) });
      }
    },
  };
});

/** True when the UI must not allow edits: time-travel, branch view, or viewer role. */
export function useReadOnly(): boolean {
  const viewing = useGraphStore((s) => s.viewingSeq !== null || s.viewingBranchId !== null);
  const viewer = useCanvasStore((s) => s.active?.role === 'viewer');
  return viewing || viewer;
}

/** The graph currently displayed: preview (server + staged), or historical/branch state in read-only mode. */
export function useDisplayedGraph(): { nodes: PlanNode[]; edges: PlanEdge[]; readOnly: boolean } {
  const nodes = useGraphStore((s) => (s.viewingState ? s.viewingState.nodes : s.nodes));
  const edges = useGraphStore((s) => (s.viewingState ? s.viewingState.edges : s.edges));
  const readOnly = useReadOnly();
  return { nodes, edges, readOnly };
}
