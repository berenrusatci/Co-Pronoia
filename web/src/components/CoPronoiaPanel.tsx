import { useEffect, useState } from 'react';
import type { AgentRoleInfo, AgentTokenInfo, PlanProposalInfo, ProposalStatus } from '@treemapper/shared';
import { api, ApiError } from '../api/client';
import { useGraphStore } from '../store/graphStore';
import { useCanvasStore } from '../store/canvasStore';

const statusLabels: Record<ProposalStatus, string> = {
  submitted: 'bekliyor',
  changes_requested: 'değişiklik istendi',
  withdrawn: 'geri çekildi',
  rejected: 'reddedildi',
  applied: 'uygulandı',
};

/** lastUsedAt son 2 dakikadaysa ajan "az önce buradaydı" sayılır (presence yeşili). */
const isFresh = (iso: string | null) => iso !== null && Date.now() - new Date(iso).getTime() < 2 * 60_000;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt('Kopyalayın:', text);
        }
      }}
    >
      {copied ? 'Kopyalandı ✓' : label}
    </button>
  );
}

/** .mcp.json içeriği; secret verilmezse yer tutucuyla (bağlantı rehberi), verilirse gerçek anahtarla (mint anı). */
const mcpJsonSnippet = (secret = 'tma_ANAHTARINIZ') =>
  JSON.stringify(
    {
      mcpServers: {
        copronoia: {
          type: 'http',
          url: `${window.location.origin}/api/mcp`,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    },
    null,
    2,
  );

/**
 * MCP bağlantı rehberi — her üyeye görünür (anahtar yönetimi sahipte kalır). Gerçek anahtar
 * yalnızca basıldığı anda göründüğünden buradaki örnekler yer tutucu taşır.
 */
function ConnectSection() {
  const url = `${window.location.origin}/api/mcp`;
  const cli = `claude mcp add --transport http copronoia ${url} --header "Authorization: Bearer tma_ANAHTARINIZ"`;
  const json = mcpJsonSnippet();
  return (
    <details className="mcp-connect">
      <summary>🔌 MCP bağlantısı nasıl kurulur?</summary>
      <p className="empty-note">
        Herhangi bir MCP istemcisi (Claude Code, başka bir ajan) bu kanvasa aşağıdaki uçtan bağlanır.
        <code> tma_ANAHTARINIZ</code> yerine kanvas sahibinin bastığı gerçek anahtarı yazın — anahtar
        yalnızca basıldığı anda bir kez gösterilir; kaybolursa iptal edip yenisini basın.
      </p>
      <div className="mcp-connect-row">
        <span className="mcp-connect-label">Uç</span>
        <code className="mcp-connect-url">{url}</code>
        <CopyButton text={url} label="Kopyala" />
      </div>
      <div className="mcp-connect-row">
        <span className="mcp-connect-label">Claude Code (CLI)</span>
        <CopyButton text={cli} label="Komutu kopyala" />
      </div>
      <pre className="secret-snippet">{cli}</pre>
      <div className="mcp-connect-row">
        <span className="mcp-connect-label">.mcp.json (proje kökü)</span>
        <CopyButton text={json} label="Kopyala" />
      </div>
      <pre className="secret-snippet">{json}</pre>
      <p className="empty-note">
        Bağlandıktan sonra ajanın ilk çağrısı <code>get_brief</code> olmalı: rolünün personasını,
        kadroyu ve çalışma kurallarını oradan alır.
      </p>
    </details>
  );
}

/** Mint sonrası BİR KEZ gösterilen sır + yapıştırmalık .mcp.json parçası. */
function SecretReveal({ secret, onClose }: { secret: string; onClose: () => void }) {
  const snippet = mcpJsonSnippet(secret);
  return (
    <div className="secret-reveal">
      <p className="empty-note">
        Bu anahtar yalnızca <strong>şimdi</strong> gösteriliyor — kopyalayın; sunucu yalnızca özetini saklar.
      </p>
      <code className="secret-code">{secret}</code>
      <div className="secret-actions">
        <CopyButton text={secret} label="Anahtarı kopyala" />
        <CopyButton text={snippet} label=".mcp.json kopyala" />
        <button onClick={onClose}>Kapat</button>
      </div>
      <pre className="secret-snippet">{snippet}</pre>
    </div>
  );
}

function TokenSection() {
  const [roles, setRoles] = useState<AgentRoleInfo[]>([]);
  const [tokens, setTokens] = useState<AgentTokenInfo[]>([]);
  const [roleId, setRoleId] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [{ roles }, { tokens }] = await Promise.all([api.getAgentRoles(), api.getAgentTokens()]);
      setRoles(roles);
      setTokens(tokens);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const siteRoles = roles.filter((r) => r.scope === 'site');
  const groupRoles = roles.filter((r) => r.scope === 'group');
  const roleOption = (r: AgentRoleInfo) => (
    <option key={r.id} value={r.id}>
      {r.name}{r.isSupervisor ? ' ★ süpervizör' : ''}
    </option>
  );

  const mint = async () => {
    try {
      const res = await api.createAgentToken(roleId, label.trim());
      setSecret(res.secret);
      setLabel('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <>
      <h4>Ajan anahtarları</h4>
      {roles.length === 0 ? (
        <p className="empty-note">
          Önce bir ajan rolü tanımlayın: grup kartındaki "Ajan rolleri" panelinden (grup admini) ya da site
          yönetim panelindeki "Ajan Rolleri" sekmesinden (site admini).
        </p>
      ) : (
        <div className="token-mint">
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">rol seçin…</option>
            {groupRoles.length > 0 && <optgroup label="Grup rolleri">{groupRoles.map(roleOption)}</optgroup>}
            {siteRoles.length > 0 && <optgroup label="Site şablonları">{siteRoles.map(roleOption)}</optgroup>}
          </select>
          <input
            placeholder="Anahtar etiketi (ör. ajan-1)"
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button className="primary" disabled={!roleId || !label.trim()} onClick={mint}>
            + Anahtar bas
          </button>
        </div>
      )}
      {secret && <SecretReveal secret={secret} onClose={() => setSecret(null)} />}
      <ul className="member-list">
        {tokens.map((t) => (
          <li key={t.id} className={`member-item${t.revoked ? ' token-revoked' : ''}`}>
            <span className={`member-dot ${isFresh(t.lastUsedAt) && !t.revoked ? 'on' : 'off'}`}
              title={t.revoked ? 'iptal edildi' : isFresh(t.lastUsedAt) ? 'az önce bağlandı' : 'bağlı değil'} />
            <span className="member-name">
              {t.label} <em>— {t.roleName}{t.isSupervisor ? ' ★' : ''}</em>
            </span>
            {t.revoked ? (
              <span className="role-badge role-viewer">iptal</span>
            ) : (
              <span className="member-actions">
                <button
                  onClick={async () => {
                    if (!window.confirm(`"${t.label}" anahtarı iptal edilsin mi? Bağlı ajan erişimini kaybeder.`)) return;
                    try {
                      setTokens((await api.revokeAgentToken(t.id)).tokens);
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : String(err));
                    }
                  }}
                >
                  İptal et
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <div className="login-error" onClick={() => setError(null)}>{error}</div>}
    </>
  );
}

function ProposalCard({ proposal, isOwner }: { proposal: PlanProposalInfo; isOwner: boolean }) {
  const rejectProposal = useGraphStore((s) => s.rejectProposal);
  const viewAt = useGraphStore((s) => s.viewAt);
  const open = proposal.status === 'submitted' || proposal.status === 'changes_requested';
  return (
    <div className={`proposal-card proposal-${proposal.status}`}>
      <div className="proposal-head">
        <span className={`role-badge proposal-badge-${proposal.status}`}>{statusLabels[proposal.status]}</span>
        <strong>{proposal.title}</strong>
      </div>
      <div className="proposal-meta">
        {proposal.agentLabel} ({proposal.roleName}) · {proposal.intentCount} işlem · taban #{proposal.baseSeq}
      </div>
      {proposal.summary && <p className="proposal-summary">{proposal.summary}</p>}
      {proposal.supervisorNote && (
        <p className="proposal-note">
          🗒 {proposal.supervisorNote}
          {proposal.decidedByLabel && <em> — {proposal.decidedByLabel}</em>}
        </p>
      )}
      <div className="proposal-actions">
        {proposal.appliedCommitSeq !== null && (
          <button onClick={() => viewAt(proposal.appliedCommitSeq!)} title="Uygulandığı commit'i görüntüle">
            #{proposal.appliedCommitSeq} görüntüle
          </button>
        )}
        {proposal.branchName && <span className="proposal-branch">⑂ {proposal.branchName}</span>}
        {isOwner && open && (
          <button
            onClick={() =>
              window.confirm(`"${proposal.title}" önerisi reddedilsin mi?`) && rejectProposal(proposal.id)
            }
          >
            Reddet
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Co-Pronoia paneli: ajan anahtarı yönetimi (sahip) + canlı öneri akışı. Öneriler MCP
 * üzerinden gelir, süpervizör ajan karar verir; buradaki tek insan müdahalesi sahibin
 * temizlik reddi — onay bilinçli olarak UI'da yok.
 */
export function CoPronoiaPanel() {
  const proposals = useGraphStore((s) => s.proposals);
  const isOwner = useCanvasStore((s) => s.active?.role === 'owner');
  const openCount = proposals.filter((p) => p.status === 'submitted' || p.status === 'changes_requested').length;

  return (
    <aside className="side-panel copronoia-panel">
      <h3>🤝 Co-Pronoia</h3>
      <p className="empty-note">
        MCP ajanları bu kanvasa plan önerir; süpervizör rolündeki ajan en uyumlu planı onaylayarak uygular.
        Onaysız hiçbir öneri kanvasa işlenmez.
      </p>
      <ConnectSection />
      {isOwner && <TokenSection />}
      <h4>Öneriler ({openCount} açık / {proposals.length})</h4>
      {proposals.length === 0 ? (
        <p className="empty-note">
          Henüz öneri yok. Ajanlar bağlanıp <code>submit_proposal</code> gönderdiğinde burada canlı listelenir.
        </p>
      ) : (
        [...proposals].reverse().map((p) => <ProposalCard key={p.id} proposal={p} isOwner={isOwner} />)
      )}
    </aside>
  );
}
