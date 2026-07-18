import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from './store/graphStore';
import { useAuthStore } from './store/authStore';
import { useCanvasStore } from './store/canvasStore';
import { setOnUnauthorized } from './api/client';
import { FlowView } from './views/FlowView';
import { MindMapView } from './views/MindMapView';
import { TimelineView } from './views/TimelineView';
import { NodeEditorPanel } from './components/NodeEditorPanel';
import { CommitList } from './components/CommitList';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import { BranchPanel } from './components/BranchPanel';
import { MembersPanel } from './components/MembersPanel';
import { RegionsPanel } from './components/RegionsPanel';
import { AgentPanel } from './components/AgentPanel';
import { CoPronoiaPanel } from './components/CoPronoiaPanel';
import { SelectionInfoPanel } from './components/SelectionInfoPanel';
import { LoginView } from './components/LoginView';
import { GroupJoinPrompt } from './components/GroupJoinPrompt';
import { Dashboard } from './components/Dashboard';
import { AdminPanel } from './components/AdminPanel';
import { useAdminStore } from './store/adminStore';
import { Toolbar, ReadOnlyBanner, ErrorToast } from './components/Chrome';

export default function App() {
  const user = useAuthStore((s) => s.user);
  const checked = useAuthStore((s) => s.checked);
  const check = useAuthStore((s) => s.check);
  const dropSession = useAuthStore((s) => s.dropSession);

  const adminOpen = useAdminStore((s) => s.open);
  const setAdminOpen = useAdminStore((s) => s.setOpen);
  const activeCanvas = useCanvasStore((s) => s.active);
  const joinByToken = useCanvasStore((s) => s.joinByToken);
  const openCanvas = useCanvasStore((s) => s.open);
  const resetCanvases = useCanvasStore((s) => s.reset);

  const load = useGraphStore((s) => s.load);
  const connectWs = useGraphStore((s) => s.connectWs);
  const disconnectWs = useGraphStore((s) => s.disconnectWs);
  const resetGraph = useGraphStore((s) => s.reset);
  const loaded = useGraphStore((s) => s.loaded);
  const view = useGraphStore((s) => s.view);
  const sidePanel = useGraphStore((s) => s.sidePanel);

  // Invite link (?davet=TOKEN): accepted right after login, then stripped from the URL.
  const [joinPending, setJoinPending] = useState(
    () => new URLSearchParams(window.location.search).has('davet'),
  );
  // Group invite link (?grupDavet=TOKEN): prompts for a job title, then requests to join.
  const [groupJoinPending, setGroupJoinPending] = useState(
    () => new URLSearchParams(window.location.search).has('grupDavet'),
  );

  useEffect(() => {
    setOnUnauthorized(dropSession);
    check();
  }, [check, dropSession]);

  // Logging out (or a 401) drops back to the login screen with clean stores.
  useEffect(() => {
    if (checked && !user) {
      resetCanvases();
      setAdminOpen(false);
    }
  }, [checked, user, resetCanvases, setAdminOpen]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('davet');
    if (!token) {
      setJoinPending(false);
      return;
    }
    (async () => {
      const canvas = await joinByToken(token);
      params.delete('davet');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
      if (canvas) openCanvas(canvas);
      setJoinPending(false);
    })();
  }, [user, joinByToken, openCanvas]);

  useEffect(() => {
    if (user && activeCanvas) {
      load();
      connectWs(activeCanvas.id);
      return () => {
        disconnectWs();
        resetGraph();
      };
    }
  }, [user, activeCanvas, load, connectWs, disconnectWs, resetGraph]);

  if (!checked) return <div className="loading">Yükleniyor…</div>;
  if (!user) return <LoginView />;
  if (joinPending) return <div className="loading">Davet linki işleniyor…</div>;
  if (groupJoinPending) {
    return (
      <GroupJoinPrompt
        onDone={() => {
          const params = new URLSearchParams(window.location.search);
          params.delete('grupDavet');
          const qs = params.toString();
          window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
          setGroupJoinPending(false);
        }}
      />
    );
  }
  if (!activeCanvas) return adminOpen && user.isAdmin ? <AdminPanel /> : <Dashboard />;
  if (!loaded) return <div className="loading">Yükleniyor…</div>;

  return (
    <div className="app">
      <Toolbar />
      <ReadOnlyBanner />
      <ErrorToast />
      <div className="main-area">
        {view !== 'timeline' && <SelectionInfoPanel />}
        <div className="canvas-area">
          <ReactFlowProvider>
            {view === 'flow' && <FlowView />}
            {view === 'mindmap' && <MindMapView />}
            {view === 'timeline' && <TimelineView />}
          </ReactFlowProvider>
        </div>
        {view !== 'timeline' && <NodeEditorPanel />}
        {sidePanel === 'history' && view !== 'timeline' && (
          <aside className="side-panel">
            <h3>Commit geçmişi</h3>
            <CommitList />
          </aside>
        )}
        {sidePanel === 'connections' && <ConnectionsPanel />}
        {sidePanel === 'branches' && <BranchPanel />}
        {sidePanel === 'members' && <MembersPanel />}
        {sidePanel === 'regions' && <RegionsPanel />}
        {sidePanel === 'agent' && <AgentPanel />}
        {sidePanel === 'copronoia' && <CoPronoiaPanel />}
      </div>
    </div>
  );
}
