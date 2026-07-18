import { useEffect, useState } from 'react';
import type { AgentRoleInfo } from '@treemapper/shared';
import { ApiError, type AgentRoleApi, type AgentRoleInput } from '../api/client';

/** Tek bir ajan rolü satırı: ad + persona metni + süpervizör bayrağı. */
function AgentRoleRow({
  value, onChange, onRemove,
}: {
  value: AgentRoleInput;
  onChange: (next: AgentRoleInput) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="agent-role-row">
      <div className="role-def-row">
        <input
          placeholder="Rol adı (ör. Backend planlayıcı)"
          value={value.name}
          maxLength={60}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
        <label className="role-def-check" title="Süpervizör: önerileri onaylar/reddeder; onaysız hiçbir öneri uygulanmaz">
          <input
            type="checkbox"
            checked={value.isSupervisor ?? false}
            onChange={(e) => onChange({ ...value, isSupervisor: e.target.checked })}
          />
          süpervizör
        </label>
        {onRemove && (
          <button type="button" className="region-del" onClick={onRemove}>Sil</button>
        )}
      </div>
      <textarea
        className="agent-role-persona"
        placeholder="Persona / görev brifingi — bağlanan ajana get_brief aracıyla aynen iletilir…"
        value={value.persona ?? ''}
        maxLength={4000}
        rows={3}
        onChange={(e) => onChange({ ...value, persona: e.target.value })}
      />
    </div>
  );
}

/**
 * Co-Pronoia ajan rollerinin liste + düzenleme paneli. `api` adaptörü sayesinde hem site
 * şablonları (AdminPanel, adminApi.agentRoles) hem gruba özel roller (Dashboard,
 * groupApi.agentRoles) aynı bileşeni kullanır.
 */
export function AgentRoleEditor({ api, title }: { api: AgentRoleApi; title: string }) {
  const [roles, setRoles] = useState<AgentRoleInfo[]>([]);
  const [draft, setDraft] = useState<AgentRoleInput>({ name: '', persona: '', isSupervisor: false });
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.list().then(({ roles }) => setRoles(roles)).catch(() => setRoles([]));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveExisting = async (role: AgentRoleInfo, patch: Partial<AgentRoleInput>) => {
    try {
      await api.update(role.id, patch);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <div className="group-roles agent-roles">
      <h5>{title} ({roles.length})</h5>
      {roles.map((r) => (
        <AgentRoleRow
          key={r.id}
          value={r}
          onChange={(next) => saveExisting(r, next)}
          onRemove={async () => {
            if (!window.confirm(`"${r.name}" ajan rolü silinsin mi? Bu rolle açılmış ajan anahtarları da iptal olur.`)) return;
            try {
              await api.remove(r.id);
              await refresh();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : String(err));
            }
          }}
        />
      ))}
      <div className="role-def-add">
        <AgentRoleRow value={draft} onChange={setDraft} />
        <button
          type="button"
          className="primary"
          disabled={!draft.name.trim()}
          onClick={async () => {
            try {
              await api.create(draft);
              setDraft({ name: '', persona: '', isSupervisor: false });
              await refresh();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : String(err));
            }
          }}
        >
          + Ajan rolü ekle
        </button>
      </div>
      {error && <div className="login-error" onClick={() => setError(null)}>{error}</div>}
    </div>
  );
}
