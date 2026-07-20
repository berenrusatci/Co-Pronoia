import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ServerMessage } from '@treemapper/shared';
import { listRegions, type ServiceFor } from '../canvasService.js';
import type { CanvasEvents } from '../canvasEvents.js';
import { listAgentTokens, type ResolvedAgentToken } from '../agentRoleService.js';
import {
  approveProposal, decideProposal, getProposal, listProposals, submitProposal,
  updateProposal, withdrawProposal,
} from '../proposalService.js';
import { getBrief, updateBrief, MAX_BRIEF_LENGTH } from '../briefService.js';
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

const proposalStatus = z.enum(['submitted', 'changes_requested', 'withdrawn', 'rejected', 'applied']);

/**
 * Bir ajan token'ına bağlı, kanvas kapsamlı Co-Pronoia MCP sunucusu. Stateless kurulur:
 * her HTTP isteği için yeniden inşa edilir; süpervizör araçları yalnızca token'ın rolü
 * süpervizörse kaydedilir, böylece tools/list yeteneği dürüstçe yansıtır. Ajanların commit
 * aracı bilinçli olarak YOKTUR — main'e giden tek yol süpervizörün approve_proposal'ıdır.
 */
export function buildCoPronoiaServer(ctx: McpContext): McpServer {
  const { prisma, serviceFor, broadcast, events, token } = ctx;
  const canvasId = token.canvasId;
  const label = `${token.label}/${token.role.name}`;

  const server = new McpServer({ name: 'treemapper-co-pronoia', version: '0.1.0' });

  const refreshProposals = async () =>
    broadcast(canvasId, { type: 'proposals', proposals: await listProposals(prisma, canvasId) });

  server.registerTool(
    'get_brief',
    {
      description:
        'Rol brifingini al: kimliğin, personan, kanvas bağlamı, diğer ajanlar ve çalışma kuralları. İlk çağrın bu olmalı.',
    },
    async () => {
      const state = await serviceFor(canvasId).getState();
      const canvasBrief = await getBrief(prisma, canvasId);
      const tokens = (await listAgentTokens(prisma, canvasId)).filter((t) => !t.revoked);
      const roster = tokens
        .map((t) => `- ${t.label} (${t.roleName}${t.isSupervisor ? ', süpervizör' : ''})`)
        .join('\n');
      const supervisorRules = token.role.isSupervisor
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
        '',
        `Kanvas: "${token.canvas.name}" (head commit: #${state.headSeq}, ${state.nodes.length} düğüm, ${state.edges.length} kenar)`,
        `Rolün: ${token.role.name}${token.role.isSupervisor ? ' (SÜPERVİZÖR)' : ''}`,
        '',
        '## Personan',
        token.role.persona || '(persona tanımlanmamış — genel bir planlama ajanı gibi davran)',
        '',
        '## Bağlı ajanlar',
        roster || '(başka ajan yok)',
        '',
        '## Kanvas notu (ortak çalışma brifingi)',
        canvasBrief.content || '(kanvas notu boş)',
        '',
        '## Kurallar',
        ...supervisorRules.map((r) => `- ${r}`),
        '- KANVAS NOTU yukarıda: kanvasın ortak çalışma anlaşmasıdır (hedefler, kararlar, kısıtlar). Plan üretmeden önce oku ve uy; önemli bir karar/kısıt değiştiğinde update_brief ile güncelle (mevcut içeriği koru, üstüne yaz değil düzenle).',
        '- intents, TreeMapper intent sözlüğünü kullanır: add_node, update_node, delete_node, move_node, add_edge, delete_edge.',
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
        'Kanvasın güncel durumu: düğümler, kenarlar, bölgeler ve head commit numarası (baseSeq için). JSON döner.',
    },
    async () => {
      const state = await serviceFor(canvasId).getState();
      const regions = await listRegions(prisma, canvasId);
      return json({
        headSeq: state.headSeq,
        nodes: state.nodes,
        edges: state.edges,
        regions: regions.map((r) => ({
          id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height,
          description: r.description, aiAllowed: r.aiAllowed,
        })),
      });
    },
  );

  server.registerTool(
    'list_proposals',
    {
      description: 'Bu kanvastaki plan önerilerini listele (isteğe bağlı durum süzgeciyle).',
      inputSchema: { status: proposalStatus.optional() },
    },
    async ({ status }) => json(await listProposals(prisma, canvasId, status)),
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
    { description: 'Bu kanvasa tanımlı ajan kadrosunu listele (etiket, rol, süpervizör mü, son görülme).' },
    async () => json(await listAgentTokens(prisma, canvasId)),
  );

  server.registerTool(
    'update_brief',
    {
      description:
        'Kanvas notunu (ortak çalışma brifingini) yeni içerikle değiştir. Tüm ajanlara açıktır; her yazma ' +
        'kim-yazdı iziyle yeni bir revizyon olarak saklanır. Mevcut içeriği get_brief ile oku, düzenlenmiş ' +
        'TAM metni gönder (yalnızca ek değil — içerik olduğu gibi yazılır).',
      inputSchema: { content: z.string().max(MAX_BRIEF_LENGTH) },
    },
    async ({ content }) => {
      const brief = await updateBrief(prisma, canvasId, content, label);
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
        'Yeni bir plan önerisi gönder. intents güncel duruma karşı denenerek doğrulanır; uygulanmaz — süpervizör onayını bekler.',
      inputSchema: {
        title: z.string().min(1).max(120),
        summary: z.string().max(2000).optional(),
        intents: z.array(opInputSchema).min(1).max(200),
        baseSeq: z.number().int().min(0),
      },
    },
    async ({ title, summary, intents, baseSeq }) => {
      const result = await submitProposal({ prisma, serviceFor, token, title, summary, intents, baseSeq });
      if ('error' in result) return errText(result.error);
      await refreshProposals();
      return json({ id: result.id, status: result.status, intentCount: result.intentCount });
    },
  );

  server.registerTool(
    'update_proposal',
    {
      description:
        "Kendi açık önerini güncelle (değişiklik istendiğinde ya da planı iyileştirmek için); durum 'submitted'a döner.",
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).max(120).optional(),
        summary: z.string().max(2000).optional(),
        intents: z.array(opInputSchema).min(1).max(200).optional(),
        baseSeq: z.number().int().min(0).optional(),
      },
    },
    async ({ id, title, summary, intents, baseSeq }) => {
      const result = await updateProposal({ prisma, serviceFor, token, id, title, summary, intents, baseSeq });
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

  if (token.role.isSupervisor) {
    server.registerTool(
      'approve_proposal',
      {
        description:
          'SÜPERVİZÖR: öneriyi onayla ve uygula. Öneri normal commit hattından geçer (doğrulama + bölge koruması + çakışma kuralları); çakışırsa bir dala iner.',
        inputSchema: { id: z.string(), note: z.string().max(2000).optional() },
      },
      async ({ id, note }) => {
        const result = await approveProposal({ prisma, serviceFor, canvasId, id, note, supervisorLabel: label });
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
        inputSchema: { id: z.string(), note: z.string().min(1).max(2000) },
      },
      async ({ id, note }) => {
        const result = await decideProposal(prisma, canvasId, id, 'rejected', note, label);
        if ('error' in result) return errText(result.error);
        await refreshProposals();
        return json({ id: result.id, status: result.status });
      },
    );

    server.registerTool(
      'request_changes',
      {
        description: 'SÜPERVİZÖR: öneride değişiklik iste; sahibi update_proposal ile düzeltebilir.',
        inputSchema: { id: z.string(), note: z.string().min(1).max(2000) },
      },
      async ({ id, note }) => {
        const result = await decideProposal(prisma, canvasId, id, 'changes_requested', note, label);
        if ('error' in result) return errText(result.error);
        await refreshProposals();
        return json({ id: result.id, status: result.status });
      },
    );
  }

  return server;
}
