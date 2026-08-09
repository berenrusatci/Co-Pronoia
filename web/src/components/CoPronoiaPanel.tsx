import { useEffect, useState } from 'react';
import type { AgentRoleInfo, AgentTokenInfo, NodeClaimInfo, PlanProposalInfo, ProposalStatus } from '@co-pronoia/shared';
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
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  // Yenilenen anahtarın sırrı token id'sine göre (mint'in "secret" alanından ayrı — birden
  // fazla kartın sırrı aynı anda görünebilir).
  const [rotatedSecrets, setRotatedSecrets] = useState<Record<string, string>>({});
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
  const toggleRole = (id: string) =>
    setRoleIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const roleCheckbox = (r: AgentRoleInfo) => (
    <label key={r.id} className="role-checkbox">
      <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
      {r.name}{r.isSupervisor ? ' ★ süpervizör' : ''}
    </label>
  );

  const mint = async () => {
    try {
      const res = await api.createAgentToken(roleIds, label.trim());
      setSecret(res.secret);
      setLabel('');
      setRoleIds([]);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const rotate = async (t: AgentTokenInfo) => {
    if (!window.confirm(`"${t.label}" anahtarı yenilensin mi? Eski anahtar anında geçersiz olur — bağlı ajanın .mcp.json'ını güncellemen gerekir.`))
      return;
    try {
      const res = await api.rotateAgentToken(t.id);
      setRotatedSecrets((s) => ({ ...s, [t.id]: res.secret }));
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
          <p className="empty-note">
            Bir anahtar birden çok role bağlanabilir — tek MCP bağlantısıyla birden çok ajan rolü (ör. bir
            süpervizör + bir teknik ajan) çalışabilir. En az bir rol seçin.
          </p>
          <div className="role-checkbox-list">
            {groupRoles.length > 0 && (
              <fieldset>
                <legend>Grup rolleri</legend>
                {groupRoles.map(roleCheckbox)}
              </fieldset>
            )}
            {siteRoles.length > 0 && (
              <fieldset>
                <legend>Site şablonları</legend>
                {siteRoles.map(roleCheckbox)}
              </fieldset>
            )}
          </div>
          <input
            placeholder="Anahtar etiketi (ör. ajan-1)"
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button className="primary" disabled={roleIds.length === 0 || !label.trim()} onClick={mint}>
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
              {t.label}{' '}
              <em>
                —{' '}
                {t.roles.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 ? ' + ' : ''}
                    <span className={`role-badge${r.isSupervisor ? ' role-owner' : ''}`}>
                      {r.name}{r.isSupervisor ? ' ★' : ''}
                    </span>
                  </span>
                ))}
              </em>
            </span>
            {t.revoked ? (
              <span className="role-badge role-viewer">iptal</span>
            ) : (
              <span className="member-actions">
                <button onClick={() => rotate(t)} title="Aynı etiket/rollerle yeni bir sır üret; eski anahtar anında geçersiz olur">
                  🔄 Anahtarı yenile
                </button>
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
            {rotatedSecrets[t.id] && (
              <SecretReveal
                secret={rotatedSecrets[t.id]}
                onClose={() => setRotatedSecrets((s) => { const next = { ...s }; delete next[t.id]; return next; })}
              />
            )}
          </li>
        ))}
      </ul>
      {error && <div className="login-error" onClick={() => setError(null)}>{error}</div>}
    </>
  );
}

/** Bir claim'in ne kadar süre sonra düşeceğini kısa Türkçe metne çevirir. */
function ttlLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'düşüyor';
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return min > 0 ? `${min} dk ${sec} sn` : `${sec} sn`;
}

/**
 * Yumuşak claim/lease listesi: hangi ajan hangi bölgeyi/düğümleri üstlenmiş. Bu bir KİLİT değil,
 * danışmadır (commit yolu hâlâ tek otorite); paralel ajanların aynı alana çakışmasını azaltır.
 * Sahip takılı/yabancı bir claim'i buradan zorla düşürebilir.
 */
function ClaimsSection({ isOwner }: { isOwner: boolean }) {
  const claims = useGraphStore((s) => s.claims);
  const forceReleaseClaim = useGraphStore((s) => s.forceReleaseClaim);
  // Süre etiketini akıcı tutmak için 10 sn'de bir yeniden çiz (TTL geri sayımı).
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <h4>Üstlenilen alanlar ({claims.length})</h4>
      {claims.length === 0 ? (
        <p className="empty-note">
          Şu an aktif claim yok. Ajanlar <code>claim_region</code> ile bir bölgeyi geçici üstlendiğinde
          burada canlı görünür. Claim bir kilit değil, koordinasyon danışmasıdır.
        </p>
      ) : (
        <ul className="member-list">
          {claims.map((c: NodeClaimInfo) => (
            <li key={c.id} className="member-item">
              <span className="member-dot on" title="aktif claim" />
              <span className="member-name">
                {c.scope === 'region'
                  ? c.regionName ?? '(silinmiş bölge)'
                  : `${c.nodeIds.length} düğüm`}{' '}
                <em>— {c.agentLabel} ({c.roleName}) · {ttlLabel(c.expiresAt)}</em>
              </span>
              {isOwner && (
                <span className="member-actions">
                  <button
                    title="Bu claim'i zorla düşür"
                    onClick={() => {
                      if (window.confirm(`${c.agentLabel} ajanının "${c.regionName ?? 'düğüm'}" claim'i düşürülsün mü?`))
                        forceReleaseClaim(c.id);
                    }}
                  >
                    Düşür
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
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
      <ClaimsSection isOwner={isOwner} />
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
