import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';

export function LoginView() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await (mode === 'login' ? login(username, password) : register(username, password, email, displayName));
    setBusy(false);
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
      <form className="login-card" onSubmit={submit}>
        <h1>🌳 TreeMapper</h1>
        <p className="login-sub">Plan ağacınızı birlikte kurun — her değişiklik commit olarak kaydedilir.</p>
        {new URLSearchParams(window.location.search).has('davet') && (
          <p className="login-invite-note">
            🔗 Bir kanvas davet linkiyle geldiniz — giriş yapınca (veya kayıt olunca) kanvasa otomatik ekleneceksiniz.
          </p>
        )}
        {new URLSearchParams(window.location.search).has('grupDavet') && (
          <p className="login-invite-note">
            🔗 Bir grup davet linkiyle geldiniz — giriş yapınca (veya kayıt olunca) gruba katılma isteği göndereceksiniz.
          </p>
        )}
        <a className="google-btn" href="/api/auth/google/start">
          <span>G</span> Google ile devam et
        </a>
        <div className="login-divider"><span>veya</span></div>
        <label>
          Kullanıcı adı
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </label>
        {mode === 'register' && (
          <label>
            E-posta
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
        )}
        {mode === 'register' && (
          <label>
            Görünen ad (opsiyonel)
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" maxLength={60} />
          </label>
        )}
        <label>
          Şifre
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button
          type="submit" className="login-btn"
          disabled={busy || !username || !password || (mode === 'register' && !email)}
        >
          {mode === 'login' ? 'Giriş yap' : 'Kayıt ol'}
        </button>
        <button type="button" className="login-switch" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Hesabın yok mu? Kayıt ol' : 'Zaten hesabın var mı? Giriş yap'}
        </button>
      </form>
    </div>
  );
}
