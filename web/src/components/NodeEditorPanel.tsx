import { useEffect, useState } from 'react';
import type { CanvasInfo, NodeStatus, NodeType } from '@treemapper/shared';
import { canvasApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useCanvasStore } from '../store/canvasStore';
import { useGraphStore, useDisplayedGraph } from '../store/graphStore';

/** Yalnız http/https bağlantılara izin ver — javascript:/data: gibi şemalar önizlemede tehlikeli. */
export const isSafeUrl = (u: string): boolean => /^https?:\/\/\S+$/i.test(u.trim());

/**
 * "Bağlı kanvas" bölümü: düğümü aynı gruptaki bir alt kanvasa bağla / bağını kaldır /
 * düğüm için yeni alt kanvas oluştur. Bağ, normal staging akışıyla (Push) commit'lenir;
 * yalnızca gruba bağlı kanvaslarda görünür.
 */
function LinkedCanvasSection({
  nodeId, nodeTitle, linkedCanvasId, readOnly,
}: {
  nodeId: string;
  nodeTitle: string;
  linkedCanvasId: string | null;
  readOnly: boolean;
}) {
  const active = useCanvasStore((s) => s.active);
  const openById = useCanvasStore((s) => s.openById);
  const updateNode = useGraphStore((s) => s.updateNode);
  const pending = useGraphStore((s) => s.pending);

  const [candidates, setCandidates] = useState<CanvasInfo[]>([]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);

  const groupId = active?.groupId ?? null;
  useEffect(() => {
    if (!groupId) return;
    canvasApi
      .list()
      .then(({ canvases }) =>
        setCandidates(canvases.filter((c) => c.groupId === groupId && c.id !== active?.id)),
      )
      .catch(() => setCandidates([]));
  }, [groupId, active?.id]);

  if (!groupId) return null;

  const openLinked = () => {
    if (
      pending.length > 0 &&
      !window.confirm('Bekleyen değişiklikleriniz var; başka kanvasa geçerseniz kaybolur. Devam edilsin mi?')
    )
      return;
    void openById(linkedCanvasId!);
  };

  return (
    <div className="linked-canvas-section">
      <span className="linked-canvas-label">Bağlı kanvas</span>
      {linkedCanvasId ? (
        <div className="linked-canvas-row">
          <span className="linked-canvas-name">
            🗺 {candidates.find((c) => c.id === linkedCanvasId)?.name ?? '(erişilemiyor)'}
          </span>
          <button onClick={openLinked}>Aç</button>
          {!readOnly && (
            <button onClick={() => updateNode(nodeId, { linkedCanvasId: null })}>Bağlantıyı kaldır</button>
          )}
        </div>
      ) : readOnly ? (
        <span className="linked-canvas-name">yok</span>
      ) : (
        <>
          <div className="linked-canvas-row">
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Gruptan kanvas seç…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button disabled={!choice} onClick={() => { updateNode(nodeId, { linkedCanvasId: choice }); setChoice(''); }}>
              Bağla
            </button>
          </div>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                // Kanvas hemen oluşur (grup ayarı), bağ ise staging'e girer — Push ile commit'lenir.
                const { canvas } = await canvasApi.create(nodeTitle, groupId);
                setCandidates((cs) => [canvas, ...cs]);
                updateNode(nodeId, { linkedCanvasId: canvas.id });
              } catch {
                /* hata canvasStore yerine sessiz: bölüm küçük, tekrar denenebilir */
              } finally {
                setBusy(false);
              }
            }}
          >
            + Alt kanvas oluştur ve bağla
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Serbest anahtar-değer özel alanlar (`data`). Satırlar yerelde düzenlenir; her blur/silme
 * TÜM objeyi stage'ler (data çakışma tespitinde tek alandır, anahtar başına değil).
 */
function DataFieldsEditor({
  nodeId, data, readOnly, updateNode,
}: {
  nodeId: string;
  data: Record<string, string>;
  readOnly: boolean;
  updateNode: (id: string, fields: { data: Record<string, string> }) => void;
}) {
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>([]);
  useEffect(() => {
    setRows(Object.entries(data).map(([key, value]) => ({ key, value })));
  }, [nodeId, data]);

  const commit = (nextRows: Array<{ key: string; value: string }>) => {
    const next: Record<string, string> = {};
    for (const r of nextRows) if (r.key.trim()) next[r.key.trim()] = r.value;
    const changed = JSON.stringify(next) !== JSON.stringify(data);
    if (changed) updateNode(nodeId, { data: next });
  };

  const setRow = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <label>
      Özel alanlar
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 4 }}>
            <input
              value={r.key}
              disabled={readOnly}
              placeholder="alan (ör. tahmin)"
              style={{ flex: 1, minWidth: 0 }}
              onChange={(e) => setRow(i, { key: e.target.value })}
              onBlur={() => commit(rows)}
            />
            <input
              value={r.value}
              disabled={readOnly}
              placeholder="değer (ör. 3g)"
              style={{ flex: 1.4, minWidth: 0 }}
              onChange={(e) => setRow(i, { value: e.target.value })}
              onBlur={() => commit(rows)}
            />
            {!readOnly && (
              <button
                type="button"
                title="Alanı sil"
                onClick={() => {
                  const next = rows.filter((_, j) => j !== i);
                  setRows(next);
                  commit(next);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button" onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])}>
            ＋ Alan ekle
          </button>
        )}
        {readOnly && rows.length === 0 && <span className="hint">(özel alan yok)</span>}
      </div>
    </label>
  );
}

