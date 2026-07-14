import { useEffect, useState, type FormEvent } from 'react';
import type { GroupRoleDefInfo, RegionInfo } from '@treemapper/shared';
import { useGraphStore } from '../store/graphStore';
import { useCanvasStore } from '../store/canvasStore';
import { groupApi } from '../api/client';

const COLORS = ['#d97757', '#3b6fe0', '#7a4dc9', '#1e7a2e', '#b3261e', '#0e7f86'];

function RegionEntry({
  region, isOwner, groupRoles,
}: {
  region: RegionInfo;
  isOwner: boolean;
  groupRoles: GroupRoleDefInfo[];
}) {
  const members = useGraphStore((s) => s.members);
  const setRegionMembers = useGraphStore((s) => s.setRegionMembers);
  const deleteRegion = useGraphStore((s) => s.deleteRegion);

  const toggleUser = (userId: string) => {
    const next = region.directMemberIds.includes(userId)
      ? region.directMemberIds.filter((id) => id !== userId)
      : [...region.directMemberIds, userId];
    setRegionMembers(region.id, next, region.roleIds);
  };

  const toggleRole = (roleId: string) => {
    const next = region.roleIds.includes(roleId)
      ? region.roleIds.filter((id) => id !== roleId)
      : [...region.roleIds, roleId];
    setRegionMembers(region.id, region.directMemberIds, next);
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
        <>
          {groupRoles.length > 0 && (
            <>
              <div className="region-picker-label">Erişimli roller</div>
              <div className="region-member-picker">
                {groupRoles.map((r) => (
                  <label key={r.id} className="region-member-check">
                    <input
                      type="checkbox"
                      checked={region.roleIds.includes(r.id)}
                      onChange={() => toggleRole(r.id)}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="region-picker-label">Erişimli kullanıcılar</div>
          <div className="region-member-picker">
            {members.map((m) => (
              <label key={m.userId} className="region-member-check">
                <input
                  type="checkbox"
                  checked={region.directMemberIds.includes(m.userId)}
                  onChange={() => toggleUser(m.userId)}
                />
                {m.username}
              </label>
            ))}
          </div>
        </>
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
  const active = useCanvasStore((s) => s.active);
  const isOwner = active?.role === 'owner';
  const [name, setName] = useState('');
  const [groupRoles, setGroupRoles] = useState<GroupRoleDefInfo[]>([]);

  useEffect(() => {
    if (!active?.groupId || !isOwner) {
      setGroupRoles([]);
      return;
    }
    groupApi.roles(active.groupId).then(({ roles }) => setGroupRoles(roles)).catch(() => setGroupRoles([]));
  }, [active?.groupId, isOwner]);

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
        Bölge, akış görünümünde bir dikdörtgen alandır: içindeki düğümleri yalnızca bölgeye atanan üyeler ve roller (ve
        kanvas sahibi) değiştirebilir.
      </p>
      {regions.length > 0 && (
        <ul className="region-list">
          {regions.map((r) => (
            <RegionEntry key={r.id} region={r} isOwner={isOwner} groupRoles={groupRoles} />
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
