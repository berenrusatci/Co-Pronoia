import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from './store/graphStore';
import { useAuthStore } from './store/authStore';
import { setOnUnauthorized } from './api/client';
import { FlowView } from './views/FlowView';
import { MindMapView } from './views/MindMapView';
import { TimelineView } from './views/TimelineView';
import { NodeEditorPanel } from './components/NodeEditorPanel';
import { CommitList } from './components/CommitList';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import { BranchPanel } from './components/BranchPanel';
import { LoginView } from './components/LoginView';
import { Toolbar, ReadOnlyBanner, ErrorToast } from './components/Chrome';

export default function App() {
  const user = useAuthStore((s) => s.user);
  const checked = useAuthStore((s) => s.checked);
  const check = useAuthStore((s) => s.check);
  const dropSession = useAuthStore((s) => s.dropSession);

  const load = useGraphStore((s) => s.load);
  const connectWs = useGraphStore((s) => s.connectWs);
  const disconnectWs = useGraphStore((s) => s.disconnectWs);
  const loaded = useGraphStore((s) => s.loaded);
  const view = useGraphStore((s) => s.view);
  const sidePanel = useGraphStore((s) => s.sidePanel);

  useEffect(() => {
    setOnUnauthorized(dropSession);
    check();
  }, [check, dropSession]);

  useEffect(() => {
    if (user) {
      load();
      connectWs();
      return () => disconnectWs();
    }
  }, [user, load, connectWs, disconnectWs]);

  if (!checked) return <div className="loading">Yükleniyor…</div>;
  if (!user) return <LoginView />;
  if (!loaded) return <div className="loading">Yükleniyor…</div>;

  return (
    <div className="app">
      <Toolbar />
      <ReadOnlyBanner />
      <ErrorToast />
      <div className="main-area">
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
      </div>
    </div>
  );
}
