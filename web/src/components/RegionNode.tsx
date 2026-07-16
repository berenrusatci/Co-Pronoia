import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import type { RegionInfo } from '@treemapper/shared';
import { useGraphStore } from '../store/graphStore';
import { useCanvasStore } from '../store/canvasStore';

export type RegionFlowNode = Node<{ region: RegionInfo }, 'region'>;

/** Translucent rectangle behind the graph; the owner can drag it and resize it when selected. */
export function RegionNode({ data, selected }: NodeProps<RegionFlowNode>) {
  const isOwner = useCanvasStore((s) => s.active?.role === 'owner');
  const updateRegion = useGraphStore((s) => s.updateRegion);
  const r = data.region;
  return (
    <div className="region-box" style={{ borderColor: r.color, background: `${r.color}18` }}>
      {isOwner && (
        <NodeResizer
          isVisible={!!selected}
          minWidth={120}
          minHeight={80}
          lineStyle={{ borderColor: r.color }}
          handleStyle={{ background: r.color }}
          onResizeEnd={(_, p) =>
            updateRegion(r.id, {
              x: Math.round(p.x), y: Math.round(p.y),
              width: Math.round(p.width), height: Math.round(p.height),
            })
          }
        />
      )}
      <div className="region-label" style={{ background: r.color }}>
        {r.name}
        {!r.aiAllowed && <span className="region-members-hint"> · 🚫AI</span>}
        {r.memberNames.length > 0 && <span className="region-members-hint"> · {r.memberNames.join(', ')}</span>}
      </div>
    </div>
  );
}
