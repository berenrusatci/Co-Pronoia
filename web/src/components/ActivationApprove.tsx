import { useState } from 'react';
import { useAuthStore } from '../store/authStore';

interface Props {
  /** Yerel kurulumun ürettiği state / dönüş adresi / kanıt (URL parametreleri). */
  state: string;
  redirect: string;
  proof: string;
  onCancel: () => void;
}

/**
 * Bulut tarafı onay ekranı: `?aktivasyon=` ile gelen bir yerel kuruluma, oturum açmış
 * kullanıcının kimliğini vermeyi onaylar. Onaydan sonra tarayıcı yerel kuruluma döner.
 */
export function ActivationApprove({ state, redirect, proof, onCancel }: Props) {
  const user = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/activation/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, redirect, proof }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.redirectTo) {
      setError(data.error ?? 'etkinleştirme başarısız');
      setBusy(false);
      return;
    }
    window.location.href = data.redirectTo;
  };

  return (
    <div className="login-screen">
      <div className="login-shell">
        <div className="login-pane">
          <div className="login-form">
            <h1>Yerel kurulumu etkinleştir</h1>
            <p className="login-sub">
              <code>{redirect}</code> adresindeki yerel kurulum, hesabınızla eşleşmek istiyor.
              Onaylarsanız o kurulum <strong>{user?.username}</strong> kimliğiyle çalışır ve bu
              hesabın kanvaslarının bir kopyasını kendi veritabanına çeker.
            </p>
            <p className="login-invite-note">
              ⚠️ Bunu yalnızca kendi başlattığınız kurulum için onaylayın. Şifreniz aktarılmaz;
              kurulum yalnızca kanvaslarınızı okuyabilen bir anahtar alır.
            </p>
            {error && <div className="login-error">{error}</div>}
            <button className="login-btn" onClick={approve} disabled={busy}>
              {busy ? 'Etkinleştiriliyor…' : 'Etkinleştir ve geri dön'}
            </button>
            <p className="login-form-switch">
              <button type="button" className="login-switch" onClick={onCancel}>
                Vazgeç
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
