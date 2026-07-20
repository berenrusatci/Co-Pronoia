import { useEffect, useState } from 'react';
import type { CanvasBriefRevisionInfo } from '@treemapper/shared';
import { api, ApiError } from '../api/client';
import { useGraphStore } from '../store/graphStore';
import { useCanvasStore } from '../store/canvasStore';

/**
 * Kanvas notu ("kanvasın CLAUDE.md'si"): üyelerin ve ajanların uyduğu ortak çalışma brifingi.
 * Editor+ düzenler; MCP ajanları update_brief ile, Gemini ajanı bağlam olarak kullanır.
 * WS 'brief' mesajı store'u tazeler; taslak yalnızca kullanıcı yazmıyorken senkronlanır.
 */
export function BriefPanel() {
  const brief = useGraphStore((s) => s.brief);
  const role = useCanvasStore((s) => s.active?.role);
  const canEdit = role === 'owner' || role === 'editor';

  const [draft, setDraft] = useState(brief?.content ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<CanvasBriefRevisionInfo[] | null>(null);
  const [viewing, setViewing] = useState<CanvasBriefRevisionInfo | null>(null);

  // Başkası (üye ya da ajan) güncellerse ve bizde düzenlenmemiş taslak varsa yenisini al.
  useEffect(() => {
    if (!dirty) setDraft(brief?.content ?? '');
  }, [brief?.content, dirty]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.putBrief(draft);
      setDirty(false);
      setRevisions(null); // geçmiş bayatladı; tekrar açılınca yeniden yüklenir
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleHistory = async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    setViewing(null);
    if (next && revisions === null) {
      try {
        setRevisions((await api.getBriefRevisions()).revisions);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      }
    }
  };

  return (
    <aside className="side-panel">
      <h3>📋 Kanvas notu</h3>
      <p className="hint">
        Kanvasın ortak çalışma brifingi: hedefler, kararlar, kısıtlar. Yapay zekâ ajanları da bu notu okur ve
        (MCP üzerinden) güncelleyebilir.
      </p>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        readOnly={!canEdit}
        rows={14}
        placeholder={canEdit ? 'Örn. Hedef: MVP önce ödeme akışı. Karar: Stripe kullanılacak…' : '(kanvas notu boş)'}
        style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
      />
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={save} disabled={saving || !dirty}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          {dirty && (
            <button
              onClick={() => {
                setDraft(brief?.content ?? '');
                setDirty(false);
              }}
            >
              Vazgeç
            </button>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {brief?.authorLabel && (
        <p className="hint">
          Son güncelleme: {brief.authorLabel} · {brief.updatedAt ? new Date(brief.updatedAt).toLocaleString('tr-TR') : ''}
        </p>
      )}
      <button onClick={toggleHistory} style={{ marginTop: 8 }}>
        {historyOpen ? 'Geçmişi gizle' : `Geçmiş (${brief?.revisionCount ?? 0})`}
      </button>
      {historyOpen && (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 6 }}>
          {(revisions ?? []).map((r) => (
            <li key={r.id} style={{ marginBottom: 4 }}>
              <button
                onClick={() => setViewing(viewing?.id === r.id ? null : r)}
                style={{ width: '100%', textAlign: 'left' }}
              >
                #{r.id} · {r.authorLabel} · {new Date(r.createdAt).toLocaleString('tr-TR')}
              </button>
              {viewing?.id === r.id && (
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
                  {r.content || '(boş)'}
                </pre>
              )}
            </li>
          ))}
          {revisions !== null && revisions.length === 0 && <li className="hint">Henüz revizyon yok.</li>}
        </ul>
      )}
    </aside>
  );
}
