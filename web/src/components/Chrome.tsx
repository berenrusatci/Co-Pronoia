import { useGraphStore, type ViewMode } from '../store/graphStore';

const views: { key: ViewMode; label: string }[] = [
  { key: 'mindmap', label: 'Zihin Haritası' },
  { key: 'flow', label: 'Akış Diyagramı' },
  { key: 'timeline', label: 'Zaman Çizelgesi' },
];

export function ViewSwitcher() {
  const view = useGraphStore((s) => s.view);
  const setView = useGraphStore((s) => s.setView);
  return (
    <nav className="view-switcher">
      {views.map((v) => (
        <button key={v.key} className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>
          {v.label}
        </button>
      ))}
    </nav>
  );
}

export function Toolbar() {
  const addNode = useGraphStore((s) => s.addNode);
  const toggleHistory = useGraphStore((s) => s.toggleHistory);
  const historyOpen = useGraphStore((s) => s.historyOpen);
  const headSeq = useGraphStore((s) => s.headSeq);
  const readOnly = useGraphStore((s) => s.viewingSeq !== null);
  const view = useGraphStore((s) => s.view);

  return (
    <div className="toolbar">
      <span className="brand">🌳 TreeMapper</span>
      <ViewSwitcher />
      <div className="toolbar-right">
        {!readOnly && view !== 'timeline' && (
          <button onClick={() => addNode({ title: 'Yeni düğüm' })}>+ Düğüm</button>
        )}
        <button className={historyOpen ? 'active' : ''} onClick={toggleHistory}>
          Geçmiş (#{headSeq})
        </button>
      </div>
    </div>
  );
}

export function ReadOnlyBanner() {
  const viewingSeq = useGraphStore((s) => s.viewingSeq);
  const headSeq = useGraphStore((s) => s.headSeq);
  const backToLatest = useGraphStore((s) => s.backToLatest);
  const restore = useGraphStore((s) => s.restore);
  if (viewingSeq === null) return null;
  return (
    <div className="readonly-banner">
      <span>
        Commit <strong>#{viewingSeq}</strong> / {headSeq} görüntüleniyor — salt okunur
      </span>
      <button onClick={() => restore(viewingSeq)}>Buraya geri dön</button>
      <button onClick={backToLatest}>Son hale dön</button>
    </div>
  );
}

export function ErrorToast() {
  const error = useGraphStore((s) => s.error);
  const clearError = useGraphStore((s) => s.clearError);
  if (!error) return null;
  return (
    <div className="error-toast" onClick={clearError}>
      ⚠ {error} <small>(kapatmak için tıkla)</small>
    </div>
  );
}
