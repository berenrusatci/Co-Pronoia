import type { PrismaClient } from '@prisma/client';
import {
  expandAll, OpError, ValidationError,
  type Graph, type OpInput, type PlanProposalInfo, type ProposalStatus,
} from '@co-pronoia/shared';
import { memberRole, type ServiceFor } from './canvasService.js';
import { ConflictError, RegionError, type CommitOutcome } from './commitService.js';
import type { ResolvedAgentToken } from './agentRoleService.js';

const MAX_TITLE = 120;
const MAX_SUMMARY = 2000;
const MAX_INTENTS = 200;

/** Öneri hâlâ karar bekliyor mu (güncellenebilir / karar verilebilir)? */
const OPEN_STATUSES: ProposalStatus[] = ['submitted', 'changes_requested'];

type ProposalRow = {
  id: string; agentLabel: string; roleName: string; title: string; summary: string;
  intents: string; baseSeq: number; status: string; supervisorNote: string;
  decidedByLabel: string | null; appliedCommitSeq: number | null; branchName: string | null;
  createdAt: Date; updatedAt: Date; tokenId: string | null;
};

const toInfo = (p: ProposalRow): PlanProposalInfo => ({
  id: p.id,
  agentLabel: p.agentLabel,
  roleName: p.roleName,
  title: p.title,
  summary: p.summary,
  intentCount: (JSON.parse(p.intents) as OpInput[]).length,
  baseSeq: p.baseSeq,
  status: p.status as ProposalStatus,
  supervisorNote: p.supervisorNote,
  decidedByLabel: p.decidedByLabel,
  appliedCommitSeq: p.appliedCommitSeq,
  branchName: p.branchName,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

/**
 * Öneri listeleme sayfalama/süzgeç seçenekleri (MCP token verimliliği): `sinceUpdatedAt`
 * yalnız o andan SONRA değişen önerileri döndürür (artımlı tarama), `limit` sonucu keser.
 * Hiçbiri verilmezse davranış eskisiyle birebir aynıdır (createdAt asc, tümü) — web/WS yolu bunu kullanır.
 */
export interface ListProposalsOptions {
  /** ISO tarih dizesi; updatedAt bundan büyük (strictly after) olan öneriler döner. */
  sinceUpdatedAt?: string;
  /** En çok kaç öneri döndürüleceği (createdAt asc sıralamasının başından). */
  limit?: number;
}

export async function listProposals(
  prisma: PrismaClient,
  canvasId: string,
  status?: ProposalStatus,
  opts: ListProposalsOptions = {},
): Promise<PlanProposalInfo[]> {
  const since = opts.sinceUpdatedAt ? new Date(opts.sinceUpdatedAt) : undefined;
  const rows = await prisma.planProposal.findMany({
    where: {
      canvasId,
      ...(status ? { status } : {}),
      ...(since && !Number.isNaN(since.getTime()) ? { updatedAt: { gt: since } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    ...(opts.limit !== undefined ? { take: opts.limit } : {}),
  });
  return rows.map(toInfo);
}

export async function getProposal(
  prisma: PrismaClient,
  canvasId: string,
  id: string,
): Promise<(PlanProposalInfo & { intents: OpInput[] }) | null> {
  const row = await prisma.planProposal.findFirst({ where: { id, canvasId } });
  if (!row) return null;
  return { ...toInfo(row), intents: JSON.parse(row.intents) as OpInput[] };
}

/**
 * Intent doğrulaması: sınırlar + güncel duruma karşı deneme genişletmesi (shared expandAll).
 * Yalnızca erken geri bildirim içindir — bağlayıcı denetim onay anındaki commit'te tekrarlanır.
 */
async function validateIntents(
  serviceFor: ServiceFor,
  canvasId: string,
  intents: unknown,
  baseSeq: unknown,
): Promise<{ error: string } | { intents: OpInput[]; baseSeq: number; headSeq: number }> {
  if (!Array.isArray(intents) || intents.length === 0)
    return { error: 'öneri en az bir işlem (intents) içermeli' };
  if (intents.length > MAX_INTENTS) return { error: `öneri en fazla ${MAX_INTENTS} işlem içerebilir` };
  const state = await serviceFor(canvasId).getState();
  if (typeof baseSeq !== 'number' || !Number.isInteger(baseSeq) || baseSeq < 0 || baseSeq > state.headSeq)
    return { error: `baseSeq 0 ile ${state.headSeq} (güncel head) arasında bir tamsayı olmalı` };
  const graph: Graph = {
    nodes: new Map(state.nodes.map((n) => [n.id, { ...n }])),
    edges: new Map(state.edges.map((e) => [e.id, { ...e }])),
  };
  try {
    expandAll(graph, intents as OpInput[]);
  } catch (err) {
    if (err instanceof ValidationError || err instanceof OpError)
      return { error: `işlemler güncel duruma uygulanamıyor: ${err.message}` };
    throw err;
  }
  return { intents: intents as OpInput[], baseSeq, headSeq: state.headSeq };
}

export async function submitProposal(opts: {
  prisma: PrismaClient;
  serviceFor: ServiceFor;
  token: ResolvedAgentToken;
  title: string;
  summary?: string;
  intents: unknown;
  baseSeq: unknown;
  /** Çok rollü token'da davranılan rolün adı (bkz. mcpServer resolveActingRole); tek rollüde birincil role düşer. */
  roleName?: string;
}): Promise<PlanProposalInfo | { error: string }> {
  const title = opts.title.trim().slice(0, MAX_TITLE);
  if (!title) return { error: 'öneri başlığı gerekli' };
  const canvasId = opts.token.canvasId;
  const checked = await validateIntents(opts.serviceFor, canvasId, opts.intents, opts.baseSeq);
  if ('error' in checked) return checked;
  const row = await opts.prisma.planProposal.create({
    data: {
      canvasId,
      tokenId: opts.token.id,
      agentLabel: opts.token.label,
      roleName: opts.roleName ?? opts.token.role.name,
      title,
      summary: (opts.summary ?? '').slice(0, MAX_SUMMARY),
      intents: JSON.stringify(checked.intents),
      baseSeq: checked.baseSeq,
    },
  });
  return toInfo(row);
}

/** Yalnızca önerinin sahibi (aynı token) ve öneri açıkken; güncelleme durumu 'submitted'a döndürür. */
export async function updateProposal(opts: {
  prisma: PrismaClient;
  serviceFor: ServiceFor;
  token: ResolvedAgentToken;
  id: string;
  title?: string;
  summary?: string;
  intents?: unknown;
  baseSeq?: unknown;
  /** Çok rollü token'da davranılan rolün adı; verilirse önerinin roleName'i buna güncellenir. */
  roleName?: string;
}): Promise<PlanProposalInfo | { error: string }> {
  const existing = await opts.prisma.planProposal.findFirst({
    where: { id: opts.id, canvasId: opts.token.canvasId },
  });
  if (!existing) return { error: 'öneri bulunamadı' };
  if (existing.tokenId !== opts.token.id) return { error: 'yalnızca kendi önerinizi güncelleyebilirsiniz' };
  if (!OPEN_STATUSES.includes(existing.status as ProposalStatus))
    return { error: `'${existing.status}' durumundaki öneri güncellenemez` };

  let intentsJson = existing.intents;
  let baseSeq = existing.baseSeq;
  if (opts.intents !== undefined || opts.baseSeq !== undefined) {
    const checked = await validateIntents(
      opts.serviceFor,
      opts.token.canvasId,
      opts.intents ?? (JSON.parse(existing.intents) as OpInput[]),
      opts.baseSeq ?? existing.baseSeq,
    );
    if ('error' in checked) return checked;
    intentsJson = JSON.stringify(checked.intents);
    baseSeq = checked.baseSeq;
  }
  const title = opts.title !== undefined ? opts.title.trim().slice(0, MAX_TITLE) : existing.title;
  if (!title) return { error: 'öneri başlığı gerekli' };
  const row = await opts.prisma.planProposal.update({
    where: { id: existing.id },
    data: {
      title,
      ...(opts.summary !== undefined ? { summary: opts.summary.slice(0, MAX_SUMMARY) } : {}),
      ...(opts.roleName !== undefined ? { roleName: opts.roleName } : {}),
      intents: intentsJson,
      baseSeq,
      status: 'submitted',
    },
  });
  return toInfo(row);
}

export async function withdrawProposal(
  prisma: PrismaClient,
  token: ResolvedAgentToken,
  id: string,
): Promise<PlanProposalInfo | { error: string }> {
  const existing = await prisma.planProposal.findFirst({ where: { id, canvasId: token.canvasId } });
  if (!existing) return { error: 'öneri bulunamadı' };
  if (existing.tokenId !== token.id) return { error: 'yalnızca kendi önerinizi geri çekebilirsiniz' };
  if (!OPEN_STATUSES.includes(existing.status as ProposalStatus))
    return { error: `'${existing.status}' durumundaki öneri geri çekilemez` };
  const row = await prisma.planProposal.update({ where: { id }, data: { status: 'withdrawn' } });
  return toInfo(row);
}

/** Süpervizörün (ya da temizlik için kanvas sahibinin) reddi / değişiklik isteği. */
export async function decideProposal(
  prisma: PrismaClient,
  canvasId: string,
  id: string,
  decision: 'rejected' | 'changes_requested',
  note: string,
  decidedByLabel: string,
): Promise<PlanProposalInfo | { error: string }> {
  const existing = await prisma.planProposal.findFirst({ where: { id, canvasId } });
  if (!existing) return { error: 'öneri bulunamadı' };
  if (!OPEN_STATUSES.includes(existing.status as ProposalStatus))
    return { error: `'${existing.status}' durumundaki öneri için karar verilemez` };
  const row = await prisma.planProposal.update({
    where: { id },
    data: { status: decision, supervisorNote: note.slice(0, MAX_SUMMARY), decidedByLabel },
  });
  return toInfo(row);
}

/**
 * Süpervizör onayı = "süpervizör + kod birlikte denetler" noktası: öneri, normal
 * CommitService.commit hattından uygulanır (deneme replay, bölge koruması, bağlı-kanvas
 * doğrulaması, çakışma kuralları aynen çalışır). Actor, öneri token'ını basan kullanıcıdır —
 * yerleşik ajanın "istek sahibi actor'dür" ilkesinin aynısı. Bayat baseSeq çakışırsa öneri
 * normal dal mekanizmasıyla bir dala iner ve branchName ile işaretlenir.
 */
export async function approveProposal(opts: {
  prisma: PrismaClient;
  serviceFor: ServiceFor;
  canvasId: string;
  id: string;
  note?: string;
  supervisorLabel: string;
}): Promise<{ proposal: PlanProposalInfo; outcome: CommitOutcome } | { error: string }> {
  const { prisma, canvasId } = opts;
  const existing = await prisma.planProposal.findFirst({
    where: { id: opts.id, canvasId },
    include: { token: { include: { createdBy: { select: { id: true } } } } },
  });
  if (!existing) return { error: 'öneri bulunamadı' };
  if (!OPEN_STATUSES.includes(existing.status as ProposalStatus))
    return { error: `'${existing.status}' durumundaki öneri onaylanamaz` };
  if (!existing.token)
    return { error: 'öneri sahibinin anahtarı silinmiş — uygulanamaz' };
  const creatorId = existing.token.createdBy.id;
  const role = await memberRole(prisma, canvasId, creatorId);
  if (!role) return { error: 'anahtarı basan kullanıcı artık kanvas üyesi değil — uygulanamaz' };
  if (role === 'viewer') return { error: 'anahtarı basan kullanıcı görüntüleyici — değişiklik uygulanamaz' };

  const intents = JSON.parse(existing.intents) as OpInput[];
  let outcome: CommitOutcome;
  try {
    outcome = await opts.serviceFor(canvasId).commit(intents, {
      message: `ajan önerisi: ${existing.title} (${existing.agentLabel}/${existing.roleName}, onay: ${opts.supervisorLabel})`,
      baseSeq: existing.baseSeq,
      authorId: creatorId,
      actor: { userId: creatorId, role },
    });
  } catch (err) {
    if (err instanceof RegionError || err instanceof ValidationError || err instanceof ConflictError || err instanceof OpError)
      return { error: `öneri uygulanamadı: ${err.message}` };
    throw err;
  }

  const note = (opts.note ?? '').slice(0, MAX_SUMMARY);
  const row = await prisma.planProposal.update({
    where: { id: existing.id },
    data: {
      status: 'applied',
      decidedByLabel: opts.supervisorLabel,
      ...(outcome.result === 'committed'
        ? { appliedCommitSeq: outcome.commit.seq, supervisorNote: note }
        : {
            branchName: outcome.branch.name,
            supervisorNote: [note, `çakışma: öneri "${outcome.branch.name}" dalına kaydedildi; Dallar panelinden birleştirilebilir.`]
              .filter(Boolean).join(' '),
          }),
    },
  });
  return { proposal: toInfo(row), outcome };
}
