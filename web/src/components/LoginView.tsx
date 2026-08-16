import { useEffect, useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '@co-pronoia/shared';
import { siteApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { Brand, GoogleMark } from './Logo';

/** Admin bir görsel yüklemediyse gösterilen, paketle gelen örnek canvas önizlemesi. */
const DEFAULT_PREVIEW = '/login-preview.svg';

/** Giriş ekranının solundaki koyu marka paneli (mobilde üst bant olur). */
function BrandPanel() {
  const [preview, setPreview] = useState(DEFAULT_PREVIEW);

  useEffect(() => {
    // Görünüm ayarı herkese açık; okunamazsa (ör. sunucu eski) örnek görselde kalırız.
    let cancelled = false;
    siteApi
      .appearance()
      .then(({ appearance }) => {
        if (!cancelled && appearance.loginPreview) setPreview(appearance.loginPreview);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="login-brand">
      <Brand />
      <div>
        <p className="login-brand-tagline">
          Fikirlerinizi<br />birlikte haritalayın —<br />
          <em>yapay zekâ yanınızda.</em>
        </p>
        <p className="login-brand-kicker">Birlikte Düşün · Birlikte Yaz</p>
      </div>
      <figure className="login-brand-preview">
        <img
          src={preview}
          alt="Ortak canvas önizlemesi"
          // Yüklenen görsel bozuksa ya da dış adres ölmüşse panel boş kalmasın.
          onError={() => setPreview(DEFAULT_PREVIEW)}
        />
        <figcaption className="login-brand-preview-cap">ortak canvas · her değişiklik bir commit</figcaption>
      </figure>
    </aside>
  );
}

export function LoginView() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const verifyEmail = useAuthStore((s) => s.verifyEmail);
  const resendCode = useAuthStore((s) => s.resendCode);
  const cancelPending = useAuthStore((s) => s.cancelPending);
  const pendingEmail = useAuthStore((s) => s.pendingEmail);
  const error = useAuthStore((s) => s.error);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await (mode === 'login' ? login(username, password) : register(username, password, email, displayName));
    setBusy(false);
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await verifyEmail(code.trim());
    setBusy(false);
  };

  const resend = async () => {
    setBusy(true);
    await resendCode();
    setResent(true);
    setBusy(false);
  };

  const backToRegister = () => {
    cancelPending();
    setCode('');
    setResent(false);
  };

  return (
    <div className="login-screen">
      <button
        className="theme-toggle"
        style={{ position: 'fixed', top: 16, right: 16 }}
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Aydınlık moda geç' : 'Karanlık moda geç'}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      <div className="login-shell">
        <BrandPanel />
        <div className="login-pane">
          {pendingEmail ? (
            <form className="login-form" key="verify" onSubmit={submitCode}>
              <h1>E-postanı doğrula</h1>
              <p className="login-sub">
                <strong>{pendingEmail}</strong> adresine 6 haneli bir doğrulama kodu gönderdik. Kaydı
                tamamlamak için kodu girin.
              </p>
              <div className="login-form-field">
                <label htmlFor="cp-code">Doğrulama kodu</label>
                <input
                  id="cp-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                />
              </div>
              {error && <div className="login-error">{error}</div>}
              {resent && <div className="login-invite-note">📧 Yeni bir kod gönderildi.</div>}
              <button type="submit" className="login-btn" disabled={busy || code.trim().length < 6}>
                Doğrula
              </button>
              <p className="login-form-switch">
                <button type="button" className="login-switch" onClick={resend} disabled={busy}>
                  Kodu tekrar gönder
                </button>
                {' · '}
                <button type="button" className="login-switch" onClick={backToRegister}>
                  ← Geri dön
                </button>
              </p>
            </form>
          ) : (
            <form className="login-form" key={mode} onSubmit={submit}>
              <h1>{mode === 'login' ? 'Tekrar hoş geldin' : 'Aramıza katıl'}</h1>
              <p className="login-sub">
                {mode === 'login'
                  ? 'Ortak canvas’ına devam et.'
                  : 'Fikirlerini birlikte haritalamaya başla.'}
              </p>
              <a className="google-btn" href="/api/auth/google/start">
                <GoogleMark /> Google ile devam et
              </a>
              <div className="login-divider"><span>veya</span></div>
              <div className="login-form-field">
                <label htmlFor="cp-username">Kullanıcı adı</label>
                <input
                  id="cp-username" value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="kullaniciadi" autoFocus autoComplete="username"
                />
              </div>
              {mode === 'register' && (
                <div className="login-form-field">
                  <label htmlFor="cp-email">E-posta</label>
                  <input
                    id="cp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="sen@ornek.com" autoComplete="email"
                  />
                </div>
              )}
              {mode === 'register' && (
                <div className="login-form-field">
                  <label htmlFor="cp-display">Görünen ad (opsiyonel)</label>
                  <input
                    id="cp-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ada Yazar" autoComplete="name" maxLength={60}
                  />
                </div>
              )}
              <div className="login-form-field">
                <label htmlFor="cp-password">Şifre</label>
                <input
                  id="cp-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'login' ? '••••••••' : `En az ${MIN_PASSWORD_LENGTH} karakter`}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>
              {new URLSearchParams(window.location.search).has('davet') && (
                <p className="login-invite-note">
                  🔗 Bir kanvas davet linkiyle geldiniz — giriş yapınca (veya kayıt olunca) kanvasa otomatik ekleneceksiniz.
                </p>
              )}
              {new URLSearchParams(window.location.search).has('aktivasyon') && (
                <p className="login-invite-note">
                  🖥 Yerel bir kurulumu etkinleştiriyorsunuz — giriş yapınca onay ekranı çıkacak.
                </p>
              )}
              {new URLSearchParams(window.location.search).has('grupDavet') && (
                <p className="login-invite-note">
                  🔗 Bir grup davet linkiyle geldiniz — giriş yapınca (veya kayıt olunca) gruba katılma isteği göndereceksiniz.
                </p>
              )}
              {error && <div className="login-error">{error}</div>}
              <button
                type="submit" className="login-btn"
                disabled={busy || !username || !password || (mode === 'register' && (!email || password.length < MIN_PASSWORD_LENGTH))}
              >
                {mode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur'}
              </button>
              <p className="login-form-switch">
                {mode === 'login' ? 'Hesabın yok mu?' : 'Zaten üye misin?'}{' '}
                <button type="button" className="login-switch" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
                  {mode === 'login' ? 'Kayıt ol' : 'Giriş yap'}
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
