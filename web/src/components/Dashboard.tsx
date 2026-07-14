import { useEffect, useState, type FormEvent } from 'react';
import type { CanvasInfo, GroupInfo, GroupMemberInfo } from '@treemapper/shared';
import { useCanvasStore } from '../store/canvasStore';
import { useGroupStore } from '../store/groupStore';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { canvasApi, ApiError } from '../api/client';

function CanvasCard({ canvas }: { canvas: CanvasInfo }) {
  const open = useCanvasStore((s) => s.open);
  const inviteLink = useCanvasStore((s) => s.inviteLink);
  const deleteCanvas = useCanvasStore((s) => s.deleteCanvas);
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    const url = await inviteLink(canvas.id);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Davet linkini kopyalayın:', url);
    }
  };

  return (
    <div className="canvas-card">
      <div className="canvas-card-body" onClick={() => open(canvas)}>
        <div className="canvas-card-name">{canvas.name}</div>
        <div className="canvas-card-meta">
          <span className="canvas-owner">
            {canvas.role === 'owner' ? 'sahibi sizsiniz' : `sahibi: ${canvas.owner}`}
          </span>
          <span>👥 {canvas.memberCount}</span>
          <span>#{canvas.headSeq} commit</span>
        </div>
        <div className="canvas-card-date">{new Date(canvas.createdAt).toLocaleDateString('tr-TR')}</div>
      </div>
      <div className="canvas-card-actions">
        <button className="primary" onClick={() => open(canvas)}>Aç</button>
        <button onClick={copyInvite} title="Bu kanvasa üye ekleme linki oluştur ve kopyala">
          {copied ? 'Kopyalandı ✓' : '🔗 Davet linki'}
        </button>
        {canvas.role === 'owner' && (
          <button
            className="danger-sm"
            title="Kanvası kalıcı olarak sil"
            onClick={() =>
              window.confirm(`"${canvas.name}" ve tüm geçmişi kalıcı olarak silinsin mi?`) && deleteCanvas(canvas.id)
            }
          >
            Sil
          </button>
        )}
      </div>
    </div>
  );
}

const groupRoleLabels: Record<string, string> = { admin: 'yönetici', member: 'üye' };

