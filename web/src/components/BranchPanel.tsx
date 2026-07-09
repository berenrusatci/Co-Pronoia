import { useGraphStore } from '../store/graphStore';

export function BranchPanel() {
  const branches = useGraphStore((s) => s.branches);
  const viewBranch = useGraphStore((s) => s.viewBranch);
  const mergeBranch = useGraphStore((s) => s.mergeBranch);
  const discardBranch = useGraphStore((s) => s.discardBranch);
  const viewingBranchId = useGraphStore((s) => s.viewingBranchId);

  return (
    <aside className="side-panel">
      <h3>Dallar ({branches.length})</h3>
      {branches.length === 0 ? (
        <p className="empty-note">
          Açık dal yok. Aynı anda iki kişi çakışan değişiklik gönderirse, sonraki değişiklik otomatik olarak
          bir dala kaydedilir ve burada listelenir.
        </p>
      ) : (
        <div className="branch-list">
          {branches.map((b) => (
            <div key={b.id} className={`branch-entry${viewingBranchId === b.id ? ' viewing' : ''}`}>
              <div className="branch-head">
                <span className="branch-name">⑂ {b.name}</span>
              </div>
              <div className="branch-meta">
                {b.createdBy} · #{b.baseSeq} üzerinden · {new Date(b.createdAt).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
              </div>
              <div className="branch-actions">
                <button onClick={() => viewBranch(b.id)}>Görüntüle</button>
                <button
                  className="primary"
                  onClick={() => mergeBranch(b.id)}
                  title="Dalın halini ana hatta tek merge commit'i olarak uygular"
                >
                  Ana hatta birleştir
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`'${b.name}' dalı silinsin mi? Değişiklikleri ana hatta uygulanmaz.`)) discardBranch(b.id);
                  }}
                >
                  Dalı sil
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
