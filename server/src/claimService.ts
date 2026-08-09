import type { PrismaClient } from '@prisma/client';
import type { NodeClaimInfo, OpInput, PlanNode, RegionInfo } from '@co-pronoia/shared';
import { listRegions, type ServiceFor } from './canvasService.js';
import type { ResolvedAgentToken } from './agentRoleService.js';

/**
 * Yumuşak claim/lease (pl1) — DANIŞMA katmanı, kilit DEĞİL.
 *
 * Commit yolu (opsConflict + branch) hâlâ TEK OTORİTEDİR: bir claim hiçbir commit'i bloke etmez.
 * Amaç yalnız paralel ajanların aynı alana aynı anda boşuna öneri üretmesini azaltmaktır.
 * Kilitlenme (deadlock) tasarımca imkânsız: her claim TTL ile kendiliğinden düşer, sahibi
 * release_claim ile bırakabilir, kanvas sahibi UI'dan zorla düşürebilir. Ek emniyet olarak
 * yazma çağrıları token başına oran-sınırlıdır (claim/release thrash'ini keser).
 */

// TTL sınırları (saniye): min 30sn, öntanımlı 10dk, en çok 15dk. Süresiz sahiplik yok.
const MIN_TTL = 30;
const DEFAULT_TTL = 600;
const MAX_TTL = 900;

// Oran sınırı: token başına 60 sn içinde en çok bu kadar yazma (claim/release) çağrısı.
// Stateless MCP sunucusu her istekte yeniden kurulduğundan sayaç modül düzeyinde (süreç ömrü) tutulur.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const writeCalls = new Map<string, number[]>();

