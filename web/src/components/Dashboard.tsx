import { useEffect, useState, type FormEvent } from 'react';
import type { CanvasAccess, CanvasInfo, CanvasType, GroupInfo, GroupMemberInfo, GroupRoleDefInfo, GroupType } from '@treemapper/shared';
import { useCanvasStore } from '../store/canvasStore';
import { useGroupStore } from '../store/groupStore';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { useAdminStore } from '../store/adminStore';
import { canvasApi, groupApi, ApiError, type RoleDefInput } from '../api/client';
import { AgentRoleEditor } from './AgentRoleEditor';
import { Brand } from './Logo';

const accessLabels: Record<CanvasAccess, string> = { none: 'erişim yok', view: 'görüntüleme', edit: 'düzenleme' };

/** Grup kanvasının rol bazlı erişim ayarları (yalnızca kanvas sahibine görünür). */
function CanvasRoleAccessPanel({ canvas }: { canvas: CanvasInfo }) {
  const [roles, setRoles] = useState<GroupRoleDefInfo[]>([]);
  const [overrides, setOverrides] = useState<Record<string, CanvasAccess | ''>>({});

  useEffect(() => {
    if (!canvas.groupId) return;
    groupApi.roles(canvas.groupId).then(({ roles }) => setRoles(roles)).catch(() => setRoles([]));
    canvasApi.getRoleAccess(canvas.id).then(({ access }) => {
      const map: Record<string, CanvasAccess | ''> = {};
      for (const a of access) map[a.roleId] = a.access;
      setOverrides(map);
    }).catch(() => {});
  }, [canvas.groupId, canvas.id]);

  if (roles.length === 0) return <p className="empty-note">Bu grupta tanımlı özel rol yok.</p>;

  return (
    <ul className="member-list">
      {roles.map((r) => (
        <li key={r.id} className="member-item">
          <span className="member-name">{r.name}</span>
          <span className="member-actions">
            <select
              value={overrides[r.id] ?? ''}
              onChange={async (e) => {
                const v = e.target.value as CanvasAccess | '';
                setOverrides((o) => ({ ...o, [r.id]: v }));
                try {
                  await canvasApi.setRoleAccess(canvas.id, r.id, v === '' ? null : v);
                } catch {
                  setOverrides((o) => ({ ...o, [r.id]: '' }));
                }
              }}
            >
              <option value="">varsayılan ({accessLabels[r.defaultCanvasAccess]})</option>
              <option value="edit">düzenleme</option>
              <option value="view">görüntüleme</option>
              <option value="none">erişim yok</option>
            </select>
          </span>
        </li>
      ))}
    </ul>
  );
}

function CanvasCard({ canvas }: { canvas: CanvasInfo }) {
  const open = useCanvasStore((s) => s.open);
  const inviteLink = useCanvasStore((s) => s.inviteLink);
  const deleteCanvas = useCanvasStore((s) => s.deleteCanvas);
  const [copied, setCopied] = useState(false);
  const [showAccess, setShowAccess] = useState(false);

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
        <div className="canvas-card-name">
          {canvas.name}
          {canvas.type === 'co-pronoia' && (
            <span className="role-badge role-owner" title="MCP ajanlarının öneri/süpervizör akışıyla planladığı kanvas">
              🤝 Co-Pronoia
            </span>
          )}
        </div>
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
        {canvas.role === 'owner' && canvas.groupId && (
          <button onClick={() => setShowAccess(!showAccess)} title="Grup rollerinin bu kanvasa erişimini ayarla">
            🔐 Erişim
          </button>
        )}
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
      {showAccess && canvas.groupId && <CanvasRoleAccessPanel canvas={canvas} />}
    </div>
  );
}

const groupRoleLabels: Record<string, string> = { admin: 'yönetici', member: 'üye' };

/** Tek bir rol tanımı satırı: isim + yetki kutuları. Hem grup kurarken hem sonradan düzenlerken kullanılır. */
function RoleDefRow({
  value, onChange, onRemove,
}: {
  value: RoleDefInput;
  onChange: (next: RoleDefInput) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="role-def-row">
      <input
        placeholder="Rol adı (ör. Tasarımcı)"
        value={value.name}
        maxLength={60}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <select
        value={value.defaultCanvasAccess ?? 'edit'}
        title="Grubun kanvaslarına varsayılan erişim"
        onChange={(e) => onChange({ ...value, defaultCanvasAccess: e.target.value as CanvasAccess })}
      >
        <option value="edit">kanvas: düzenleme</option>
        <option value="view">kanvas: görüntüleme</option>
        <option value="none">kanvas: erişim yok</option>
      </select>
      <label className="role-def-check" title="Üyeleri onaylayabilir, çıkarabilir, davet edebilir">
        <input
          type="checkbox"
          checked={value.canManageMembers ?? false}
          onChange={(e) => onChange({ ...value, canManageMembers: e.target.checked })}
        />
        üye yönetimi
      </label>
      <label className="role-def-check" title="Rolleri ve erişimleri düzenleyebilir">
        <input
          type="checkbox"
          checked={value.canManageRoles ?? false}
          onChange={(e) => onChange({ ...value, canManageRoles: e.target.checked })}
        />
        rol yönetimi
      </label>
      <label className="role-def-check" title="Grup içinde yeni kanvas açabilir">
        <input
          type="checkbox"
          checked={value.canCreateCanvas ?? true}
          onChange={(e) => onChange({ ...value, canCreateCanvas: e.target.checked })}
        />
        kanvas açma
      </label>
      {onRemove && (
        <button type="button" className="region-del" onClick={onRemove}>Sil</button>
      )}
    </div>
  );
}

