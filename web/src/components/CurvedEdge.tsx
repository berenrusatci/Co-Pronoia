import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import type { EdgeDirection, EdgeKind } from '@treemapper/shared';

export type CurvedEdgeData = {
  kind: EdgeKind;
  direction: EdgeDirection;
  labelText: string;
  selfLoop: boolean;
  parallelIndex: number;
  parallelCount: number;
};
export type CurvedFlowEdge = Edge<CurvedEdgeData, 'curved'>;

export const kindStyles: Record<EdgeKind, { stroke: string; dash?: string; label: string }> = {
  flow: { stroke: '#3b6fe0', label: 'akış' },
  loop: { stroke: '#c47612', label: 'döngü' },
  dependency: { stroke: '#7a4dc9', dash: '7 4', label: 'bağımlılık' },
  relation: { stroke: '#8b95a8', dash: '2 4', label: 'ilişki' },
};

export function CurvedEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd, markerStart }: EdgeProps<CurvedFlowEdge>) {
  const kind = data?.kind ?? 'flow';
  const style = kindStyles[kind];
  const { parallelIndex = 0, parallelCount = 1 } = data ?? {};

  let path: string;
  let labelX: number;
  let labelY: number;

  if (data?.selfLoop) {
    // Self-loop (right handle → left handle of the same node): arc over the top.
    const lift = 70 + parallelIndex * 30;
    path = `M ${sourceX},${sourceY} C ${sourceX + 60},${sourceY - lift} ${targetX - 60},${targetY - lift} ${targetX},${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = sourceY - lift * 0.9;
  } else {
    // Quadratic curve, offset perpendicular per parallel index so parallel edges fan out.
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const len = Math.hypot(dx, dy) || 1;
    const off = 46 * (parallelIndex - (parallelCount - 1) / 2);
    const mx = (sourceX + targetX) / 2 + (-dy / len) * off;
    const my = (sourceY + targetY) / 2 + (dx / len) * off;
    path = `M ${sourceX},${sourceY} Q ${mx},${my} ${targetX},${targetY}`;
    labelX = 0.25 * sourceX + 0.5 * mx + 0.25 * targetX;
    labelY = 0.25 * sourceY + 0.5 * my + 0.25 * targetY;
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{ stroke: style.stroke, strokeWidth: 1.8, strokeDasharray: style.dash }}
      />
      {(data?.labelText || kind !== 'flow') && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, color: style.stroke }}
          >
            {data?.labelText || style.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