/** True dönerse çağrı reddedilmeli (oran aşıldı). Her çağrıyı da kaydeder. */
function rateLimited(tokenId: string): boolean {
  const now = Date.now();
  const recent = (writeCalls.get(tokenId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  writeCalls.set(tokenId, recent);
  return recent.length > RATE_MAX;
}

const clampTtl = (ttlSec: number | undefined): number =>
  Math.max(MIN_TTL, Math.min(MAX_TTL, Math.round(ttlSec ?? DEFAULT_TTL)));

type ClaimRow = {
  id: string; canvasId: string; tokenId: string; scope: string;
  regionId: string | null; nodeIds: unknown; roleName: string; expiresAt: Date; createdAt: Date;
  token: { label: string; role: { name: string } };
};

const claimInclude = { token: { select: { label: true, role: { select: { name: true } } } } } as const;

const parseNodeIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const toInfo = (row: ClaimRow, regionName: string | null): NodeClaimInfo => ({
  id: row.id,
  scope: row.scope === 'region' ? 'region' : 'nodes',
  regionId: row.regionId,
  regionName,
  nodeIds: parseNodeIds(row.nodeIds),
  tokenId: row.tokenId,
  agentLabel: row.token.label,
  // roleName boşsa (bu alandan önce basılmış claim) token'ın birincil rolüne düşer.
  roleName: row.roleName || row.token.role.name,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

/** Bir düğüm bir bölge dikdörtgeninin içinde mi? (regionGuard ile aynı kural; x/y yoksa hiçbir bölgede değil.) */
const inRegion = (n: Pick<PlanNode, 'x' | 'y'>, r: RegionInfo): boolean =>
  n.x != null && n.y != null && n.x >= r.x && n.x <= r.x + r.width && n.y >= r.y && n.y <= r.y + r.height;

/** Bir claim'in kapsadığı düğüm id kümesi: region → içindeki düğümler, nodes → verilen id'ler. */
function claimNodeSet(row: ClaimRow, nodes: PlanNode[], regions: RegionInfo[]): Set<string> {
  if (row.scope === 'region') {
    const region = regions.find((r) => r.id === row.regionId);
    if (!region) return new Set();
    return new Set(nodes.filter((n) => inRegion(n, region)).map((n) => n.id));
  }
  return new Set(parseNodeIds(row.nodeIds));
}

/** Süresi geçmiş claim'leri sil (tembel süpürme — her okuma/yazmada ucuzca çağrılır). */
async function sweepExpired(prisma: PrismaClient, canvasId: string): Promise<void> {
  await prisma.nodeClaim.deleteMany({ where: { canvasId, expiresAt: { lt: new Date() } } });
}

async function liveClaims(prisma: PrismaClient, canvasId: string): Promise<ClaimRow[]> {
  return prisma.nodeClaim.findMany({
    where: { canvasId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
    include: claimInclude,
  }) as Promise<ClaimRow[]>;
}

/** Canlı claim'leri NodeClaimInfo olarak döndür (önce süresi geçmişleri süpürür). */
export async function listClaims(prisma: PrismaClient, canvasId: string): Promise<NodeClaimInfo[]> {
  await sweepExpired(prisma, canvasId);
  const [rows, regions] = await Promise.all([liveClaims(prisma, canvasId), listRegions(prisma, canvasId)]);
  const regionName = (id: string | null) => (id ? regions.find((r) => r.id === id)?.name ?? null : null);
  return rows.map((r) => toInfo(r, regionName(r.regionId)));
}

export type ClaimResult =
  | { ok: true; claim: NodeClaimInfo }
  | { ok: false; conflict: true; heldBy: string; expiresAt: string; overlap: string[] }
  | { error: string };

/**
 * Bir bölgeyi (regionId) ya da düğüm kümesini (nodeIds) TTL boyunca üstlen. Aynı alanı başka bir
 * token canlı tutuyorsa `conflict` döner (HATA değil — ajan kendi kararını verir). Kendi claim'ini
 * yenilersen expiresAt uzatılır (idempotent).
 */
export async function claimRegion(opts: {
  prisma: PrismaClient;
  serviceFor: ServiceFor;
  token: ResolvedAgentToken;
  regionId?: string;
  nodeIds?: string[];
  ttlSec?: number;
  /** Çok rollü token'da davranılan rolün adı (bkz. mcpServer resolveActingRole); tek rollüde birincil role düşer. */
  roleName?: string;
}): Promise<ClaimResult> {
  const { prisma, serviceFor, token } = opts;
  const roleName = opts.roleName ?? token.role.name;
  const canvasId = token.canvasId;
  if (rateLimited(token.id))
    return { error: `çok sık claim/release çağrısı — 60 sn'de en çok ${RATE_MAX}. Kısa bir süre bekleyip tekrar deneyin.` };

  const hasRegion = typeof opts.regionId === 'string' && opts.regionId.length > 0;
  const nodeIds = (opts.nodeIds ?? []).filter((x) => typeof x === 'string' && x.length > 0);
  if (hasRegion === (nodeIds.length > 0))
    return { error: 'ya regionId ya da nodeIds verin (ikisini birden ya da hiçbirini değil)' };
  if (nodeIds.length > 200) return { error: 'tek claim en fazla 200 düğüm kapsayabilir' };

  await sweepExpired(prisma, canvasId);
  const [state, regions] = await Promise.all([serviceFor(canvasId).getState(), listRegions(prisma, canvasId)]);
  if (hasRegion && !regions.some((r) => r.id === opts.regionId))
    return { error: 'bölge bulunamadı (list_regions ile geçerli id alın)' };

  const scope = hasRegion ? 'region' : 'nodes';
  const expiresAt = new Date(Date.now() + clampTtl(opts.ttlSec) * 1000);

  // Kendi mevcut claim'ini yenile (aynı bölge ya da aynı düğüm kümesi) → yeni kayıt yerine uzat.
  const own = (await liveClaims(prisma, canvasId)).filter((c) => c.tokenId === token.id);
  const mine = own.find((c) =>
    hasRegion
      ? c.scope === 'region' && c.regionId === opts.regionId
      : c.scope === 'nodes' && sameSet(parseNodeIds(c.nodeIds), nodeIds),
  );

  // Çakışma: BAŞKA token'ların canlı claim'leriyle düğüm kümesi kesişimi.
  const wantSet = hasRegion
    ? new Set(state.nodes.filter((n) => inRegion(n, regions.find((r) => r.id === opts.regionId)!)).map((n) => n.id))
    : new Set(nodeIds);
  for (const c of await liveClaims(prisma, canvasId)) {
    if (c.tokenId === token.id) continue;
    const other = claimNodeSet(c, state.nodes, regions);
    // Boş küme (henüz düğümü olmayan bölge) çakışma sayılmaz — aksi halde aynı boş bölgeyi kimse alamaz.
    const overlap = [...wantSet].filter((id) => other.has(id));
    const sameRegion = hasRegion && c.scope === 'region' && c.regionId === opts.regionId;
    if (overlap.length > 0 || sameRegion)
      return {
        ok: false, conflict: true,
        heldBy: `${c.token.label}/${c.token.role.name}`,
        expiresAt: c.expiresAt.toISOString(),
        overlap,
      };
  }

  const row = mine
    ? await prisma.nodeClaim.update({ where: { id: mine.id }, data: { expiresAt, roleName }, include: claimInclude })
    : await prisma.nodeClaim.create({
        data: {
          canvasId, tokenId: token.id, scope,
          regionId: hasRegion ? opts.regionId! : null,
          nodeIds: hasRegion ? undefined : nodeIds,
          roleName,
          expiresAt,
        },
        include: claimInclude,
      });
  const regionName = hasRegion ? regions.find((r) => r.id === opts.regionId)?.name ?? null : null;
  return { ok: true, claim: toInfo(row as ClaimRow, regionName) };
}

/** Kendi token'ının claim'ini bırak. Başkasınınki / bulunamayan → hata. */
export async function releaseClaim(
  prisma: PrismaClient,
  token: ResolvedAgentToken,
  claimId: string,
): Promise<{ ok: true } | { error: string }> {
  const row = await prisma.nodeClaim.findFirst({ where: { id: claimId, canvasId: token.canvasId } });
  if (!row) return { error: 'claim bulunamadı' };
  if (row.tokenId !== token.id) return { error: 'yalnızca kendi claim\'inizi bırakabilirsiniz' };
  await prisma.nodeClaim.delete({ where: { id: claimId } });
  return { ok: true };
}

/** Kanvas sahibi kaçış yolu: herhangi bir claim'i zorla düşür (takılı/yabancı claim temizliği). */
export async function forceReleaseClaim(
  prisma: PrismaClient,
  canvasId: string,
  claimId: string,
): Promise<boolean> {
  const row = await prisma.nodeClaim.findFirst({ where: { id: claimId, canvasId } });
  if (!row) return false;
  await prisma.nodeClaim.delete({ where: { id: claimId } });
  return true;
}

export interface ClaimWarning {
  claimId: string;
  heldBy: string;
  regionName: string | null;
  overlap: string[];
  expiresAt: string;
}

/**
 * submit_proposal danışması (pl1c): önerinin dokunduğu düğümler, BAŞKA bir ajanın canlı claim'iyle
 * kesişiyorsa uyarı üretir (bloklamadan — öneri yine kaydedilir). affectedNodeIds hafifçe
 * intent'lerden çıkarılır (tam expand pl3a'da paylaşılır); danışma için yeterli.
 */
export async function claimWarningsForIntents(
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  token: ResolvedAgentToken,
  intents: OpInput[],
): Promise<ClaimWarning[]> {
  const canvasId = token.canvasId;
  const affected = affectedNodeIds(intents);
  if (affected.size === 0) return [];
  const rows = (await liveClaims(prisma, canvasId)).filter((c) => c.tokenId !== token.id);
  if (rows.length === 0) return [];
  const [state, regions] = await Promise.all([serviceFor(canvasId).getState(), listRegions(prisma, canvasId)]);
  const warnings: ClaimWarning[] = [];
  for (const c of rows) {
    const overlap = [...affected].filter((id) => claimNodeSet(c, state.nodes, regions).has(id));
    if (overlap.length > 0)
      warnings.push({
        claimId: c.id,
        heldBy: `${c.token.label}/${c.token.role.name}`,
        regionName: c.scope === 'region' ? regions.find((r) => r.id === c.regionId)?.name ?? null : null,
        overlap,
        expiresAt: c.expiresAt.toISOString(),
      });
  }
  return warnings;
}

/** Intent listesinin dokunduğu düğüm id'leri (danışma için hafif çıkarım; delete cascade'i genişletmez). */
function affectedNodeIds(intents: OpInput[]): Set<string> {
  const ids = new Set<string>();
  for (const op of intents) {
    switch (op.op) {
      case 'add_node':
        if (op.id) ids.add(op.id);
        if (op.parentId) ids.add(op.parentId);
        break;
      case 'update_node':
      case 'delete_node':
      case 'move_node':
        ids.add(op.id);
        break;
      case 'add_edge':
        ids.add(op.sourceId);
        ids.add(op.targetId);
        break;
      // delete_edge yalnız kenar id'si taşır; düğüm etkilemez (danışma için atlanır).
    }
  }
  return ids;
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;
