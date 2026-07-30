import { useState } from 'react';
import { useModeStore } from '../store/modeStore';
import { useThemeStore } from '../store/themeStore';
import { Brand } from './Logo';

/**
 * Yerel kurulum henüz etkinleştirilmemiş: tek yapılacak iş, bulut hesabıyla bir kerelik
 * onay. Şifre buraya girilmez — tarayıcı buluta gider, orada onaylanır, dönüşte kimlik
 * kalıcı olarak bu kuruluma yazılır. Sonrası tamamen yereldir.
 */
export function ActivationView() {
  const cloudUrl = useModeStore((s) => s.cloudUrl);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const [busy, setBusy] = useState(false);
  const error = new URLSearchParams(window.location.search).get('aktivasyon_hata');

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
        <aside className="login-brand">
          <Brand />
          <div>
            <p className="login-brand-tagline">
              Kendi bilgisayarında,<br />kendi verinle —<br />
              <em>bulut yalnızca kapıyı açar.</em>
            </p>
            <p className="login-brand-kicker">Yerel kurulum · Veriler bu makinede</p>
          </div>
        </aside>
        <div className="login-pane">
          <div className="login-form">
            <h1>Kurulumu etkinleştir</h1>
            <p className="login-sub">
              Bu, uygulamanın <strong>kendi Docker'ınızdaki</strong> kurulumudur. Kanvaslarınız,
              commitleriniz ve ajan anahtarlarınız yalnızca bu makinedeki veritabanında durur.
            </p>
            <p className="login-sub">
              Başlamak için bir kez bulut hesabınızla onay verin. Onaydan sonra internet bağlantısı
              gerekmez; bulut kanvaslarınız da bu kuruluma kopyalanır.
            </p>
            {error && <div className="login-error">{error}</div>}
            <a
              className="login-btn"
              href="/api/activation/start"
              onClick={() => setBusy(true)}
              style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
            >
              {busy ? 'Buluta yönlendiriliyor…' : 'Bulut hesabıyla etkinleştir'}
            </a>
            <p className="login-form-switch">
              Onay adresi: <code>{cloudUrl ?? '—'}</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
