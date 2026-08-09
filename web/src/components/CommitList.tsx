import { useState } from 'react';
import type { Commit, Op } from '@co-pronoia/shared';
import { api } from '../api/client';
import { useGraphStore } from '../store/graphStore';

function opLine(op: Op): { cls: string; text: string } {
  switch (op.op) {
    case 'add_node': return { cls: 'diff-add', text: `+ düğüm "${op.node.title}"` };
    case 'delete_node': return { cls: 'diff-del', text: `− düğüm "${op.node.title}"` };
    case 'update_node': {
      const fields = Object.keys(op.after).join(', ');
      return { cls: 'diff-mod', text: `~ düğüm ${op.id}: ${fields}` };
    }
    case 'move_node': return { cls: 'diff-mod', text: `⇢ taşındı ${op.id} → (${op.after.x}, ${op.after.y})` };
    case 'add_edge': return { cls: 'diff-add', text: `+ bağlantı ${op.edge.sourceId} → ${op.edge.targetId}` };
    case 'delete_edge': return { cls: 'diff-del', text: `− bağlantı ${op.edge.sourceId} → ${op.edge.targetId}` };
  }
}

function CommitEntry({ seq, message, createdAt, opSummary, author }: { seq: number; message: string; createdAt: string; opSummary: string; author: string | null }) {
  const [detail, setDetail] = useState<Commit | null>(null);
  const [open, setOpen] = useState(false);
  const viewAt = useGraphStore((s) => s.viewAt);
  const revert = useGraphStore((s) => s.revert);
  const restore = useGraphStore((s) => s.restore);
  const viewingSeq = useGraphStore((s) => s.viewingSeq);
  const headSeq = useGraphStore((s) => s.headSeq);

  const toggle = async () => {
    if (!open && !detail) setDetail(await api.getCommit(seq).catch(() => null));
    setOpen(!open);
  };

  return (
    <div className={`commit-entry${viewingSeq === seq ? ' viewing' : ''}`}>
      <div className="commit-row" onClick={toggle}>
        <span className="commit-seq">#{seq}</span>
        <span className="commit-msg">{message}</span>
        <span className="commit-author">{author ?? 'sistem'}</span>
        <span className="commit-time">{new Date(createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="commit-sub">
        <span className="commit-summary">{opSummary}</span>
        <span className="commit-actions">
          {seq !== headSeq && <button onClick={() => viewAt(seq)}>Görüntüle</button>}
          <button onClick={() => revert(seq)} title="Sadece bu commit'i geri al (yeni commit olarak)">Geri al</button>
          {seq !== headSeq && <button onClick={() => restore(seq)} title="Grafiği bu commit'teki haline döndür (yeni commit olarak)">Buna dön</button>}
        </span>
      </div>
      {open && detail && (
        <ul className="commit-diff">
          {detail.ops.map((op, i) => {
            const { cls, text } = opLine(op);
            return <li key={i} className={cls}>{text}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

export function CommitList() {
  const commits = useGraphStore((s) => s.commits);
  if (commits.length === 0) return <p className="empty-note">Henüz commit yok.</p>;
  return (
    <div className="commit-list">
      {commits.map((c) => (
        <CommitEntry key={c.seq} {...c} />
      ))}
    </div>
  );
}
