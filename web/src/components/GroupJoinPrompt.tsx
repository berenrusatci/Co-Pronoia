import { useState, type FormEvent } from 'react';
import { useGroupStore } from '../store/groupStore';
import { Brand } from './Logo';

/** Shown after login when a `?grupDavet=` link is pending — asks for a job title before requesting to join. */
export function GroupJoinPrompt({ onDone }: { onDone: () => void }) {
  const joinByToken = useGroupStore((s) => s.joinByToken);
  const [jobTitle, setJobTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await joinByToken(new URLSearchParams(window.location.search).get('grupDavet') ?? '', jobTitle.trim());
    setBusy(false);
    onDone();
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1><Brand /></h1>
        <p className="login-sub">Bir grup davet linkiyle geldiniz. Katılma isteğiniz grup yöneticisinin onayına gönderilecek.</p>
        <label>
          Rolünüz / göreviniz
          <input
            value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} autoFocus maxLength={80}
            placeholder="Örn. Yazılımcı, Tasarımcı, PM…"
          />
        </label>
        <button type="submit" className="login-btn" disabled={busy}>
          İstek gönder
        </button>
      </form>
    </div>
  );
}
