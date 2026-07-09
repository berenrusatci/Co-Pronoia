import { useGraphStore, type ViewMode } from '../store/graphStore';
import { useAuthStore } from '../store/authStore';

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
  const togglePanel = useGraphStore((s) => s.togglePanel);
  const sidePanel = useGraphStore((s) => s.sidePanel);
  const headSeq = useGraphStore((s) => s.headSeq);
  const edgeCount = useGraphStore((s) => s.edges.length);
  const branchCount = useGraphStore((s) => s.branches.length);
  const wsConnected = useGraphStore((s) => s.wsConnected);
  const readOnly = useGraphStore((s) => s.viewingSeq !== null || s.viewingBranchId !== null);
  const view = useGraphStore((s) => s.view);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="toolbar">
      <span className="brand">🌳 TreeMapper</span>
      <ViewSwitcher />
      <div className="toolbar-right">
        {!readOnly && view !== 'timeline' && (
          <button onClick={() => addNode({ title: 'Yeni düğüm' })}>+ Düğüm</button>
        )}
        <button className={sidePanel === 'connections' ? 'active' : ''} onClick={() => togglePanel('connections')}>
          Bağlantılar ({edgeCount})
        </button>
        <button
          className={`${sidePanel === 'branches' ? 'active' : ''}${branchCount > 0 ? ' attention' : ''}`}
          onClick={() => togglePanel('branches')}
        >
          ⑂ Dallar{branchCount > 0 ? ` (${branchCount})` : ''}
        </button>
        <button className={sidePanel === 'history' ? 'active' : ''} onClick={() => togglePanel('history')}>
          Geçmiş (#{headSeq})
        </button>
        <span className={`ws-dot ${wsConnected ? 'on' : 'off'}`} title={wsConnected ? 'Canlı bağlantı aktif' : 'Canlı bağlantı kopuk'} />
        <span className="user-chip">{user?.username}</span>
        <button onClick={logout} title="Oturumu kapat">Çıkış</button>
      </div>
    </div>
  );
}

export function ReadOnlyBanner() {
  const viewingSeq = useGraphStore((s) => s.viewingSeq);
  const viewingBranchId = useGraphStore((s) => s.viewingBranchId);
  const branches = useGraphStore((s) => s.branches);
  const headSeq = useGraphStore((s) => s.headSeq);
  const backToLatest = useGraphStore((s) => s.backToLatest);
  const restore = useGraphStore((s) => s.restore);
  const mergeBranch = useGraphStore((s) => s.mergeBranch);

  if (viewingSeq !== null) {
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
  if (viewingBranchId !== null) {
    const branch = branches.find((b) => b.id === viewingBranchId);
    return (
      <div className="readonly-banner">
        <span>
          Dal görüntüleniyor: <strong>⑂ {branch?.name ?? viewingBranchId}</strong> — salt okunur
        </span>
        <button onClick={() => mergeBranch(viewingBranchId)}>Ana hatta birleştir</button>
        <button onClick={backToLatest}>Ana hatta dön</button>
      </div>
    );
  }
  return null;
}

export function ErrorToast() {
  const error = useGraphStore((s) => s.error);
  const clearError = useGraphStore((s) => s.clearError);
  const notice = useGraphStore((s) => s.notice);
  const clearNotice = useGraphStore((s) => s.clearNotice);
  return (
    <>
      {error && (
        <div className="error-toast" onClick={clearError}>
          ⚠ {error} <small>(kapatmak için tıkla)</small>
        </div>
      )}
      {notice && (
        <div className="notice-toast" onClick={clearNotice}>
          ⑂ {notice} <small>(kapatmak için tıkla)</small>
        </div>
      )}
    </>
  );
}
