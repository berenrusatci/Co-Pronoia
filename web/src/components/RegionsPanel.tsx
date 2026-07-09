import { useState, type FormEvent } from 'react';
import type { RegionInfo } from '@treemapper/shared';
import { useGraphStore } from '../store/graphStore';
import { useCanvasStore } from '../store/canvasStore';

const COLORS = ['#3b6fe0', '#c47612', '#7a4dc9', '#1e7a2e', '#b3261e', '#0e7f86'];

function RegionEntry({ region, isOwner }: { region: RegionInfo; isOwner: boolean }) {
  const members = useGraphStore((s) => s.members);
  const setRegionMembers = useGraphStore((s) => s.setRegionMembers);
  const deleteRegion = useGraphStore((s) => s.deleteRegion);

  const toggle = (userId: string) => {
    const next = region.memberIds.includes(userId)
      ? region.memberIds.filter((id) => id !== userId)
      : [...region.memberIds, userId];
    setRegionMembers(region.id, next);
  };

  return (
    <li className="region-entry">
      <div className="region-entry-head">
        <span className="connection-dot" style={{ background: region.color }} />
        <strong>{region.name}</strong>
        {isOwner && (
          <button
            className="region-del"
            onClick={() => window.confirm(`"${region.name}" bölgesi silinsin mi?`) && deleteRegion(region.id)}
          >
            Sil
          </button>
        )}
      </div>
      {isOwner ? (
        <div className="region-member-picker">
          {members.map((m) => (
            <label key={m.userId} className="region-member-check">
              <input
                type="checkbox"
                checked={region.memberIds.includes(m.userId)}
                onChange={() => toggle(m.userId)}
              />
              {m.username}
            </label>
          ))}
        </div>
      ) : (
        <div className="region-entry-members">
          {region.memberNames.length > 0 ? `Yetkili: ${region.memberNames.join(', ')}` : 'Henüz kimse atanmadı'}
        </div>
      )}
    </li>
  );
}

export function RegionsPanel() {
  const regions = useGraphStore((s) => s.regions);
  const createRegion = useGraphStore((s) => s.createRegion);
  const setView = useGraphStore((s) => s.setView);
  const isOwner = useCanvasStore((s) => s.active?.role === 'owner');
  const [name, setName] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    // Staggered spawn point; the owner then drags/resizes it on the flow view.
    const i = regions.length;
    createRegion({
      name: name.trim(),
      x: 60 + i * 60, y: 60 + i * 60, width: 420, height: 300,
      color: COLORS[i % COLORS.length],
    });
    setName('');
    setView('flow');
  };

  return (
    <aside className="side-panel">
      <h3>Bölgeler ({regions.length})</h3>
      <p className="empty-note">
        Bölge, akış görünümünde bir dikdörtgen alandır: içindeki düğümleri yalnızca bölgeye atanan üyeler (ve kanvas
        sahibi) değiştirebilir.
      </p>
      {regions.length > 0 && (
        <ul className="region-list">
          {regions.map((r) => (
            <RegionEntry key={r.id} region={r} isOwner={isOwner} />
          ))}
        </ul>
      )}
      {isOwner ? (
        <form className="region-add" onSubmit={submit}>
          <h4>Bölge ekle</h4>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bölge adı…" maxLength={40} />
          <button type="submit" className="primary" disabled={!name.trim()}>
            + Ekle (akış görünümünde sürükleyip boyutlandırın)
          </button>
        </form>
      ) : (
        <p className="empty-note">Bölgeleri yalnızca kanvas sahibi tanımlar.</p>
      )}
    </aside>
  );
}