/** Grubun özel rollerini listeler/düzenler (admin ya da rol yönetme yetkisi olanlar). */
function GroupRolesPanel({ groupId }: { groupId: string }) {
  const [roles, setRoles] = useState<GroupRoleDefInfo[]>([]);
  const [draft, setDraft] = useState<RoleDefInput>({ name: '', defaultCanvasAccess: 'edit', canCreateCanvas: true });
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    groupApi.roles(groupId).then(({ roles }) => setRoles(roles)).catch(() => setRoles([]));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const saveExisting = async (role: GroupRoleDefInfo, patch: Partial<RoleDefInput>) => {
    try {
      await groupApi.updateRole(groupId, role.id, patch);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <div className="group-roles">
      <h5>Roller ({roles.length})</h5>
      {roles.map((r) => (
        <RoleDefRow
          key={r.id}
          value={r}
          onChange={(next) => saveExisting(r, next)}
          onRemove={async () => {
            if (!window.confirm(`"${r.name}" rolü silinsin mi? Bu roldeki üyeler rolsüz kalır.`)) return;
            try {
              await groupApi.deleteRole(groupId, r.id);
              await refresh();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : String(err));
            }
          }}
        />
      ))}
      <div className="role-def-add">
        <RoleDefRow value={draft} onChange={setDraft} />
        <button
          type="button"
          className="primary"
          disabled={!draft.name.trim()}
          onClick={async () => {
            try {
              await groupApi.createRole(groupId, draft);
              setDraft({ name: '', defaultCanvasAccess: 'edit', canCreateCanvas: true });
              await refresh();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : String(err));
            }
          }}
        >
          + Rol ekle
        </button>
      </div>
      {error && <div className="login-error" onClick={() => setError(null)}>{error}</div>}
    </div>
  );
}

