import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from './store/graphStore';
import { FlowView } from './views/FlowView';
import { MindMapView } from './views/MindMapView';
import { TimelineView } from './views/TimelineView';
import { NodeEditorPanel } from './components/NodeEditorPanel';
import { CommitList } from './components/CommitList';
import { Toolbar, ReadOnlyBanner, ErrorToast } from './components/Chrome';

export default function App() {
  const load = useGraphStore((s) => s.load);
  const loaded = useGraphStore((s) => s.loaded);
  const view = useGraphStore((s) => s.view);
  const historyOpen = useGraphStore((s) => s.historyOpen);

  useEffect(() => {
    load();
  }, [load]);

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
        {historyOpen && view !== 'timeline' && (
          <aside className="history-panel">
            <h3>Commit geçmişi</h3>
            <CommitList />
          </aside>
        )}
      </div>
    </div>
  );
}
