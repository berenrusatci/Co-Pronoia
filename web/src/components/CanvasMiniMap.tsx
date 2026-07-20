import { MiniMap } from '@xyflow/react';
import type { MiniMapNodeProps } from '@xyflow/react';
import type { NodeStatus } from '@treemapper/shared';
import { useGraphStore } from '../store/graphStore';

const REGION_PREFIX = 'region:';

/** Düğüm noktalarının durum rengi — kart yüzeyindeki status-dot ile aynı dil. */
const statusColor: Record<NodeStatus, string> = {
  planned: 'var(--text-dim)',
  in_progress: 'var(--accent)',
  done: 'var(--success-dot)',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Mini haritadaki tek bir öğeyi çizer. Koordinatlar flow düzlemindedir (props'tan gelir),
 * renk/başlık bilgisi store'dan id ile aranır. Bölgeler renkli çerçeve + başlık etiketiyle,
 * düğümler durum renkli yuvarlak noktalarla gösterilir.
 */
function CanvasMiniMapNode({ id, x, y, width, height, borderRadius }: MiniMapNodeProps) {
  const regions = useGraphStore((s) => s.regions);
  const nodes = useGraphStore((s) => s.nodes);

  if (id.startsWith(REGION_PREFIX)) {
    const region = regions.find((r) => r.id === id.slice(REGION_PREFIX.length));
    const color = region?.color || 'var(--border-strong)';
    const name = region?.name ?? '';
    const fontSize = clamp(height * 0.16, 13, 44);
    // Etiketi bölge genişliğine kabaca sığdır (ortalama karakter ≈ 0.58 em).
    const maxChars = Math.max(3, Math.floor((width - 2 * fontSize) / (fontSize * 0.58)));
    const label = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={12}
          ry={12}
          fill={color}
          fillOpacity={0.1}
          stroke={color}
          strokeWidth={3}
          strokeOpacity={0.85}
        />
        {label && (
          <text
            x={x + fontSize * 0.6}
            y={y + fontSize * 1.1}
            fontSize={fontSize}
            fontWeight={700}
            fill={color}
            stroke="var(--bg-panel)"
            strokeWidth={fontSize * 0.16}
            paintOrder="stroke"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {label}
          </text>
        )}
      </g>
    );
  }

  const plan = nodes.find((n) => n.id === id);
  const fill = plan ? statusColor[plan.status] : 'var(--border-strong)';
  // Düğümü küçük yuvarlak bir çip olarak çiz; kartın gerçek en-boyu yerine okunur bir nokta.
  const r = clamp(Math.min(width, height) * 0.5, 6, Math.min(width, height) * 0.5);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rr = Math.max(6, Math.min(r, Math.min(width, height) / 2));
  return (
    <rect
      x={cx - rr}
      y={cy - rr}
      width={rr * 2}
      height={rr * 2}
      rx={borderRadius}
      ry={borderRadius}
      fill={fill}
      fillOpacity={0.9}
      stroke="var(--bg-panel)"
      strokeWidth={2}
    />
  );
}

/** Temaya uyumlu, bölge başlıklarını gösteren kanvas mini haritası. */
export function CanvasMiniMap() {
  return (
    <MiniMap
      className="canvas-minimap"
      pannable
      zoomable
      ariaLabel="Kanvas mini haritası"
      nodeComponent={CanvasMiniMapNode}
      offsetScale={6}
    />
  );
}