function GroupMembersPanel({ groupId }: { groupId: string }) {
  const loadMembers = useGroupStore((s) => s.loadMembers);
  const approveMember = useGroupStore((s) => s.approveMember);
  const setMemberRole = useGroupStore((s) => s.setMemberRole);
  const removeMember = useGroupStore((s) => s.removeMember);
  const loadGroups = useGroupStore((s) => s.loadGroups);
  const [members, setMembers] = useState<GroupMemberInfo[]>([]);
  const [roles, setRoles] = useState<GroupRoleDefInfo[]>([]);

  const refresh = async () => setMembers(await loadMembers(groupId));

  useEffect(() => {
    refresh();
    groupApi.roles(groupId).then(({ roles }) => setRoles(roles)).catch(() => setRoles([]));
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
              {m.role !== 'admin' && roles.length > 0 && (
                <select
                  value={m.roleDefId ?? ''}
                  title="Özel rol ata"
                  onChange={async (e) => {
                    await groupApi.setMemberRoleDef(groupId, m.userId, e.target.value || null);
                    await refresh();
                  }}
                >
                  <option value="">rol yok</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              )}
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
  const [showRoles, setShowRoles] = useState(false);
  const [showAgentRoles, setShowAgentRoles] = useState(false);
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
        {group.type === 'co-pronoia' && (
          <span className="role-badge role-owner" title="Bu grupta Co-Pronoia (MCP çoklu-ajan) kanvasları açılabilir">
            🤝 Co-Pronoia
          </span>
        )}
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
        {isAdmin && (
          <button onClick={() => setShowRoles(!showRoles)}>{showRoles ? 'Rolleri gizle' : 'Rolleri yönet'}</button>
        )}
        {isAdmin && group.type === 'co-pronoia' && (
          <button
            onClick={() => setShowAgentRoles(!showAgentRoles)}
            title="Bu grubun Co-Pronoia kanvaslarında kullanılacak ajan rollerini tanımla"
          >
            {showAgentRoles ? 'Ajan rollerini gizle' : '🤝 Ajan rolleri'}
          </button>
        )}
      </div>
      {isAdmin && expanded && <GroupMembersPanel groupId={group.id} />}
      {isAdmin && showRoles && <GroupRolesPanel groupId={group.id} />}
      {isAdmin && showAgentRoles && group.type === 'co-pronoia' && (
        <AgentRoleEditor api={groupApi.agentRoles(group.id)} title="Grup ajan rolleri" />
      )}
    </div>
  );
}

function GroupsSection() {
  const groups = useGroupStore((s) => s.groups);
  const createGroup = useGroupStore((s) => s.createGroup);
  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('plan');
  const [busy, setBusy] = useState(false);
  const [draftRoles, setDraftRoles] = useState<RoleDefInput[]>([]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const group = await createGroup(name.trim(), draftRoles.filter((r) => r.name.trim()), type);
    setBusy(false);
    if (group) {
      setName('');
      setType('plan');
      setDraftRoles([]);
    }
  };

  return (
    <div className="groups-section">
      <h2>Gruplarım</h2>
      <form className="canvas-create-block" onSubmit={submit}>
        <div className="canvas-create">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Yeni grup adı…"
            maxLength={80}
          />
          <select
            value={type}
            title="Co-Pronoia gruplarında MCP ajanlarının öneri/süpervizör akışıyla planladığı kanvaslar açılabilir"
            onChange={(e) => setType(e.target.value as GroupType)}
          >
            <option value="plan">Normal grup</option>
            <option value="co-pronoia">Co-Pronoia grubu</option>
          </select>
          <button
            type="button"
            className="pano-btn"
            onClick={() => setDraftRoles((r) => [...r, { name: '', defaultCanvasAccess: 'edit', canCreateCanvas: true }])}
          >
            + Rol tanımla
          </button>
          <button type="submit" className="login-btn" disabled={!name.trim() || busy}>
            + Grup oluştur
          </button>
        </div>
        {draftRoles.map((r, i) => (
          <RoleDefRow
            key={i}
            value={r}
            onChange={(next) => setDraftRoles((all) => all.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setDraftRoles((all) => all.filter((_, j) => j !== i))}
          />
        ))}
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
  const setAdminOpen = useAdminStore((s) => s.setOpen);

  const groups = useGroupStore((s) => s.groups);
  const groupsLoaded = useGroupStore((s) => s.listLoaded);
  const loadGroups = useGroupStore((s) => s.loadGroups);

  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [canvasType, setCanvasType] = useState<CanvasType>('plan');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadList();
    loadGroups();
  }, [loadList, loadGroups]);

  // Her kanvas bir gruba bağlı olmalı; oluşturma yetkisi admin ya da rolün canCreateCanvas'ı.
  const creatableGroups = groups.filter((g) => g.canCreateCanvas);
  const effectiveGroupId = groupId || creatableGroups[0]?.id || '';
  // Co-pronoia kanvası yalnızca co-pronoia grubunda açılabilir; başka grup seçilince tür sıfırlanır.
  const selectedGroup = creatableGroups.find((g) => g.id === effectiveGroupId);
  const effectiveCanvasType = selectedGroup?.type === 'co-pronoia' ? canvasType : 'plan';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy || !effectiveGroupId) return;
    setBusy(true);
    const canvas = await createCanvas(name.trim(), effectiveGroupId, effectiveCanvasType);
    setBusy(false);
    if (canvas) {
      setName('');
      setGroupId('');
      setCanvasType('plan');
      open(canvas); // jump straight into the freshly created canvas
    }
  };

  if (!listLoaded || !groupsLoaded) return <div className="loading">Yükleniyor…</div>;
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
        <span className="brand"><Brand /></span>
        <div className="toolbar-right">
          <span className="user-chip">
            {user?.avatarUrl && <img className="user-avatar" src={user.avatarUrl} alt="" />}
            {user?.displayName || user?.username}
          </span>
          {user?.isAdmin && (
            <button onClick={() => setAdminOpen(true)} title="Site yönetim paneli">🛡 Yönetim</button>
          )}
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
        {creatableGroups.length > 0 ? (
          <form className="canvas-create" onSubmit={submit}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={canvases.length === 0 ? 'İlk kanvasınızın adı…' : 'Yeni kanvas adı…'}
              maxLength={80}
            />
            <select value={effectiveGroupId} onChange={(e) => setGroupId(e.target.value)}>
              {creatableGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            {selectedGroup?.type === 'co-pronoia' && (
              <select
                value={effectiveCanvasType}
                title="Co-Pronoia kanvasında MCP ajanları öneri verir, süpervizör ajan onaylar"
                onChange={(e) => setCanvasType(e.target.value as CanvasType)}
              >
                <option value="plan">Normal kanvas</option>
                <option value="co-pronoia">Co-Pronoia kanvası</option>
              </select>
            )}
            <button type="submit" className="login-btn" disabled={!name.trim() || busy || !effectiveGroupId}>
              + Kanvas oluştur
            </button>
          </form>
        ) : (
          <p className="empty-note">
            Her kanvas bir gruba bağlıdır. Kanvas oluşturmak için önce aşağıdan bir grup kurun ya da kanvas
            oluşturma yetkisi olan bir gruba katılın.
          </p>
        )}
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
