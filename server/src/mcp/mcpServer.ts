import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ServerMessage } from '@treemapper/shared';
import { listRegions, type ServiceFor } from '../canvasService.js';
import { listAgentTokens, type ResolvedAgentToken } from '../agentRoleService.js';
import {
  approveProposal, decideProposal, getProposal, listProposals, submitProposal,
  updateProposal, withdrawProposal,
} from '../proposalService.js';
import { opInputSchema } from './schemas.js';

export interface McpContext {
  prisma: PrismaClient;
  serviceFor: ServiceFor;
  broadcast: (canvasId: string, msg: ServerMessage) => void;
  token: ResolvedAgentToken;
}

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
  const { prisma, serviceFor, broadcast, token } = ctx;
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
      const tokens = (await listAgentTokens(prisma, canvasId)).filter((t) => !t.revoked);
      const roster = tokens
        .map((t) => `- ${t.label} (${t.roleName}${t.isSupervisor ? ', süpervizör' : ''})`)
        .join('\n');
      const supervisorRules = token.role.isSupervisor
        ? [
            'SEN SÜPERVİZÖRSÜN: diğer ajanların önerilerini list_proposals/get_proposal ile incele.',
            'En uyumlu planı kur: uyumlu önerileri approve_proposal ile sırayla onayla (her onay güncel duruma karşı yeniden doğrulanır ve normal commit denetimlerinden geçer).',
            'Çakışan/uygunsuz önerilere reject_proposal, düzeltilebilir olanlara request_changes uygula (note alanına Türkçe gerekçe yaz).',
            'Gerekirse birleşik planı kendin submit_proposal ile önerip onaylayabilirsin.',
          ]
        : [
            'Öneri hazırla: get_state ile durumu oku, submit_proposal ile plan öner (title + summary + intents + baseSeq).',
            'Hiçbir önerin süpervizör onayı olmadan kanvasa uygulanmaz. Kararları düzenli aralıklarla list_proposals ile yokla.',
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
        '## Kurallar',
        ...supervisorRules.map((r) => `- ${r}`),
        '- intents, TreeMapper intent sözlüğünü kullanır: add_node, update_node, delete_node, move_node, add_edge, delete_edge.',
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
