import { useGraphStore } from '../store/graphStore';
import { useCanvasStore } from '../store/canvasStore';
import { useAuthStore } from '../store/authStore';

const roleLabels: Record<string, string> = { owner: 'sahip', editor: 'editör', viewer: 'görüntüleyici' };

export function MembersPanel() {
  const members = useGraphStore((s) => s.members);
  const activeUsers = useGraphStore((s) => s.activeUsers);
  const setMemberRole = useGraphStore((s) => s.setMemberRole);
  const removeMember = useGraphStore((s) => s.removeMember);
  const isOwner = useCanvasStore((s) => s.active?.role === 'owner');
  const me = useAuthStore((s) => s.user);

  return (
    <aside className="side-panel">
      <h3>Üyeler ({members.length})</h3>
      <p className="empty-note">Yeşil nokta = şu anda kanvasta aktif.</p>
      <ul className="member-list">
        {members.map((m) => {
          const online = activeUsers.includes(m.username);
          return (
            <li key={m.userId} className="member-item">
              <span className={`member-dot ${online ? 'on' : 'off'}`} title={online ? 'aktif' : 'çevrimdışı'} />
              <span className="member-name">
                {m.username}
                {m.userId === me?.id && ' (siz)'}
              </span>
              {isOwner && m.role !== 'owner' ? (
                <span className="member-actions">
                  <select
                    value={m.role}
                    onChange={(e) => setMemberRole(m.userId, e.target.value as 'editor' | 'viewer')}
                    title="Rol ata"
                  >
                    <option value="editor">editör</option>
                    <option value="viewer">görüntüleyici</option>
                  </select>
                  <button
                    onClick={() =>
                      window.confirm(`${m.username} kanvastan çıkarılsın mı?`) && removeMember(m.userId)
                    }
                  >
                    Çıkar
                  </button>
                </span>
              ) : (
                <span className={`role-badge role-${m.role}`}>{roleLabels[m.role] ?? m.role}</span>
              )}
            </li>
          );
        })}
      </ul>
      {!isOwner && <p className="empty-note">Rol atama ve üye çıkarma yalnızca kanvas sahibine açıktır.</p>}
    </aside>
  );
}
