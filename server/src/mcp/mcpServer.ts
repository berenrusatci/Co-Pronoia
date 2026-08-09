import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PlanNode } from '@co-pronoia/shared';
import type { AgentRoleDef, PrismaClient } from '@prisma/client';
import type { ServerMessage } from '@co-pronoia/shared';
import { listRegions, createRegion, type ServiceFor } from '../canvasService.js';
import type { CanvasEvents } from '../canvasEvents.js';
import { listAgentTokens, type ResolvedAgentToken } from '../agentRoleService.js';
import {
  approveProposal, decideProposal, getProposal, listProposals, submitProposal,
  updateProposal, withdrawProposal,
} from '../proposalService.js';
import { getBrief, updateBrief, MAX_BRIEF_LENGTH } from '../briefService.js';
import { claimRegion, claimWarningsForIntents, listClaims, releaseClaim } from '../claimService.js';
import { opInputSchema } from './schemas.js';

export interface McpContext {
  prisma: PrismaClient;
  serviceFor: ServiceFor;
  broadcast: (canvasId: string, msg: ServerMessage) => void;
  events: CanvasEvents;
  token: ResolvedAgentToken;
}

/**
 * wait_for_changes üst sınırı: Streamable HTTP yanıtı bekleme boyunca açık kalır; 25 sn,
 * Node'un http requestTimeout'unun (varsayılan 300 sn — yalnızca isteğin ALINMASINI sınırlar,
 * yanıtı değil) ve tipik proxy read-timeout'larının (30-60 sn) güvenle altındadır.
 */
const WAIT_MAX_MS = 25_000;
const WAIT_DEFAULT_MS = 20_000;

type ProposalSnapshot = Map<
  string,
  { status: string; branchName: string | null; appliedCommitSeq: number | null; updatedAt: Date }
>;

/** Değişen önerilerin özeti; status: null = öneri artık yok (kanvasla birlikte silinmiş). */
type ChangedProposal = {
  id: string;
  status: string | null;
  branchName: string | null;
  appliedCommitSeq: number | null;
};

