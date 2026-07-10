import { useEffect, useState } from 'react';
import type { NodeStatus, NodeType } from '@treemapper/shared';
import { useGraphStore, useDisplayedGraph } from '../store/graphStore';

export function NodeEditorPanel() {
  const { nodes, readOnly } = useDisplayedGraph();
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const select = useGraphStore((s) => s.select);

  const node = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  useEffect(() => {
    setTitle(node?.title ?? '');
    setDescription(node?.description ?? '');
  }, [node?.id, node?.title, node?.description]);

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
    if (Object.keys(fields).length > 0) updateNode(node.id, fields);
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
