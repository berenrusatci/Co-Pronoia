import { useEffect, useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { CanvasPreview, NodeStatus, NodeType, PlanNode } from '@treemapper/shared';
import { canvasApi } from '../api/client';
import { useCanvasStore } from '../store/canvasStore';
import { useGraphStore, useReadOnly } from '../store/graphStore';

export type FlowNodeData = { plan: PlanNode; showChildButton: boolean };
export type FlowNode = Node<FlowNodeData, 'card'>;

const typeIcons: Record<NodeType, string> = { task: '☐', idea: '💡', feature: '⭑', milestone: '⚑' };
const statusLabels: Record<NodeStatus, string> = { planned: 'planlandı', in_progress: 'devam ediyor', done: 'bitti' };

const statusFill: Record<NodeStatus, string> = {
  planned: 'var(--text-muted)',
  in_progress: 'var(--accent)',
  done: 'var(--success)',
};

/** Bağlı kanvasın mini haritası: durum renkli noktalar + kenar çizgileri, bbox'a göre normalize. */
function PreviewMap({ preview }: { preview: CanvasPreview }) {
  const W = 120;
  const H = 64;
  const PAD = 8;
  const pts = preview.nodes;
  let toX = (_x: number) => W / 2;
  let toY = (_y: number) => H / 2;
  if (pts.length > 1) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    toX = (x) => PAD + ((x - minX) / spanX) * (W - 2 * PAD);
    toY = (y) => PAD + ((y - minY) / spanY) * (H - 2 * PAD);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="subcanvas-map" aria-hidden>
      {preview.edges.map(([s, t], i) => (
        <line
          key={i}
          x1={toX(pts[s].x)} y1={toY(pts[s].y)} x2={toX(pts[t].x)} y2={toY(pts[t].y)}
          stroke="var(--border-strong)" strokeWidth={1}
        />
      ))}
      {pts.map((p, i) => (
        <circle key={i} cx={toX(p.x)} cy={toY(p.y)} r={3} fill={statusFill[p.status]} />
      ))}
    </svg>
  );
}

/** Düğüme bağlı alt kanvasın kart içi önizlemesi; tıklayınca bağlı kanvas açılır. */
function SubCanvasPreview({ canvasId }: { canvasId: string }) {
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'locked'; preview?: CanvasPreview }>({
    status: 'loading',
  });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    canvasApi
      .preview(canvasId)
      .then(({ preview }) => { if (alive) setState({ status: 'ok', preview }); })
      // 404 hem "erişim yok" hem "silinmiş" olabilir; sunucu ayrımı bilerek sızdırmaz.
      .catch(() => { if (alive) setState({ status: 'locked' }); });
    return () => { alive = false; };
  }, [canvasId]);

  if (state.status === 'loading') return <div className="subcanvas-preview subcanvas-muted">Bağlı kanvas…</div>;
  if (state.status === 'locked')
    return <div className="subcanvas-preview subcanvas-muted">🔒 Bağlı kanvas erişilemiyor</div>;

  const p = state.preview!;
  return (
    <button
      className="subcanvas-preview nodrag"
      title={`Bağlı kanvası aç: ${p.name}`}
      onClick={(e) => {
        e.stopPropagation();
        const { pending } = useGraphStore.getState();
        if (
          pending.length > 0 &&
          !window.confirm('Bekleyen değişiklikleriniz var; başka kanvasa geçerseniz kaybolur. Devam edilsin mi?')
        )
          return;
        useCanvasStore.getState().openById(canvasId);
      }}
    >
      <PreviewMap preview={p} />
      <span className="subcanvas-caption">
        🗺 {p.name} · {p.doneCount}/{p.nodeCount} ▸
      </span>
    </button>
  );
}

export function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const { plan, showChildButton } = data;
  const addNode = useGraphStore((s) => s.addNode);
  const exporting = useGraphStore((s) => s.exporting);
  const readOnly = useReadOnly();

  return (
    <div className={`node-card type-${plan.nodeType} status-${plan.status}${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-card-head">
        <span className="node-card-icon">{typeIcons[plan.nodeType]}</span>
        <span className="node-card-title">{plan.title}</span>
      </div>
      <div className="node-card-meta">
        <span className={`status-pill status-${plan.status}`}>{statusLabels[plan.status]}</span>
        <span className="commit-badge">{plan.createdCommit === 0 ? 'yeni•' : `#${plan.createdCommit}`}</span>
        {plan.notes && <span title="Bu düğümde uzun not var (düzenleyicide görün)">📝</span>}
      </div>
      {Object.keys(plan.data).length > 0 && (
        <div className="node-card-meta" title={Object.entries(plan.data).map(([k, v]) => `${k}: ${v}`).join('\n')}>
          {Object.entries(plan.data).slice(0, 3).map(([k, v]) => (
            <span key={k} className="commit-badge">{k}: {v.length > 12 ? `${v.slice(0, 12)}…` : v}</span>
          ))}
          {Object.keys(plan.data).length > 3 && (
            <span className="commit-badge">+{Object.keys(plan.data).length - 3}</span>
          )}
        </div>
      )}
      {exporting && plan.description && <div className="node-card-desc">{plan.description}</div>}
      {plan.linkedCanvasId && <SubCanvasPreview canvasId={plan.linkedCanvasId} />}
      {showChildButton && !readOnly && (
        <button
          className="add-child-btn"
          title="Alt düğüm ekle"
          onClick={(e) => {
            e.stopPropagation();
            addNode({ title: 'Yeni düğüm', parentId: plan.id });
          }}
        >
          +
        </button>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