const diffProposals = (baseline: ProposalSnapshot, current: ProposalSnapshot): ChangedProposal[] => {
  const changed: ChangedProposal[] = [];
  for (const id of new Set([...baseline.keys(), ...current.keys()])) {
    const b = baseline.get(id);
    const c = current.get(id);
    // updatedAt karşılaştırması, statüyü değiştirmeyen update_proposal'ı da (revize edilmiş
    // içerik, durum yine 'submitted') değişiklik sayar — süpervizör bunu görmek ister.
    if (b && c && b.status === c.status && b.updatedAt.getTime() === c.updatedAt.getTime()) continue;
    changed.push(
      c
        ? { id, status: c.status, branchName: c.branchName, appliedCommitSeq: c.appliedCommitSeq }
        : { id, status: null, branchName: null, appliedCommitSeq: null },
    );
  }
  return changed;
};

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const errText = (s: string) => ({ isError: true as const, content: [{ type: 'text' as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

/** Rol seçim parametresi: rol ADIYLA seçilir (bkz. resolveActingRole). Tüm tool şemalarında ortak. */
const roleParam = z.string().max(60).optional();

/**
 * Bir MCP bağlantısının (token) HANGİ rolle davrandığını çözer. Tek rollü token'da parametre
 * isteğe bağlıdır ve o tek rol varsayılır; parametre verilse de yalnızca o role eşleşmelidir.
 * Çok rollü token'da parametre ZORUNLUDUR — verilmezse ya da token'a ait olmayan bir ada
 * karşılık geliyorsa Türkçe hata (seçilebilir rolleri listeler).
 */
function resolveActingRole(
  token: ResolvedAgentToken,
  roleName?: string,
): { role: AgentRoleDef } | { error: string } {
  const roles = token.roles;
  if (roleName !== undefined) {
    const match = roles.find((r) => r.name === roleName);
    if (!match) {
      return {
        error: `bilinmeyen rol adı "${roleName}" — bu bağlantıda seçilebilir roller: ${roles.map((r) => r.name).join(', ')}`,
      };
    }
    return { role: match };
  }
  if (roles.length === 1) return { role: roles[0] };
  return {
    error: `bu bağlantı birden çok role bağlı — hangi rolle davrandığını "role" parametresiyle belirt: ${roles
      .map((r) => r.name)
      .join(', ')}`,
  };
}

const proposalStatus = z.enum(['submitted', 'changes_requested', 'withdrawn', 'rejected', 'applied']);

/** get_state compact modunun düşürdüğü sunum alanları — planlamada gereksiz, token yer. */
const COMPACT_DROP: readonly (keyof PlanNode)[] = ['x', 'y', 'url', 'urlBy'];
const NODE_KEYS: readonly (keyof PlanNode)[] = [
  'id', 'parentId', 'title', 'description', 'nodeType', 'status',
  'x', 'y', 'linkedCanvasId', 'notes', 'url', 'urlBy', 'data', 'createdCommit', 'updatedCommit',
];

/**
 * Düğümleri token verimli biçimde projekte eder. `fields` verilirse yalnız o alanlar (id her
 * zaman korunur, bilinmeyen adlar yok sayılır); yoksa `compact` sunum alanlarını (x/y/url/urlBy)
 * düşürür. İkisi de yoksa düğüm olduğu gibi döner.
 */
function projectNodes(nodes: PlanNode[], compact: boolean, fields?: string[]): Partial<PlanNode>[] {
  if (fields && fields.length > 0) {
    const keep = new Set<keyof PlanNode>(['id', ...fields.filter((f): f is keyof PlanNode => NODE_KEYS.includes(f as keyof PlanNode))]);
    return nodes.map((n) => Object.fromEntries(NODE_KEYS.filter((k) => keep.has(k)).map((k) => [k, n[k]])));
  }
  if (compact) {
    const drop = new Set<keyof PlanNode>(COMPACT_DROP);
    return nodes.map((n) => Object.fromEntries(NODE_KEYS.filter((k) => !drop.has(k)).map((k) => [k, n[k]])));
  }
  return nodes;
}

/**
 * Bir ajan token'ına bağlı, kanvas kapsamlı Co-Pronoia MCP sunucusu. Stateless kurulur:
 * her HTTP isteği için yeniden inşa edilir; süpervizör araçları yalnızca token'ın rolü
 * süpervizörse kaydedilir, böylece tools/list yeteneği dürüstçe yansıtır. Ajanların commit
 * aracı bilinçli olarak YOKTUR — main'e giden tek yol süpervizörün approve_proposal'ıdır.
 */
export function buildCoPronoiaServer(ctx: McpContext): McpServer {
  const { prisma, serviceFor, broadcast, events, token } = ctx;
  const canvasId = token.canvasId;
  const multiRole = token.roles.length > 1;

  const server = new McpServer({ name: 'co-pronoia', version: '0.1.0' });

  const refreshProposals = async () =>
    broadcast(canvasId, { type: 'proposals', proposals: await listProposals(prisma, canvasId) });
  const refreshClaims = async () =>
    broadcast(canvasId, { type: 'claims', claims: await listClaims(prisma, canvasId) });

  server.registerTool(
    'get_brief',
    {
      description:
        'Rol brifingini al: kimliğin, personan, kanvas bağlamı, diğer ajanlar, bölgeler ve çalışma kuralları. İlk çağrın bu olmalı. ' +
        'Bu bağlantı birden çok role bağlıysa "role" parametresiyle hangi rolle davranacağını belirt (yanıt bağlantının TÜM rollerini de listeler). ' +
        'Yanıtın başındaki "Sürüm (version)" statik brifing bağlamının (persona + rol kümesi + kadro + kanvas notu + bölgeler) imzasıdır; ' +
        'knownVersion ile bu değeri geri gönderirsen ve değişmediyse tam brifing yerine kısa bir "değişmedi" yanıtı döner — token tasarrufu.',
      inputSchema: { knownVersion: z.string().max(64).optional(), role: roleParam },
    },
    async ({ knownVersion, role: roleName }) => {
      const resolved = resolveActingRole(token, roleName);
      if ('error' in resolved) return errText(resolved.error);
      const role = resolved.role;
      const state = await serviceFor(canvasId).getState();
      const canvasBrief = await getBrief(prisma, canvasId);
      const regions = await listRegions(prisma, canvasId);
      const tokens = (await listAgentTokens(prisma, canvasId)).filter((t) => !t.revoked);
      const roster = tokens
        .map((t) => `- ${t.label} (${t.roles.map((r) => `${r.name}${r.isSupervisor ? '★' : ''}`).join(' + ')})`)
        .join('\n');
      const regionLines = regions.map(
        (r) => `- ${r.name}${r.aiAllowed ? '' : ' (yapay zekâya kapalı)'}${r.description ? `: ${r.description}` : ''}`,
      );
      const connectionRoles = token.roles.map((r) => ({ name: r.name, isSupervisor: r.isSupervisor }));
      // Sürüm imzası: yalnız STATİK bağlam (headSeq/düğüm sayısı gibi her commit'te değişen
      // canlı sayılar hariç). Rol kümesi de imzaya dahildir: bağlantının rolleri değişirse
      // (mint/rotate ile yeniden yapılandırma) sürüm de değişir. Böylece brifing gerçekten
      // değişmedikçe aynı kalır → ajan tekrar çekmez.
      const version = createHash('sha256')
        .update(JSON.stringify({
          selectedRole: role.name,
          persona: role.persona ?? '',
          isSupervisor: role.isSupervisor,
          connectionRoles,
          roster,
          brief: canvasBrief.content ?? '',
          briefRev: canvasBrief.revisionCount,
          regions: regions.map((r) => ({ name: r.name, description: r.description, aiAllowed: r.aiAllowed })),
        }))
        .digest('hex')
        .slice(0, 16);
      if (knownVersion !== undefined && knownVersion === version)
        return json({
          unchanged: true, version, headSeq: state.headSeq,
          note: 'Brifing değişmedi; mevcut brifini kullanmaya devam et.',
        });
      const supervisorRules = role.isSupervisor
        ? [
            'SEN SÜPERVİZÖRSÜN: diğer ajanların önerilerini list_proposals/get_proposal ile incele.',
            'Yeni/güncellenen önerileri beklerken list_proposals ile dönüp durma: wait_for_changes çağır — bir öneri değişince ya da yeni öneri gelince hemen döner, timedOut: true dönerse tekrar çağır.',
            'En uyumlu planı kur: uyumlu önerileri approve_proposal ile sırayla onayla (her onay güncel duruma karşı yeniden doğrulanır ve normal commit denetimlerinden geçer).',
            'Çakışan/uygunsuz önerilere reject_proposal, düzeltilebilir olanlara request_changes uygula (note alanına Türkçe gerekçe yaz).',
            'Gerekirse birleşik planı kendin submit_proposal ile önerip onaylayabilirsin.',
          ]
        : [
            'Öneri hazırla: get_state ile durumu oku, submit_proposal ile plan öner (title + summary + intents + baseSeq).',
            'Hiçbir önerin süpervizör onayı olmadan kanvasa uygulanmaz. Kararı beklerken list_proposals ile dönüp durma: wait_for_changes {proposalIds: [öneri id], sinceSeq: baseSeq} çağır — durum değişince ya da head ilerleyince hemen döner, timedOut: true dönerse tekrar çağır.',
            "request_changes gelirse update_proposal ile düzelt; vazgeçersen withdraw_proposal kullan.",
          ];
      const brief = [
        `# Co-Pronoia Brifingi — ${token.label}`,
        `Sürüm (version): ${version} — get_brief {knownVersion:"${version}"${multiRole ? `, role:"${role.name}"` : ''}} ile değişip değişmediğini az token'la yoklayabilirsin.`,
        '',
        `Kanvas: "${token.canvas.name}" (head commit: #${state.headSeq}, ${state.nodes.length} düğüm, ${state.edges.length} kenar)`,
        `Şu an davrandığın rol: ${role.name}${role.isSupervisor ? ' (SÜPERVİZÖR)' : ''}`,
        multiRole
          ? `Bu bağlantı BİRDEN ÇOK role bağlı: ${connectionRoles.map((r) => `${r.name}${r.isSupervisor ? ' (süpervizör)' : ''}`).join(', ')}. ` +
            'Rol değiştiren araçlarda (submit_proposal, update_proposal, claim_region, update_brief, get_brief) "role" parametresiyle hangi rolle davrandığını belirt.'
          : '',
        '',
        '## Personan',
        role.persona || '(persona tanımlanmamış — genel bir planlama ajanı gibi davran)',
        '',
        '## Bağlı ajanlar',
        roster || '(başka ajan yok)',
        '',
        '## Bölgeler',
        regionLines.length ? regionLines.join('\n') : '(bölge yok)',
        '',
        '## Kanvas notu (ortak çalışma brifingi)',
        canvasBrief.content || '(kanvas notu boş)',
        '',
        '## Kurallar',
        ...supervisorRules.map((r) => `- ${r}`),
        '- KANVAS NOTU yukarıda: kanvasın ortak çalışma anlaşmasıdır (hedefler, kararlar, kısıtlar). Plan üretmeden önce oku ve uy; önemli bir karar/kısıt değiştiğinde update_brief ile güncelle (mevcut içeriği koru, üstüne yaz değil düzenle).',
        '- intents, Co-Pronoia intent sözlüğünü kullanır: add_node, update_node, delete_node, move_node, add_edge, delete_edge.',
        '- Paralel çalışırken önce list_claims ile bak, üstleneceğin alanı claim_region {regionId} ile TTL boyunca üstlen (yumuşak lease — kilit değil, çakışan öneri üretmeyi azaltır); işin bitince release_claim ile bırak. claim_region conflict dönerse başka alana geç ya da süresinin dolmasını bekle.',
        '- Düğümlerde "notes" (uzun serbest markdown ayrıntı) ve "data" (anahtar-değer özel alanlar, ör. {"tahmin":"3g"}) alanları vardır: kısa title/description yetmediğinde ayrıntıyı bunlara yaz.',
        "- Yeni düğümlere kendi kısa id'lerini ver (ör. n1, n2) ki aynı öneri içindeki add_edge/parentId onlara bağlanabilsin.",
        '- baseSeq: öneriyi hazırlarken gördüğün head commit numarası (get_state.headSeq). Uygulama anında head ilerlediyse normal çakışma kuralları işler; çakışan öneri bir dala iner.',
        '- Tüm başlık/özet/not metinlerini Türkçe yaz.',
      ].join('\n');
      return text(brief);
    },
  );

  server.registerTool(
    'get_state',
    {
      description:
        'Kanvasın güncel durumu: düğümler, kenarlar, bölgeler ve head commit numarası (baseSeq için). JSON döner. ' +
        'Token verimliliği: sinceSeq verirsen yalnız o seq\'ten sonra değişen düğüm/kenarlar + silinen id\'ler döner ' +
        '(regions dahil edilmez — gerekirse list_regions çağır). compact:true sunum alanlarını (x/y/url/urlBy) düşürür; ' +
        'fields ile yalnız istediğin düğüm alanlarını seçebilirsin (id her zaman döner).',
      inputSchema: {
        sinceSeq: z.number().int().min(0).optional(),
        compact: z.boolean().optional(),
        fields: z.array(z.string()).max(20).optional(),
      },
    },
    async ({ sinceSeq, compact, fields }) => {
      const service = serviceFor(canvasId);
      const project = (nodes: PlanNode[]) => projectNodes(nodes, compact === true, fields);
      if (sinceSeq !== undefined) {
        const delta = await service.stateDelta(sinceSeq);
        return json({
          headSeq: delta.headSeq,
          sinceSeq: delta.sinceSeq,
          changedNodes: project(delta.changedNodes),
          deletedNodeIds: delta.deletedNodeIds,
          changedEdges: delta.changedEdges,
          deletedEdgeIds: delta.deletedEdgeIds,
        });
      }
      const state = await service.getState();
      const regions = await listRegions(prisma, canvasId);
      return json({
        headSeq: state.headSeq,
        nodes: project(state.nodes),
        edges: state.edges,
        regions: regions.map((r) => ({
          id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height,
          description: r.description, aiAllowed: r.aiAllowed,
        })),
      });
    },
  );

  server.registerTool(
    'list_regions',
    {
      description:
        'Kanvasın bölgelerini (owner-çizili dikdörtgenler) listele: id, ad, konum/boyut, açıklama, ' +
        'aiAllowed ve üye adları. Bölgeler olay-kaynaklı grafın parçası değil; düğüm/kenar erişimi bunlara göre sınırlanır.',
    },
    async () =>
      json(
        (await listRegions(prisma, canvasId)).map((r) => ({
          id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height,
          description: r.description, aiAllowed: r.aiAllowed, memberNames: r.memberNames,
        })),
      ),
  );

  // ---------- Yumuşak claim/lease (pl1) — DANIŞMA katmanı, tüm token'lara açık ----------
  // Kilit DEĞİL: commit yolu hâlâ tek otorite. Amaç paralel ajanların aynı alana boşuna öneri
  // üretmesini azaltmak. TTL ile kendiliğinden düşer; oran-sınırı thrash'i keser (deadlock imkânsız).
  server.registerTool(
    'list_claims',
    {
      description:
        'Kanvastaki canlı (süresi geçmemiş) yumuşak claim\'leri (lease) listele: hangi ajan hangi bölgeyi/düğümleri ' +
        'üstlenmiş, ne zaman düşecek. Bunlar DANIŞMADIR (kilit değil) — bir alanı claim eden ajan varken oraya öneri ' +
        'üretmemek boşa çabayı azaltır; ama commit yolu (çakışma→dal) hâlâ tek otoritedir.',
    },
    async () => json(await listClaims(prisma, canvasId)),
  );

  server.registerTool(
    'claim_region',
    {
      description:
        'Bir bölgeyi (regionId) YA DA düğüm kümesini (nodeIds) TTL boyunca geçici olarak üstlen (yumuşak lease). ' +
        'Aynı alanı başka bir ajan canlı tutuyorsa {ok:false, conflict:true, heldBy, expiresAt} döner — HATA değil, ' +
        'kendi kararını ver (başka alana geç ya da süresinin dolmasını bekle). Kendi claim\'ini yenilersen süresi uzar. ' +
        'ttlSec: 30-900 sn (öntanımlı 600). Kilit değildir: commit yolu yine tek otorite; claim yalnız koordinasyon içindir. ' +
        'Bu bağlantı birden çok role bağlıysa "role" parametresiyle hangi rolle üstlendiğini belirt.',
      inputSchema: {
        regionId: z.string().optional(),
        nodeIds: z.array(z.string()).max(200).optional(),
        ttlSec: z.number().int().min(1).optional(),
        role: roleParam,
      },
    },
    async ({ regionId, nodeIds, ttlSec, role: roleName }) => {
      const resolved = resolveActingRole(token, roleName);
      if ('error' in resolved) return errText(resolved.error);
      const result = await claimRegion({
        prisma, serviceFor, token, regionId, nodeIds, ttlSec, roleName: resolved.role.name,
      });
      if ('error' in result) return errText(result.error);
      await refreshClaims();
      if (!result.ok)
        return json({
          ok: false, conflict: true, heldBy: result.heldBy, expiresAt: result.expiresAt, overlap: result.overlap,
          note: `Bu alanı şu an ${result.heldBy} üstlenmiş (${result.expiresAt} tarihinde düşer). Başka bir alana geçebilir ya da bekleyebilirsin — bu bir kilit değil, danışmadır.`,
        });
      return json({ ok: true, claim: result.claim });
    },
  );

  server.registerTool(
    'release_claim',
    {
      description: 'Kendi yumuşak claim\'ini (lease) erkenden bırak. Yalnız kendi token\'ının claim\'ini bırakabilirsin.',
      inputSchema: { claimId: z.string() },
    },
    async ({ claimId }) => {
      const result = await releaseClaim(prisma, token, claimId);
      if ('error' in result) return errText(result.error);
      await refreshClaims();
      return json({ ok: true });
    },
  );

  server.registerTool(
    'list_proposals',
    {
      description:
        'Bu kanvastaki plan önerilerini listele (isteğe bağlı durum süzgeciyle). Token verimliliği: ' +
        'sinceUpdatedAt (ISO tarih) yalnız o andan sonra değişen önerileri döndürür (artımlı tarama), ' +
        'limit sonucu keser. Değişiklikleri beklerken wait_for_changes yeğdir.',
      inputSchema: {
        status: proposalStatus.optional(),
        sinceUpdatedAt: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ status, sinceUpdatedAt, limit }) =>
      json(await listProposals(prisma, canvasId, status, { sinceUpdatedAt, limit })),
  );

  server.registerTool(
    'get_proposal',
    {
      description: "Bir önerinin tüm detayını (intents dahil) getir.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const proposal = await getProposal(prisma, canvasId, id);
      return proposal ? json(proposal) : errText('öneri bulunamadı');
    },
  );

  server.registerTool(
    'list_agents',
    {
      description:
        'Bu kanvasa tanımlı ajan kadrosunu listele (etiket, roller, süpervizör mü, son görülme). ' +
        '`roles` her bağlantının davranabildiği TÜM rolleri gösterir — birden fazlaysa bu bağlantı çok rollüdür.',
    },
    async () => json(await listAgentTokens(prisma, canvasId)),
  );

  server.registerTool(
    'update_brief',
    {
      description:
        'Kanvas notunu (ortak çalışma brifingini) yeni içerikle değiştir. Tüm ajanlara açıktır; her yazma ' +
        'kim-yazdı iziyle yeni bir revizyon olarak saklanır. Mevcut içeriği get_brief ile oku, düzenlenmiş ' +
        'TAM metni gönder (yalnızca ek değil — içerik olduğu gibi yazılır). Bu bağlantı birden çok role bağlıysa ' +
        '"role" parametresiyle hangi rolle yazdığını belirt (iz kaydına yansır).',
      inputSchema: { content: z.string().max(MAX_BRIEF_LENGTH), role: roleParam },
    },
    async ({ content, role: roleName }) => {
      const resolved = resolveActingRole(token, roleName);
      if ('error' in resolved) return errText(resolved.error);
      const brief = await updateBrief(prisma, canvasId, content, `${token.label}/${resolved.role.name}`);
      broadcast(canvasId, { type: 'brief', brief });
      return json({ ok: true, revisionCount: brief.revisionCount, updatedAt: brief.updatedAt });
    },
  );

  server.registerTool(
    'wait_for_changes',
    {
      description:
        'Long-poll: kanvasta değişiklik bekle — list_proposals ile dönüp durmak yerine bunu kullan. ' +
        "Head commit sinceSeq'i geçince (verilmezse çağrı anındaki head esas alınır) YA DA izlenen bir önerinin " +
        'durumu değişince hemen döner (proposalIds verilmezse kanvasın tüm önerileri izlenir; yeni öneri de değişiklik sayılır). ' +
        'Kanvas notu (brief) güncellenince de döner (briefChanged: true). ' +
        "Değişiklik yoksa timeoutMs'e kadar (en çok 25 sn) bekleyip timedOut: true döner — o zaman tekrar çağır. " +
        'Dönüş: { headSeq, headAdvanced, changedProposals: [{id, status, branchName, appliedCommitSeq}], briefChanged, timedOut }.',
      inputSchema: {
        sinceSeq: z.number().int().min(0).optional(),
        proposalIds: z.array(z.string()).max(100).optional(),
        timeoutMs: z.number().int().min(0).max(WAIT_MAX_MS).optional(),
      },
    },
    async ({ sinceSeq, proposalIds, timeoutMs }, extra) => {
      const service = serviceFor(canvasId);
      const watchAll = proposalIds === undefined;
      const watchedIds = [...new Set(proposalIds ?? [])];
      const snapshot = async (): Promise<ProposalSnapshot> => {
        if (!watchAll && watchedIds.length === 0) return new Map();
        const rows = await prisma.planProposal.findMany({
          // Sorgu her zaman token'ın kanvasına sabitlenir: başka kanvasın önerileri görünmez,
          // yabancı id'ler hiçbir zaman eşleşmez (bilgi sızıntısı yok).
          where: watchAll ? { canvasId } : { canvasId, id: { in: watchedIds } },
          select: { id: true, status: true, branchName: true, appliedCommitSeq: true, updatedAt: true },
        });
        return new Map(rows.map((r) => [r.id, r]));
      };

      const latestBriefRevision = async () =>
        (await prisma.canvasBriefRevision.findFirst({
          where: { canvasId }, orderBy: { id: 'desc' }, select: { id: true },
        }))?.id ?? 0;

      // Referans noktası çağrı anıdır; sinyal aboneliği ilk kontrolden ÖNCE kurulur ki
      // kontrol ile bekleme arasına düşen bir değişiklik kaçmasın (sinyal → yeniden kontrol).
      const baselineHead = sinceSeq ?? (await service.headSeq());
      const baseline = await snapshot();
      const baselineBrief = await latestBriefRevision();
      const deadline = Date.now() + (timeoutMs ?? WAIT_DEFAULT_MS);

      let signaled = false;
      let wake: (() => void) | null = null;
      const unsubscribe = events.subscribe(canvasId, () => {
        signaled = true;
        wake?.();
      });
      try {
        while (true) {
          const headSeq = await service.headSeq();
          const changedProposals = diffProposals(baseline, await snapshot());
          const headAdvanced = headSeq > baselineHead;
          const briefChanged = (await latestBriefRevision()) > baselineBrief;
          if (headAdvanced || changedProposals.length > 0 || briefChanged)
            return json({ headSeq, headAdvanced, changedProposals, briefChanged, timedOut: false });
          const remaining = deadline - Date.now();
          if (remaining <= 0 || extra.signal.aborted)
            return json({ headSeq, headAdvanced: false, changedProposals: [], briefChanged: false, timedOut: true });
          if (!signaled) {
            // Sinyale, kalan süreye ya da istemcinin isteği iptaline kadar uyu (DB polling yok).
            await new Promise<void>((resolve) => {
              const timer = setTimeout(done, remaining);
              function done() {
                clearTimeout(timer);
                extra.signal.removeEventListener('abort', done);
                wake = null;
                resolve();
              }
              wake = done;
              extra.signal.addEventListener('abort', done, { once: true });
            });
          }
          signaled = false;
        }
      } finally {
        unsubscribe();
      }
    },
  );

  server.registerTool(
    'submit_proposal',
    {
      description:
        'Yeni bir plan önerisi gönder. intents güncel duruma karşı denenerek doğrulanır; uygulanmaz — süpervizör onayını bekler. ' +
        'Bu bağlantı birden çok role bağlıysa "role" parametresiyle hangi rol adına önerdiğini belirt (roleName önerinin üstünde görünür).',
      inputSchema: {
        title: z.string().min(1).max(120),
        summary: z.string().max(2000).optional(),
        intents: z.array(opInputSchema).min(1).max(200),
        baseSeq: z.number().int().min(0),
        role: roleParam,
      },
    },
    async ({ title, summary, intents, baseSeq, role: roleName }) => {
      const resolved = resolveActingRole(token, roleName);
      if ('error' in resolved) return errText(resolved.error);
      const result = await submitProposal({
        prisma, serviceFor, token, title, summary, intents, baseSeq, roleName: resolved.role.name,
      });
      if ('error' in result) return errText(result.error);
      await refreshProposals();
      // Danışma (pl1c): öneri başka bir ajanın canlı claim'iyle örtüşüyorsa uyar — bloklamadan.
      const claimWarnings = await claimWarningsForIntents(prisma, serviceFor, token, intents);
      return json({
        id: result.id, status: result.status, intentCount: result.intentCount,
        ...(claimWarnings.length > 0
          ? { claimWarnings, note: 'Bu öneri, başka ajanların üstlendiği (claim) düğümlere dokunuyor; süpervizör onayında çakışabilir.' }
          : {}),
      });
    },
  );

  server.registerTool(
    'update_proposal',
    {
      description:
        "Kendi açık önerini güncelle (değişiklik istendiğinde ya da planı iyileştirmek için); durum 'submitted'a döner. " +
        'Bu bağlantı birden çok role bağlıysa "role" parametresiyle hangi rol adına güncellediğini belirt (önerinin roleName\'i buna güncellenir).',
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).max(120).optional(),
        summary: z.string().max(2000).optional(),
        intents: z.array(opInputSchema).min(1).max(200).optional(),
        baseSeq: z.number().int().min(0).optional(),
        role: roleParam,
      },
    },
    async ({ id, title, summary, intents, baseSeq, role: roleName }) => {
      const resolved = resolveActingRole(token, roleName);
      if ('error' in resolved) return errText(resolved.error);
      const result = await updateProposal({
        prisma, serviceFor, token, id, title, summary, intents, baseSeq, roleName: resolved.role.name,
      });
      if ('error' in result) return errText(result.error);
      await refreshProposals();
      return json({ id: result.id, status: result.status, intentCount: result.intentCount });
    },
  );

  server.registerTool(
    'withdraw_proposal',
    { description: 'Kendi açık önerini geri çek.', inputSchema: { id: z.string() } },
    async ({ id }) => {
      const result = await withdrawProposal(prisma, token, id);
      if ('error' in result) return errText(result.error);
      await refreshProposals();
      return json({ id: result.id, status: result.status });
    },
  );

  // Süpervizör araçları, bağlantının rollerinden HERHANGİ BİRİ süpervizörse kaydedilir (tools/list
  // yeteneği dürüstçe yansısın diye) — ama ÇAĞRI ANINDA davranılan rol (role parametresi, çok
  // rollü bağlantıda zorunlu) süpervizör olmalı: çok rollü bir bağlantıda teknik rolle onay verilemez.
  const hasSupervisorRole = token.roles.some((r) => r.isSupervisor);
  /** role parametresini çözer VE seçilen rolün süpervizör olduğunu doğrular (Türkçe hata döner). */
  const resolveSupervisorRole = (roleName?: string): { role: AgentRoleDef } | { error: string } => {
    const resolved = resolveActingRole(token, roleName);
    if ('error' in resolved) return resolved;
    if (!resolved.role.isSupervisor) return { error: `seçili rol ("${resolved.role.name}") süpervizör değil — bu aracı yalnızca süpervizör bir rolle çağırabilirsin` };
    return resolved;
  };

  if (hasSupervisorRole) {
    server.registerTool(
      'approve_proposal',
      {
        description:
          'SÜPERVİZÖR: öneriyi onayla ve uygula. Öneri normal commit hattından geçer (doğrulama + bölge koruması + çakışma kuralları); çakışırsa bir dala iner. ' +
          'Bu bağlantı birden çok role bağlıysa "role" parametresiyle süpervizör rolünü belirt.',
        inputSchema: { id: z.string(), note: z.string().max(2000).optional(), role: roleParam },
      },
      async ({ id, note, role: roleName }) => {
        const resolved = resolveSupervisorRole(roleName);
        if ('error' in resolved) return errText(resolved.error);
        const supervisorLabel = `${token.label}/${resolved.role.name}`;
        const result = await approveProposal({ prisma, serviceFor, canvasId, id, note, supervisorLabel });
        if ('error' in result) return errText(result.error);
        const { outcome, proposal } = result;
        if (outcome.result === 'committed') {
          broadcast(canvasId, { type: 'commit', commit: outcome.commit, state: outcome.state, clientId: null });
        } else {
          broadcast(canvasId, { type: 'branch_created', branch: outcome.branch, clientId: null });
        }
        await refreshProposals();
        return outcome.result === 'committed'
          ? text(`Öneri uygulandı: commit #${proposal.appliedCommitSeq}.`)
          : text(`Öneri çakıştığı için "${proposal.branchName}" dalına kaydedildi; Dallar panelinden birleştirilebilir.`);
      },
    );

    server.registerTool(
      'reject_proposal',
      {
        description: 'SÜPERVİZÖR: öneriyi gerekçesiyle reddet (uygulanmaz, kapanır).',
        inputSchema: { id: z.string(), note: z.string().min(1).max(2000), role: roleParam },
      },
      async ({ id, note, role: roleName }) => {
        const resolved = resolveSupervisorRole(roleName);
        if ('error' in resolved) return errText(resolved.error);
        const result = await decideProposal(prisma, canvasId, id, 'rejected', note, `${token.label}/${resolved.role.name}`);
        if ('error' in result) return errText(result.error);
        await refreshProposals();
        return json({ id: result.id, status: result.status });
      },
    );

    server.registerTool(
      'request_changes',
      {
        description: 'SÜPERVİZÖR: öneride değişiklik iste; sahibi update_proposal ile düzeltebilir.',
        inputSchema: { id: z.string(), note: z.string().min(1).max(2000), role: roleParam },
      },
      async ({ id, note, role: roleName }) => {
        const resolved = resolveSupervisorRole(roleName);
        if ('error' in resolved) return errText(resolved.error);
        const result = await decideProposal(prisma, canvasId, id, 'changes_requested', note, `${token.label}/${resolved.role.name}`);
        if ('error' in result) return errText(result.error);
        await refreshProposals();
        return json({ id: result.id, status: result.status });
      },
    );
  }

  // Bölge oluşturma süpervizöre açıktır (approve_proposal ile aynı koordinasyon-düzeyi yetki).
  // Tüm ajan token'ları owner tarafından mint edilir; anlamlı ayrım owner-mint değil isSupervisor'dür.
  // Bölgeler owner config'idir, olay-kaynaklı graf DEĞİL: commit üretmez, doğrudan yazılır (actor=owner).
  // Süpervizör rolü yoksa araç HİÇ kaydedilmez, böylece tools/list yeteneği dürüstçe yansıtır.
  if (hasSupervisorRole) {
    server.registerTool(
      'create_region',
      {
        description:
          'SÜPERVİZÖR: kanvasta yeni bir bölge (dikdörtgen) çiz. Bölge içi düğümlere yalnız bölge üyeleri ' +
          'dokunabilir (owner bypass); aiAllowed:false ise yerleşik ajan bölgeye dokunamaz. ' +
          'Olay-kaynaklı graf değil config: commit üretmez. Koordinatlar flow-görünümü düzlemindedir (get_state.regions ile aynı). ' +
          'Bu bağlantı birden çok role bağlıysa "role" parametresiyle süpervizör rolünü belirt.',
        inputSchema: {
          name: z.string().min(1).max(120),
          x: z.number().finite(),
          y: z.number().finite(),
          width: z.number().finite().positive(),
          height: z.number().finite().positive(),
          color: z.string().max(32).optional(),
          description: z.string().max(500).optional(),
          aiAllowed: z.boolean().optional(),
          role: roleParam,
        },
      },
      async ({ name, x, y, width, height, color, description, aiAllowed, role: roleName }) => {
        const resolved = resolveSupervisorRole(roleName);
        if ('error' in resolved) return errText(resolved.error);
        const region = await createRegion(prisma, canvasId, {
          name: name.trim(), x, y, width, height,
          ...(color ? { color } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(aiAllowed !== undefined ? { aiAllowed } : {}),
        });
        broadcast(canvasId, { type: 'regions', regions: await listRegions(prisma, canvasId) });
        return json({ id: region.id, name: region.name, aiAllowed: region.aiAllowed });
      },
    );
  }

  return server;
}
