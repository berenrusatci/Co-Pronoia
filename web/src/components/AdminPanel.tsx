import { useEffect, useState, type FormEvent } from 'react';
import type {
  AdminCanvasInfo, AdminGroupInfo, AdminStats, AdminUserInfo, GroupMemberInfo, MemberInfo,
} from '@treemapper/shared';
import { adminApi, ApiError, siteApi } from '../api/client';
import { useAdminStore } from '../store/adminStore';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';

type AdminTab = 'overview' | 'users' | 'canvases' | 'groups' | 'appearance';

const errText = (err: unknown) => (err instanceof ApiError ? err.message : String(err));
const trDate = (iso: string) => new Date(iso).toLocaleDateString('tr-TR');

/** 300ms debounce'lu arama girdisi — her sekmenin liste sorgusunu besler. */
function useDebounced(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ---------- Genel Bakış ----------

function StatsSection({ onError }: { onError: (msg: string) => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    adminApi.stats().then(({ stats }) => setStats(stats)).catch((err) => onError(errText(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!stats) return <div className="loading">Yükleniyor…</div>;

  const cards: Array<[string, number]> = [
    ['Kullanıcı', stats.userCount],
    ['Kanvas', stats.canvasCount],
    ['Grup', stats.groupCount],
    ['Commit', stats.commitCount],
    ['Aktif oturum', stats.activeSessionCount],
    ['Son 7 günde kayıt', stats.newUsers7d],
  ];
  return (
    <div className="stat-grid">
      {cards.map(([label, value]) => (
        <div key={label} className="stat-card">
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Kullanıcılar ----------

function UserRow({
  user, selfId, onChanged, onError,
}: {
  user: AdminUserInfo;
  selfId: string;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const self = user.id === selfId;

  const run = async (fn: () => Promise<unknown>, doneNote?: string) => {
    try {
      await fn();
      if (doneNote) setNotice(doneNote);
      onChanged();
    } catch (err) {
      onError(errText(err));
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 4) return;
    run(async () => {
      await adminApi.setUserPassword(user.id, pw);
      setPw('');
      setPwOpen(false);
    }, 'Şifre atandı; kullanıcının tüm oturumları kapatıldı.');
  };

  return (
    <li className="member-item admin-user-row">
      <span className="member-name">
        {user.username}
        {(user.displayName || user.email) && (
          <em> — {[user.displayName, user.email].filter(Boolean).join(' · ')}</em>
        )}
        {user.isAdmin && <span className="role-badge role-owner">yönetici</span>}
        {user.hasGoogle && !user.hasPassword && <span className="role-badge role-viewer">Google</span>}
        {self && <span className="role-badge role-viewer">siz</span>}
        <span className="admin-user-meta">
          {user.ownedCanvasCount} kanvas sahibi · {user.membershipCount} üyelik · {user.groupCount} grup ·{' '}
          {user.sessionCount} oturum · son commit: {user.lastCommitAt ? trDate(user.lastCommitAt) : '—'} · kayıt:{' '}
          {trDate(user.createdAt)}
        </span>
        {notice && <span className="settings-ok" onClick={() => setNotice(null)}>{notice}</span>}
      </span>
      <span className="member-actions">
        {/* Yönetici hesapları dokunulmazdır: yetki kaldırma / şifre atama / silme sunucuda
            reddedilir, butonları hiç gösterme (şifresini herkes kendi ayarlarından değiştirir). */}
        {!self && !user.isAdmin && (
          <button
            onClick={() => {
              const q = `"${user.username}" kullanıcısına site yöneticisi yetkisi verilsin mi? Bu yetki daha sonra kaldırılamaz.`;
              if (window.confirm(q)) run(() => adminApi.setUserAdmin(user.id, true));
            }}
          >
            Yönetici yap
          </button>
        )}
        {!user.isAdmin && (
          <button
            onClick={() => setPwOpen(!pwOpen)}
            title={user.hasPassword ? 'Kullanıcıya yeni şifre ata' : 'Google hesabına şifreyle giriş imkânı ekler'}
          >
            {user.hasPassword ? 'Şifre ata' : 'Şifre oluştur'}
          </button>
        )}
        {!self && (
          <button
            onClick={() => {
              if (window.confirm(`"${user.username}" kullanıcısının tüm oturumları kapatılsın mı?`))
                run(() => adminApi.revokeSessions(user.id), 'Tüm oturumlar kapatıldı.');
            }}
          >
            Oturumları kapat
          </button>
        )}
        {!self && !user.isAdmin && (
          <button
            className="danger-sm"
            onClick={() => {
              const warn =
                `"${user.username}" kalıcı olarak silinsin mi?\n\n` +
                `Sahibi olduğu ${user.ownedCanvasCount} kanvas ve tüm içerikleri de silinir. Bu işlem geri alınamaz.`;
              if (window.confirm(warn)) run(() => adminApi.deleteUser(user.id));
            }}
          >
            Sil
          </button>
        )}
      </span>
      {pwOpen && (
        <form className="admin-inline-form" onSubmit={submitPassword}>
          <input
            type="password"
            placeholder="Yeni şifre (en az 4 karakter)"
            value={pw}
            autoComplete="new-password"
            onChange={(e) => setPw(e.target.value)}
          />
          <button type="submit" className="primary" disabled={pw.length < 4}>Kaydet</button>
          <button type="button" onClick={() => { setPwOpen(false); setPw(''); }}>Vazgeç</button>
        </form>
      )}
    </li>
  );
}

function UsersSection({ selfId, onError }: { selfId: string; onError: (msg: string) => void }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [users, setUsers] = useState<AdminUserInfo[] | null>(null);

  const refresh = () =>
    adminApi.users(query).then(({ users }) => setUsers(users)).catch((err) => onError(errText(err)));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (!users) return <div className="loading">Yükleniyor…</div>;

  return (
    <>
      <input
        className="admin-search"
        placeholder="Kullanıcı ara (ad, e-posta)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {users.length === 0 ? (
        <p className="empty-note">Eşleşen kullanıcı yok.</p>
      ) : (
        <ul className="member-list">
          {users.map((u) => (
            <UserRow key={u.id} user={u} selfId={selfId} onChanged={refresh} onError={onError} />
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- Kanvaslar ----------

function CanvasMembersList({ canvasId, onError }: { canvasId: string; onError: (msg: string) => void }) {
  const [members, setMembers] = useState<MemberInfo[] | null>(null);

  useEffect(() => {
    adminApi.canvasMembers(canvasId).then(({ members }) => setMembers(members)).catch((err) => onError(errText(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId]);

  if (!members) return <div className="loading">Yükleniyor…</div>;

  return (
    <ul className="member-list">
      {members.map((m) => (
        <li key={m.userId} className="member-item">
          <span className="member-name">
            {m.username}
            {m.role === 'owner' && <span className="role-badge role-owner">sahip</span>}
          </span>
          {m.role !== 'owner' && (
            <span className="member-actions">
              <select
                value={m.role}
                onChange={async (e) => {
                  try {
                    const { members } = await adminApi.setCanvasMemberRole(
                      canvasId, m.userId, e.target.value as 'editor' | 'viewer',
                    );
                    setMembers(members);
                  } catch (err) {
                    onError(errText(err));
                  }
                }}
              >
                <option value="editor">editör</option>
                <option value="viewer">görüntüleyici</option>
              </select>
              <button
                onClick={async () => {
                  if (!window.confirm(`"${m.username}" kanvastan çıkarılsın mı?`)) return;
                  try {
                    const { members } = await adminApi.removeCanvasMember(canvasId, m.userId);
                    setMembers(members);
                  } catch (err) {
                    onError(errText(err));
                  }
                }}
              >
                Çıkar
              </button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function AdminCanvasCard({
  canvas, onChanged, onError,
}: {
  canvas: AdminCanvasInfo;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [showMembers, setShowMembers] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="canvas-card">
      {/* Bilinçli olarak "Aç" yok: yönetici kanvas içeriğini göremez, yalnızca metadata yönetir. */}
      <div className="canvas-card-body">
        <div className="canvas-card-name">{canvas.name}</div>
        <div className="canvas-card-meta">
          <span className="canvas-owner">sahibi: {canvas.owner}</span>
          <span>👥 {canvas.memberCount}</span>
          <span>#{canvas.commitCount} commit</span>
          {canvas.groupName && <span>📁 {canvas.groupName}</span>}
        </div>
        <div className="canvas-card-date">{trDate(canvas.createdAt)}</div>
      </div>
      <div className="canvas-card-actions">
        <button onClick={() => setShowMembers(!showMembers)}>
          {showMembers ? 'Üyeleri gizle' : 'Üyeler'}
        </button>
        <button
          title="Bu kanvasın tüm açık davet linklerini geçersiz kıl"
          onClick={async () => {
            if (!window.confirm(`"${canvas.name}" kanvasının tüm davet linkleri iptal edilsin mi?`)) return;
            try {
              const { deleted } = await adminApi.revokeCanvasInvites(canvas.id);
              setNotice(`${deleted} davet silindi.`);
            } catch (err) {
              onError(errText(err));
            }
          }}
        >
          Davetleri iptal et
        </button>
        <button
          className="danger-sm"
          title="Kanvası kalıcı olarak sil"
          onClick={async () => {
            if (!window.confirm(`"${canvas.name}" ve tüm geçmişi kalıcı olarak silinsin mi?`)) return;
            try {
              await adminApi.deleteCanvas(canvas.id);
              onChanged();
            } catch (err) {
              onError(errText(err));
            }
          }}
        >
          Sil
        </button>
      </div>
      {notice && <div className="settings-ok" onClick={() => setNotice(null)}>{notice}</div>}
      {showMembers && <CanvasMembersList canvasId={canvas.id} onError={onError} />}
    </div>
  );
}

function CanvasesSection({ onError }: { onError: (msg: string) => void }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [canvases, setCanvases] = useState<AdminCanvasInfo[] | null>(null);

  const refresh = () =>
    adminApi.canvases(query).then(({ canvases }) => setCanvases(canvases)).catch((err) => onError(errText(err)));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (!canvases) return <div className="loading">Yükleniyor…</div>;

  return (
    <>
      <input
        className="admin-search"
        placeholder="Kanvas ara (ad)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {canvases.length === 0 ? (
        <p className="empty-note">Eşleşen kanvas yok.</p>
      ) : (
        <div className="canvas-grid">
          {canvases.map((c) => (
            <AdminCanvasCard key={c.id} canvas={c} onChanged={refresh} onError={onError} />
          ))}
        </div>
      )}
    </>
  );
}

// ---------- Gruplar ----------

function AdminGroupMembers({ groupId, onError }: { groupId: string; onError: (msg: string) => void }) {
  const [members, setMembers] = useState<GroupMemberInfo[] | null>(null);

  useEffect(() => {
    adminApi.groupMembers(groupId).then(({ members }) => setMembers(members)).catch((err) => onError(errText(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  if (!members) return <div className="loading">Yükleniyor…</div>;

  const act = async (fn: () => Promise<{ members: GroupMemberInfo[] }>) => {
    try {
      setMembers((await fn()).members);
    } catch (err) {
      onError(errText(err));
    }
  };

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
                  <button className="primary" onClick={() => act(() => adminApi.approveGroupMember(groupId, m.userId))}>
                    Onayla
                  </button>
                  <button onClick={() => act(() => adminApi.removeGroupMember(groupId, m.userId))}>Reddet</button>
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
                onChange={(e) => act(() => adminApi.setGroupMemberRole(groupId, m.userId, e.target.value as 'admin' | 'member'))}
              >
                <option value="admin">yönetici</option>
                <option value="member">üye</option>
              </select>
              <button
                onClick={() => {
                  if (window.confirm(`"${m.username}" gruptan çıkarılsın mı?`))
                    act(() => adminApi.removeGroupMember(groupId, m.userId));
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

function AdminGroupRow({
  group, onChanged, onError,
}: {
  group: AdminGroupInfo;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group-card">
      <div className="group-card-head">
        <span className="group-card-name">{group.name}</span>
        <span className="group-card-meta">
          👥 {group.memberCount}
          {group.pendingCount > 0 && ` · ⏳ ${group.pendingCount} bekliyor`}
          {` · 🗂 ${group.canvasCount} kanvas · ${trDate(group.createdAt)}`}
        </span>
        <button onClick={() => setExpanded(!expanded)}>{expanded ? 'Üyeleri gizle' : 'Üyeleri yönet'}</button>
        <button
          className="danger-sm"
          onClick={async () => {
            const warn =
              `"${group.name}" grubu silinsin mi?\n\n` +
              'Grubun kanvasları silinmez; sahiplerinin kişisel kanvasına dönüşür.';
            if (!window.confirm(warn)) return;
            try {
              await adminApi.deleteGroup(group.id);
              onChanged();
            } catch (err) {
              onError(errText(err));
            }
          }}
        >
          Sil
        </button>
      </div>
      {expanded && <AdminGroupMembers groupId={group.id} onError={onError} />}
    </div>
  );
}

function GroupsSection({ onError }: { onError: (msg: string) => void }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [groups, setGroups] = useState<AdminGroupInfo[] | null>(null);

  const refresh = () =>
    adminApi.groups(query).then(({ groups }) => setGroups(groups)).catch((err) => onError(errText(err)));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (!groups) return <div className="loading">Yükleniyor…</div>;

  return (
    <>
      <input
        className="admin-search"
        placeholder="Grup ara (ad)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {groups.length === 0 ? (
        <p className="empty-note">Eşleşen grup yok.</p>
      ) : (
        <div className="group-list-grid">
          {groups.map((g) => (
            <AdminGroupRow key={g.id} group={g} onChanged={refresh} onError={onError} />
          ))}
        </div>
      )}
    </>
  );
}

// ---------- Görünüm ----------

/** Sunucudaki 2 MB'lık ham bayt sınırı (siteAssetService.MAX_BYTES) — dosya seçilirken erkenden uyarırız. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const DEFAULT_PREVIEW = '/login-preview.svg';

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });

/**
 * Giriş ekranındaki önizleme görselini yönetir. Bilinçli olarak "gerçek bir kanvası seç" değil:
 * admin kanvas içeriğini okuyamaz (bkz. CLAUDE.md) ve giriş ekranı herkese açıktır.
 */
function AppearanceSection({ onError }: { onError: (msg: string) => void }) {
  const [current, setCurrent] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () =>
    siteApi
      .appearance()
      .then(({ appearance }) => {
        setCurrent(appearance.loginPreview);
        setLoaded(true);
      })
      .catch((e) => onError(errText(e)));

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (action: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(msg);
    } catch (e) {
      onError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_PREVIEW_BYTES) {
      onError(`Görsel çok büyük (${Math.round(file.size / 1024)} KB). En fazla 2 MB olabilir.`);
      return;
    }
    const dataUrl = await readAsDataUrl(file).catch((e) => {
      onError(errText(e));
      return null;
    });
    if (dataUrl) await run(() => adminApi.setLoginPreview({ dataUrl }), 'Görsel yüklendi.');
  };

  return (
    <>
      <h2>Giriş ekranı görseli</h2>
      <p className="empty-note" style={{ marginBottom: 16 }}>
        Giriş ekranının sol panelinde görünen önizleme. Ayarlanmazsa paketle gelen örnek canvas
        görseli gösterilir. Bu görseli giriş yapmamış herkes görür — özel kanvas içeriği koymayın.
      </p>

      <div className="admin-appearance">
        <figure className="admin-preview-frame">
          <img src={current ?? DEFAULT_PREVIEW} alt="Giriş ekranı önizlemesi" />
          <figcaption>
            {!loaded ? 'Yükleniyor…' : current ? 'Şu an: özel görsel' : 'Şu an: varsayılan örnek görsel'}
          </figcaption>
        </figure>

        <div className="admin-appearance-controls">
          <label className="admin-field">
            Dosya yükle <small>(PNG, JPEG, WebP veya GIF · en fazla 2 MB)</small>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={busy}
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>

          <form
            className="admin-field"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (url.trim()) void run(() => adminApi.setLoginPreview({ url: url.trim() }), 'Adres kaydedildi.');
            }}
          >
            <label htmlFor="admin-preview-url">Veya dış adres</label>
            <div className="admin-field-row">
              <input
                id="admin-preview-url" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/onizleme.png" disabled={busy}
              />
              <button type="submit" className="login-btn" disabled={busy || !url.trim()}>Kaydet</button>
            </div>
          </form>

          <button
            type="button" className="pano-btn" disabled={busy || !current}
            onClick={() => void run(() => adminApi.clearLoginPreview(), 'Varsayılan görsele dönüldü.')}
          >
            Varsayılana dön
          </button>
          {notice && <div className="admin-notice">✓ {notice}</div>}
        </div>
      </div>
    </>
  );
}

// ---------- Panel ----------

const tabs: Array<[AdminTab, string]> = [
  ['overview', 'Genel Bakış'],
  ['users', 'Kullanıcılar'],
  ['canvases', 'Kanvaslar'],
  ['groups', 'Gruplar'],
  ['appearance', 'Görünüm'],
];

export function AdminPanel() {
  const user = useAuthStore((s) => s.user);
  const setOpen = useAdminStore((s) => s.setOpen);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="dashboard">
      <div className="toolbar">
        <span className="brand"><span className="brand-mark">🛡</span> Yönetim Paneli</span>
        <div className="toolbar-right">
          <span className="user-chip">{user?.displayName || user?.username}</span>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Aydınlık moda geç' : 'Karanlık moda geç'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="pano-btn" onClick={() => setOpen(false)}>← Panoya dön</button>
        </div>
      </div>
      <div className="dashboard-body">
        <div className="admin-tabs">
          {tabs.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'overview' && <StatsSection onError={setError} />}
        {tab === 'users' && <UsersSection selfId={user?.id ?? ''} onError={setError} />}
        {tab === 'canvases' && <CanvasesSection onError={setError} />}
        {tab === 'groups' && <GroupsSection onError={setError} />}
        {tab === 'appearance' && <AppearanceSection onError={setError} />}
      </div>
      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          ⚠ {error} <small>(kapatmak için tıkla)</small>
        </div>
      )}
    </div>
  );
}