function GroupMembersPanel({ groupId }: { groupId: string }) {
  const loadMembers = useGroupStore((s) => s.loadMembers);
  const approveMember = useGroupStore((s) => s.approveMember);
  const setMemberRole = useGroupStore((s) => s.setMemberRole);
  const removeMember = useGroupStore((s) => s.removeMember);
  const loadGroups = useGroupStore((s) => s.loadGroups);
  const [members, setMembers] = useState<GroupMemberInfo[]>([]);

  const refresh = async () => setMembers(await loadMembers(groupId));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const pending = members.filter((m) => m.status === 'pending');
  const approved = members.filter((m) => m.status === 'approved');

  return (
    <div className="group-members">
      {pending.length > 0 && (
        <>
          <h5>Onay bekleyenler ({pending.length})</h5>
          <ul className="member-list">
            {pending.map((m) => (
              <li key={m.userId} className="member-item">
                <span className="member-name">
                  {m.username}
                  {m.jobTitle && <em> — {m.jobTitle}</em>}
                </span>
                <span className="member-actions">
                  <button
                    className="primary"
                    onClick={async () => {
                      await approveMember(groupId, m.userId);
                      await refresh();
                      loadGroups();
                    }}
                  >
                    Onayla
                  </button>
                  <button
                    onClick={async () => {
                      await removeMember(groupId, m.userId);
                      await refresh();
                      loadGroups();
                    }}
                  >
                    Reddet
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h5>Üyeler ({approved.length})</h5>
      <ul className="member-list">
        {approved.map((m) => (
          <li key={m.userId} className="member-item">
            <span className="member-name">
              {m.username}
              {m.jobTitle && <em> — {m.jobTitle}</em>}
            </span>
            <span className="member-actions">
              <select
                value={m.role}
                onChange={async (e) => {
                  await setMemberRole(groupId, m.userId, e.target.value as 'admin' | 'member');
                  await refresh();
                }}
              >
                <option value="admin">yönetici</option>
                <option value="member">üye</option>
              </select>
              <button
                onClick={async () => {
                  await removeMember(groupId, m.userId);
                  await refresh();
                  loadGroups();
                }}
              >
                Çıkar
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroupCard({ group }: { group: GroupInfo }) {
  const inviteLink = useGroupStore((s) => s.inviteLink);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isAdmin = group.myRole === 'admin';

  const copyInvite = async () => {
    const url = await inviteLink(group.id);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Davet linkini kopyalayın:', url);
    }
  };

  return (
    <div className="group-card">
      <div className="group-card-head">
        <span className="group-card-name">{group.name}</span>
        <span className={`role-badge role-${group.myRole === 'admin' ? 'owner' : 'viewer'}`}>
          {groupRoleLabels[group.myRole]}
        </span>
        <span className="group-card-meta">👥 {group.memberCount} · 🗂 {group.canvasCount} kanvas</span>
        {isAdmin && group.pendingCount > 0 && (
          <span className="role-badge role-owner">{group.pendingCount} onay bekliyor</span>
        )}
        {isAdmin && (
          <button onClick={copyInvite} title="Bu gruba üye ekleme linki oluştur ve kopyala">
            {copied ? 'Kopyalandı ✓' : '🔗 Davet'}
          </button>
        )}
        {isAdmin && (
          <button onClick={() => setExpanded(!expanded)}>{expanded ? 'Üyeleri gizle' : 'Üyeleri yönet'}</button>
        )}
      </div>
      {isAdmin && expanded && <GroupMembersPanel groupId={group.id} />}
    </div>
  );
}

function GroupsSection() {
  const groups = useGroupStore((s) => s.groups);
  const createGroup = useGroupStore((s) => s.createGroup);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const group = await createGroup(name.trim());
    setBusy(false);
    if (group) setName('');
  };

  return (
    <div className="groups-section">
      <h2>Gruplarım</h2>
      <form className="canvas-create" onSubmit={submit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Yeni grup adı…"
          maxLength={80}
        />
        <button type="submit" className="login-btn" disabled={!name.trim() || busy}>
          + Grup oluştur
        </button>
      </form>
      {groups.length === 0 ? (
        <p className="empty-note">
          Henüz bir grubunuz yok. Bir grup oluşturun ve davet linkiyle ekip arkadaşlarınızı davet edin — onayladığınız
          üyeler grubun tüm kanvaslarına editör olarak erişebilir.
        </p>
      ) : (
        <div className="group-list-grid">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function UserSettings() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const [openSection, setOpenSection] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submitProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileBusy(true);
    setProfileMsg(null);
    const ok = await updateProfile({ displayName, avatarUrl });
    setProfileMsg(ok ? { ok: true, text: 'Profiliniz güncellendi.' } : { ok: false, text: 'Güncellenemedi.' });
    setProfileBusy(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await canvasApi.changePassword(current, next);
      setMsg({ ok: true, text: 'Şifreniz güncellendi (diğer oturumlar kapatıldı).' });
      setCurrent('');
      setNext('');
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) });
    }
    setBusy(false);
  };

  return (
    <div className="user-settings">
      <button className="settings-toggle" onClick={() => setOpenSection(!openSection)}>
        ⚙ Kullanıcı ayarları {openSection ? '▴' : '▾'}
      </button>
      {openSection && (
        <>
          <form className="settings-form" onSubmit={submitProfile}>
            <h4>Profil</h4>
            <div className="profile-avatar-row">
              {avatarUrl
                ? <img className="user-avatar-preview" src={avatarUrl} alt="" />
                : <span className="user-avatar-preview placeholder">{(displayName || user?.username || '?').slice(0, 2).toUpperCase()}</span>}
              <input
                placeholder="Profil fotoğrafı URL'si (https://…)" value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
              />
            </div>
            <input
              placeholder={`Görünen ad (varsayılan: ${user?.username})`} value={displayName}
              onChange={(e) => setDisplayName(e.target.value)} maxLength={60}
            />
            <button type="submit" className="login-btn" disabled={profileBusy}>Kaydet</button>
            {profileMsg && <div className={profileMsg.ok ? 'settings-ok' : 'login-error'}>{profileMsg.text}</div>}
          </form>
          <form className="settings-form" onSubmit={submit}>
            <h4>Şifre değiştir</h4>
            <input
              type="password" placeholder="Mevcut şifre" value={current} autoComplete="current-password"
              onChange={(e) => setCurrent(e.target.value)}
            />
            <input
              type="password" placeholder="Yeni şifre (en az 4 karakter)" value={next} autoComplete="new-password"
              onChange={(e) => setNext(e.target.value)}
            />
            <button type="submit" className="login-btn" disabled={busy || !current || next.length < 4}>
              Şifreyi güncelle
            </button>
            {msg && <div className={msg.ok ? 'settings-ok' : 'login-error'}>{msg.text}</div>}
          </form>
        </>
      )}
    </div>
  );
}

export function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const canvases = useCanvasStore((s) => s.canvases);
  const listLoaded = useCanvasStore((s) => s.listLoaded);
  const loadList = useCanvasStore((s) => s.loadList);
  const createCanvas = useCanvasStore((s) => s.createCanvas);
  const open = useCanvasStore((s) => s.open);
  const error = useCanvasStore((s) => s.error);
  const clearError = useCanvasStore((s) => s.clearError);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const groups = useGroupStore((s) => s.groups);
  const groupsLoaded = useGroupStore((s) => s.listLoaded);
  const loadGroups = useGroupStore((s) => s.loadGroups);

  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadList();
    loadGroups();
  }, [loadList, loadGroups]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const canvas = await createCanvas(name.trim(), groupId || undefined);
    setBusy(false);
    if (canvas) {
      setName('');
      setGroupId('');
      open(canvas); // jump straight into the freshly created canvas
    }
  };

  if (!listLoaded || !groupsLoaded) return <div className="loading">Yükleniyor…</div>;

  const adminGroups = groups.filter((g) => g.myRole === 'admin');
  const folders = new Map<string, { name: string; canvases: CanvasInfo[] }>();
  const ungrouped: CanvasInfo[] = [];
  for (const c of canvases) {
    if (c.groupId) {
      if (!folders.has(c.groupId)) folders.set(c.groupId, { name: c.groupName ?? '', canvases: [] });
      folders.get(c.groupId)!.canvases.push(c);
    } else {
      ungrouped.push(c);
    }
  }

  return (
    <div className="dashboard">
      <div className="toolbar">
        <span className="brand"><span className="brand-mark">✱</span> co-pronoia</span>
        <div className="toolbar-right">
          <span className="user-chip">
            {user?.avatarUrl && <img className="user-avatar" src={user.avatarUrl} alt="" />}
            {user?.displayName || user?.username}
          </span>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Aydınlık moda geç' : 'Karanlık moda geç'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button onClick={logout} title="Oturumu kapat">Çıkış</button>
        </div>
      </div>
      <div className="dashboard-body">
        <h2>Kanvaslarım</h2>
        <form className="canvas-create" onSubmit={submit}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={canvases.length === 0 ? 'İlk kanvasınızın adı…' : 'Yeni kanvas adı…'}
            maxLength={80}
          />
          {adminGroups.length > 0 && (
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Grup (opsiyonel)</option>
              {adminGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}
          <button type="submit" className="login-btn" disabled={!name.trim() || busy}>
            + Kanvas oluştur
          </button>
        </form>
        {canvases.length === 0 ? (
          <p className="empty-note">
            Henüz bir kanvasınız yok. Yukarıdan ilk kanvasınızı oluşturun; başkalarının kanvasına yalnızca size
            gönderilen bir davet linkiyle katılabilirsiniz.
          </p>
        ) : (
          <>
            {[...folders.entries()].map(([gid, folder]) => (
              <details key={gid} open className="canvas-folder">
                <summary>📁 {folder.name} ({folder.canvases.length})</summary>
                <div className="canvas-grid">
                  {folder.canvases.map((c) => (
                    <CanvasCard key={c.id} canvas={c} />
                  ))}
                </div>
              </details>
            ))}
            {ungrouped.length > 0 && (
              <details open className="canvas-folder">
                <summary>📄 Grupsuz ({ungrouped.length})</summary>
                <div className="canvas-grid">
                  {ungrouped.map((c) => (
                    <CanvasCard key={c.id} canvas={c} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
        <GroupsSection />
        <UserSettings />
      </div>
      {error && (
        <div className="error-toast" onClick={clearError}>
          ⚠ {error} <small>(kapatmak için tıkla)</small>
        </div>
      )}
    </div>
  );
}
