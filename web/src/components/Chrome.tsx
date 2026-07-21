import { useState } from 'react';
import { useGraphStore, useReadOnly, type ViewMode } from '../store/graphStore';
import { useAuthStore } from '../store/authStore';
import { useCanvasStore } from '../store/canvasStore';
import { useThemeStore } from '../store/themeStore';
import { Brand } from './Logo';
import { ServerPdfButton } from './ServerPdfButton';

const views: { key: ViewMode; label: string }[] = [
  { key: 'flow', label: 'Zihin Haritası' },
  { key: 'mindmap', label: 'Akış Diyagramı' },
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
  const openProposalCount = useGraphStore(
    (s) => s.proposals.filter((p) => p.status === 'submitted' || p.status === 'changes_requested').length,
  );
  const pendingCount = useGraphStore((s) => s.pending.length);
  const push = useGraphStore((s) => s.push);
  const discardPending = useGraphStore((s) => s.discardPending);
  const activeUsers = useGraphStore((s) => s.activeUsers);
  const wsConnected = useGraphStore((s) => s.wsConnected);
  const readOnly = useReadOnly();
  const view = useGraphStore((s) => s.view);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const activeCanvas = useCanvasStore((s) => s.active);
  const closeCanvas = useCanvasStore((s) => s.close);
  const parent = useCanvasStore((s) => s.parents[s.parents.length - 1] ?? null);
  const openParent = useCanvasStore((s) => s.openParent);
  const inviteLink = useCanvasStore((s) => s.inviteLink);
  const [copied, setCopied] = useState(false);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const leaveCanvas = () => {
    if (pendingCount > 0 && !window.confirm(`${pendingCount} push edilmemiş değişiklik var — panoya dönersen kaybolur. Devam?`))
      return;
    closeCanvas();
  };

  const goParent = () => {
    if (pendingCount > 0 && !window.confirm(`${pendingCount} push edilmemiş değişiklik var — üst kanvasa dönersen kaybolur. Devam?`))
      return;
    openParent();
  };

  const copyInvite = async () => {
    if (!activeCanvas) return;
    const url = await inviteLink(activeCanvas.id);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Davet linkini kopyalayın:', url);
    }
  };

  return (
    <div className="toolbar">
      <span className="brand"><Brand /></span>
      <button className="pano-btn" onClick={leaveCanvas} title="Kanvas listesine dön">
        ← Pano
      </button>
      {parent && (
        <button className="pano-btn" onClick={goParent} title={`Üst kanvasa dön: ${parent.name}`}>
          ↑ Üst kanvas
        </button>
      )}
      <span className="canvas-title" title={activeCanvas?.name}>{activeCanvas?.name}</span>
      <ViewSwitcher />
      {!readOnly && (
        <span className="push-group">
          <button
            className={`push-btn${pendingCount > 0 ? ' has-pending' : ''}`}
            disabled={pendingCount === 0}
            onClick={push}
            title="Bekleyen değişiklikleri tek commit olarak gönder"
          >
            ⬆ Push{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
          {pendingCount > 0 && (
            <button
              className="pano-btn"
              onClick={() => window.confirm('Push edilmemiş tüm değişiklikler geri alınsın mı?') && discardPending()}
              title="Bekleyen değişiklikleri at"
            >
              Vazgeç
            </button>
          )}
        </span>
      )}
      <div className="toolbar-right">
        {!readOnly && view !== 'timeline' && (
          <button onClick={() => addNode({ title: 'Yeni düğüm' })}>+ Düğüm</button>
        )}
        <button className={sidePanel === 'agent' ? 'active' : ''} onClick={() => togglePanel('agent')} title="Gemini ajanı: kanvasla doğal dilde konuş">
          ✨ Ajan
        </button>
        {activeCanvas?.type === 'co-pronoia' && (
          <button
            className={`${sidePanel === 'copronoia' ? 'active' : ''}${openProposalCount > 0 ? ' attention' : ''}`}
            onClick={() => togglePanel('copronoia')}
            title="Co-Pronoia: MCP ajan anahtarları ve plan önerileri"
          >
            🤝 Co-Pronoia{openProposalCount > 0 ? ` (${openProposalCount})` : ''}
          </button>
        )}
        <button
          className={sidePanel === 'brief' ? 'active' : ''}
          onClick={() => togglePanel('brief')}
          title="Kanvas notu: üyelerin ve ajanların uyduğu ortak çalışma brifingi"
        >
          📋 Not
        </button>
        <button className={sidePanel === 'connections' ? 'active' : ''} onClick={() => togglePanel('connections')}>
          Bağlantılar ({edgeCount})
        </button>
        <button
          className={`${sidePanel === 'branches' ? 'active' : ''}${branchCount > 0 ? ' attention' : ''}`}
          onClick={() => togglePanel('branches')}
        >
          ⑂ Dallar{branchCount > 0 ? ` (${branchCount})` : ''}
        </button>
        <button className={sidePanel === 'members' ? 'active' : ''} onClick={() => togglePanel('members')}>
          Üyeler
        </button>
        <button className={sidePanel === 'regions' ? 'active' : ''} onClick={() => togglePanel('regions')}>
          Bölgeler
        </button>
        <button className={sidePanel === 'history' ? 'active' : ''} onClick={() => togglePanel('history')}>
          Geçmiş (#{headSeq})
        </button>
        <ServerPdfButton />
        <button onClick={copyInvite} title="Bu kanvasa üye ekleme linki oluştur ve kopyala">
          {copied ? 'Kopyalandı ✓' : '🔗 Davet'}
        </button>
        <span className={`ws-dot ${wsConnected ? 'on' : 'off'}`} title={wsConnected ? 'Canlı bağlantı aktif' : 'Canlı bağlantı kopuk'} />
        <span className="presence-chips" title={`Şu an aktif: ${activeUsers.join(', ') || '—'}`}>
          {activeUsers.map((u) => (
            <span key={u} className={`presence-chip${u === user?.username ? ' me' : ''}`}>
              {u.slice(0, 2).toUpperCase()}
            </span>
          ))}
        </span>
        <span className="user-chip">
          {user?.avatarUrl && <img className="user-avatar" src={user.avatarUrl} alt="" />}
          {user?.displayName || user?.username}
        </span>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Aydınlık moda geç' : 'Karanlık moda geç'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
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
  return <ViewerBanner />;
}

function ViewerBanner() {
  const isViewer = useCanvasStore((s) => s.active?.role === 'viewer');
  if (!isViewer) return null;
  return (
    <div className="readonly-banner">
      <span>Bu kanvasta <strong>görüntüleyici</strong> rolündesiniz — salt okunur.</span>
    </div>
  );
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
