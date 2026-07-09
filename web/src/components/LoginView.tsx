import { useState } from 'react';
import { useAuthStore } from '../store/authStore';

export function LoginView() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await (mode === 'login' ? login(username, password) : register(username, password));
    setBusy(false);
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>🌳 TreeMapper</h1>
        <p className="login-sub">Plan ağacınızı birlikte kurun — her değişiklik commit olarak kaydedilir.</p>
        <label>
          Kullanıcı adı
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label>
          Şifre
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button type="submit" className="login-btn" disabled={busy || !username || !password}>
          {mode === 'login' ? 'Giriş yap' : 'Kayıt ol'}
        </button>
        <button type="button" className="login-switch" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Hesabın yok mu? Kayıt ol' : 'Zaten hesabın var mı? Giriş yap'}
        </button>
      </form>
    </div>
  );
}
