import { useState } from 'react';
import type { EdgeDirection, EdgeKind, PlanEdge } from '@co-pronoia/shared';
import { useGraphStore, useDisplayedGraph } from '../store/graphStore';
import { kindStyles } from './CurvedEdge';

const kindLabels: Record<EdgeKind, string> = {
  flow: 'akış', loop: 'döngü', dependency: 'bağımlılık', relation: 'ilişki',
};

function ConnectionItem({ edge, titleOf, readOnly }: { edge: PlanEdge; titleOf: (id: string) => string; readOnly: boolean }) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const deleteEdge = useGraphStore((s) => s.deleteEdge);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<EdgeKind>(edge.kind);
  const [direction, setDirection] = useState<EdgeDirection>(edge.direction);
  const [label, setLabel] = useState(edge.label);

  const arrow = edge.direction === 'bidirectional' ? '↔' : '→';
  const self = edge.sourceId === edge.targetId;

  return (
    <li className="connection-item">
      <div className="connection-line">
        <span className="connection-dot" style={{ background: kindStyles[edge.kind].stroke }} />
        <span className="connection-text">
          {self
            ? <><strong>{titleOf(edge.sourceId)}</strong> ⟳ kendine</>
            : <><strong>{titleOf(edge.sourceId)}</strong> {arrow} <strong>{titleOf(edge.targetId)}</strong></>}
          {' '}<em>({kindLabels[edge.kind]}{edge.label ? ` · ${edge.label}` : ''})</em>
        </span>
        {!readOnly && (
          <span className="connection-actions">
            <button onClick={() => setEditing(!editing)}>{editing ? 'Kapat' : 'Düzenle'}</button>
            <button onClick={() => deleteEdge(edge.id)}>Sil</button>
          </span>
        )}
      </div>
      {editing && !readOnly && (
        <div className="connection-edit">
          <select value={kind} onChange={(e) => setKind(e.target.value as EdgeKind)}>
            <option value="flow">Akış</option>
            <option value="loop">Döngü</option>
            <option value="dependency">Bağımlılık</option>
            <option value="relation">İlişki</option>
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value as EdgeDirection)}>
            <option value="directed">Tek yönlü →</option>
            <option value="bidirectional">Çift yönlü ↔</option>
          </select>
          <input placeholder="etiket" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button
            className="primary"
            onClick={() => {
              updateEdge(edge.id, { kind, direction, label });
              setEditing(false);
            }}
          >
            Kaydet
          </button>
        </div>
      )}
    </li>
  );
}

export function ConnectionsPanel() {
  const { nodes, edges, readOnly } = useDisplayedGraph();
  const connect = useGraphStore((s) => s.connect);
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');
  const [kind, setKind] = useState<EdgeKind>('flow');
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;

  return (
    <aside className="side-panel">
      <h3>Bağlantılar ({edges.length})</h3>
      {edges.length === 0 ? (
        <p className="empty-note">Henüz bağlantı yok. Akış görünümünde düğüm kenarından sürükleyerek veya aşağıdan ekleyin.</p>
      ) : (
        <ul className="connection-list">
          {edges.map((e) => (
            <ConnectionItem key={e.id} edge={e} titleOf={titleOf} readOnly={readOnly} />
          ))}
        </ul>
      )}
      {!readOnly && nodes.length > 0 && (
        <div className="connection-add">
          <h4>Bağlantı ekle</h4>
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">Kaynak…</option>
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
          </select>
          <select value={dst} onChange={(e) => setDst(e.target.value)}>
            <option value="">Hedef…</option>
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.title}{n.id === src ? ' (kendine)' : ''}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as EdgeKind)}>
            <option value="flow">Akış</option>
            <option value="loop">Döngü</option>
            <option value="dependency">Bağımlılık</option>
            <option value="relation">İlişki</option>
          </select>
          <button className="primary" disabled={!src || !dst} onClick={() => src && dst && connect(src, dst, kind)}>
            Ekle
          </button>
        </div>
      )}
    </aside>
  );
}