export function NodeEditorPanel() {
  const { nodes, readOnly } = useDisplayedGraph();
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const select = useGraphStore((s) => s.select);

  const myId = useAuthStore((s) => s.user?.id ?? null);

  const node = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    setTitle(node?.title ?? '');
    setDescription(node?.description ?? '');
    setNotes(node?.notes ?? '');
    setUrl(node?.url ?? '');
  }, [node?.id, node?.title, node?.description, node?.notes, node?.url]);

  if (!node) return null;

  const descendants = new Set<string>([node.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId !== null && descendants.has(n.parentId) && !descendants.has(n.id)) {
        descendants.add(n.id);
        grew = true;
      }
    }
  }
  const parentCandidates = nodes.filter((n) => !descendants.has(n.id));

  const commitText = () => {
    const fields: Record<string, string> = {};
    if (title !== node.title && title.trim()) fields.title = title.trim();
    if (description !== node.description) fields.description = description;
    if (notes !== node.notes) fields.notes = notes;
    if (Object.keys(fields).length > 0) updateNode(node.id, fields);
  };

  const commitUrl = () => {
    const next = url.trim();
    if (next === node.url) return;
    // Geçersiz (http/https dışı) bir değer stage edilmez; input'u geri sarıp uyarı bırakırız.
    if (next !== '' && !isSafeUrl(next)) { setUrl(node.url); return; }
    // urlBy: bağlantıyı ekleyen kişi (önizlemeyi otomatik görecek); temizlenince null.
    updateNode(node.id, { url: next, urlBy: next ? myId : null });
  };

  return (
    <aside className="editor-panel">
      <header>
        <h3>Düğüm düzenle</h3>
        <button className="close-btn" onClick={() => select(null)}>×</button>
      </header>
      <label>
        Başlık
        <input value={title} disabled={readOnly} onChange={(e) => setTitle(e.target.value)} onBlur={commitText}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </label>
      <label>
        Açıklama
        <textarea value={description} disabled={readOnly} rows={4} onChange={(e) => setDescription(e.target.value)} onBlur={commitText} />
      </label>
      <label>
        Notlar
        <textarea
          value={notes}
          disabled={readOnly}
          rows={8}
          placeholder="Uzun serbest not (markdown): ayrıntı, gerekçe, kabul kriterleri…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitText}
        />
      </label>
      <label>
        Bağlantı (URL)
        <input
          type="url"
          value={url}
          disabled={readOnly}
          placeholder="https://…"
          onChange={(e) => setUrl(e.target.value)}
          onBlur={commitUrl}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {url.trim() !== '' && !isSafeUrl(url) && (
          <span className="hint" style={{ color: 'var(--danger, #c0392b)' }}>
            Yalnız http/https bağlantı önizlenebilir.
          </span>
        )}
        {isSafeUrl(url) && (
          <span className="hint">Kartta küçük bir ekranda önizlenir; ekleyen otomatik görür, diğerleri "Gör"e basar.</span>
        )}
      </label>
      <DataFieldsEditor nodeId={node.id} data={node.data} readOnly={readOnly} updateNode={updateNode} />
      <label>
        Tür
        <select value={node.nodeType} disabled={readOnly} onChange={(e) => updateNode(node.id, { nodeType: e.target.value as NodeType })}>
          <option value="task">Görev</option>
          <option value="idea">Fikir</option>
          <option value="feature">Özellik</option>
          <option value="milestone">Kilometre taşı</option>
        </select>
      </label>
      <label>
        Durum
        <select value={node.status} disabled={readOnly} onChange={(e) => updateNode(node.id, { status: e.target.value as NodeStatus })}>
          <option value="planned">Planlandı</option>
          <option value="in_progress">Devam ediyor</option>
          <option value="done">Bitti</option>
        </select>
      </label>
      <label>
        Üst düğüm
        <select
          value={node.parentId ?? ''}
          disabled={readOnly}
          onChange={(e) => updateNode(node.id, { parentId: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">(kök)</option>
          {parentCandidates.map((n) => (
            <option key={n.id} value={n.id}>{n.title}</option>
          ))}
        </select>
      </label>
      <LinkedCanvasSection
        nodeId={node.id}
        nodeTitle={node.title}
        linkedCanvasId={node.linkedCanvasId}
        readOnly={readOnly}
      />
      <div className="editor-meta">
        Oluşturuldu: {node.createdCommit === 0 ? 'yeni' : `commit #${node.createdCommit}`} · Son değişiklik: {node.updatedCommit === 0 ? 'yeni' : `#${node.updatedCommit}`}
      </div>
      {!readOnly && (
        <button
          className="danger-btn"
          onClick={() => {
            if (window.confirm(`"${node.title}" ve tüm alt düğümleri silinsin mi?`)) deleteNode(node.id);
          }}
        >
          Düğümü sil
        </button>
      )}
    </aside>
  );
}
