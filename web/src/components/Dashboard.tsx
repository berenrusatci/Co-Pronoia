import { useEffect, useState, type FormEvent } from 'react';
import type { CanvasInfo } from '@treemapper/shared';
import { useCanvasStore } from '../store/canvasStore';
import { useAuthStore } from '../store/authStore';
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

function UserSettings() {
  const [openSection, setOpenSection] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

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

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const canvas = await createCanvas(name.trim());
    setBusy(false);
    if (canvas) {
      setName('');
      open(canvas); // jump straight into the freshly created canvas
    }
  };

  if (!listLoaded) return <div className="loading">Yükleniyor…</div>;

  return (
    <div className="dashboard">
      <div className="toolbar">
        <span className="brand">🌳 TreeMapper</span>
        <div className="toolbar-right">
          <span className="user-chip">{user?.username}</span>
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
          <div className="canvas-grid">
            {canvases.map((c) => (
              <CanvasCard key={c.id} canvas={c} />
            ))}
          </div>
        )}
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
