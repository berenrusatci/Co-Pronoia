import { useGraphStore } from '../store/graphStore';

const typeIcons: Record<string, string> = { task: '☐', idea: '💡', feature: '⭑', milestone: '⚑' };
const statusLabels: Record<string, string> = { planned: 'planlandı', in_progress: 'devam ediyor', done: 'bitti' };

/**
 * Ctrl/Shift+tık ile seçilen düğüm ve bölgelerin açıklamalarını kanvasın SOLUNDA gösterir.
 * Düz tık ya da seçimin boşalması paneli kapatır (graphStore.toggleSelect/select yönetir).
 */
export function SelectionInfoPanel() {
  const open = useGraphStore((s) => s.selectionInfoOpen);
  const setOpen = useGraphStore((s) => s.setSelectionInfoOpen);
  const nodes = useGraphStore((s) => s.nodes);
  const regions = useGraphStore((s) => s.regions);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const selectedRegionIds = useGraphStore((s) => s.selectedRegionIds);
  const toggleSelect = useGraphStore((s) => s.toggleSelect);
  const toggleSelectRegion = useGraphStore((s) => s.toggleSelectRegion);
  const select = useGraphStore((s) => s.select);

  const selectedNodes = selectedNodeIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => n !== undefined);
  const selectedRegions = selectedRegionIds
    .map((id) => regions.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);

  if (!open || (selectedNodes.length === 0 && selectedRegions.length === 0)) return null;

  return (
    <aside className="side-panel selection-info">
      <div className="selection-info-head">
        <h3>Seçim açıklamaları</h3>
        <button className="selection-info-close" onClick={() => setOpen(false)} title="Paneli kapat">×</button>
      </div>
      {selectedRegions.map((r) => (
        <div key={r.id} className="selection-info-item">
          <div className="selection-info-title">
            <span className="selection-info-dot" style={{ background: r.color }} />
            <strong>▢ {r.name}</strong>
            <button onClick={() => toggleSelectRegion(r.id)} title="Seçimden çıkar">×</button>
          </div>
          <p className={r.description ? 'selection-info-desc' : 'selection-info-desc empty'}>
            {r.description || 'Açıklama yok.'}
          </p>
        </div>
      ))}
      {selectedNodes.map((n) => (
        <div key={n.id} className="selection-info-item">
          <div className="selection-info-title">
            <span>{typeIcons[n.nodeType] ?? '☐'}</span>
            <strong>{n.title}</strong>
            <span className="status-pill">{statusLabels[n.status] ?? n.status}</span>
            <button
              className="selection-info-edit"
              onClick={() => select(n.id)}
              title="Düğümü düzenle (tüm alanlar)"
            >
              Düzenle
            </button>
            <button onClick={() => toggleSelect(n.id)} title="Seçimden çıkar">×</button>
          </div>
          <p className={n.description ? 'selection-info-desc' : 'selection-info-desc empty'}>
            {n.description || 'Açıklama yok.'}
          </p>
          {n.notes && (
            <div className="selection-info-notes">
              <span className="selection-info-notes-label">📝 Not</span>
              <p className="selection-info-desc">{n.notes}</p>
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
