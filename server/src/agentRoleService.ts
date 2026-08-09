import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { AgentRoleInfo, AgentTokenInfo } from '@co-pronoia/shared';

// ---------- Ajan rol tanımları (groupId null → site şablonu, dolu → gruba özel) ----------

export interface AgentRoleInput {
  name: string;
  persona?: string;
  isSupervisor?: boolean;
}

type RoleRow = {
  id: string; groupId: string | null; name: string; persona: string;
  isSupervisor: boolean; createdAt: Date;
};

const toRoleInfo = (r: RoleRow): AgentRoleInfo => ({
  id: r.id,
  name: r.name,
  persona: r.persona,
  isSupervisor: r.isSupervisor,
  scope: r.groupId === null ? 'site' : 'group',
  createdAt: r.createdAt.toISOString(),
});

export async function listAgentRoles(prisma: PrismaClient, groupId: string | null): Promise<AgentRoleInfo[]> {
  const rows = await prisma.agentRoleDef.findMany({ where: { groupId }, orderBy: { createdAt: 'asc' } });
  return rows.map(toRoleInfo);
}

export async function createAgentRole(
  prisma: PrismaClient,
  groupId: string | null,
  input: AgentRoleInput,
): Promise<AgentRoleInfo | { error: string }> {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { error: 'rol adı gerekli' };
  const row = await prisma.agentRoleDef.create({
    data: {
      groupId,
      name,
      persona: (input.persona ?? '').slice(0, 4000),
      isSupervisor: input.isSupervisor ?? false,
    },
  });
  return toRoleInfo(row);
}

export async function updateAgentRole(
  prisma: PrismaClient,
  groupId: string | null,
  roleId: string,
  input: Partial<AgentRoleInput>,
): Promise<AgentRoleInfo | { error: string }> {
  // Kapsam denetimi: site rotaları null ile çağırır ve yalnızca site şablonlarını,
  // grup rotaları kendi groupId'siyle yalnızca o grubun rollerini görebilir.
  const existing = await prisma.agentRoleDef.findFirst({ where: { id: roleId, groupId } });
  if (!existing) return { error: 'rol bulunamadı' };
  const row = await prisma.agentRoleDef.update({
    where: { id: roleId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 60) || existing.name } : {}),
      ...(input.persona !== undefined ? { persona: input.persona.slice(0, 4000) } : {}),
      ...(input.isSupervisor !== undefined ? { isSupervisor: input.isSupervisor } : {}),
    },
  });
  return toRoleInfo(row);
}

export async function deleteAgentRole(
  prisma: PrismaClient,
  groupId: string | null,
  roleId: string,
): Promise<boolean> {
  const existing = await prisma.agentRoleDef.findFirst({ where: { id: roleId, groupId } });
  if (!existing) return false;
  await prisma.agentRoleDef.delete({ where: { id: roleId } }); // bu rolle basılmış anahtarlar Cascade ile silinir
  return true;
}

/** Bir kanvasta anahtar basarken seçilebilir roller: site şablonları ∪ kanvasın grubunun rolleri. */
export async function availableAgentRoles(
  prisma: PrismaClient,
  canvasGroupId: string | null,
): Promise<AgentRoleInfo[]> {
  const rows = await prisma.agentRoleDef.findMany({
    where: canvasGroupId === null ? { groupId: null } : { OR: [{ groupId: null }, { groupId: canvasGroupId }] },
    orderBy: [{ groupId: 'asc' }, { createdAt: 'asc' }],
  });
  // Site şablonları önce gelsin (null sıralaması sürücüye göre değişebilir).
  return [...rows.filter((r) => r.groupId === null), ...rows.filter((r) => r.groupId !== null)].map(toRoleInfo);
}

// ---------- Ajan erişim anahtarları (kanvas + rol; ham değer bir kez döner) ----------

const TOKEN_PREFIX = 'tma_';
const MAX_ROLES_PER_TOKEN = 10;

const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

type TokenRow = {
  id: string; label: string; roleId: string; createdAt: Date;
  lastUsedAt: Date | null; revokedAt: Date | null;
  role: { name: string; isSupervisor: boolean };
  roles: { role: { id: string; name: string; isSupervisor: boolean } }[];
  createdBy: { username: string };
};

const tokenInclude = {
  role: { select: { name: true, isSupervisor: true } },
  roles: { select: { role: { select: { id: true, name: true, isSupervisor: true } } } },
  createdBy: { select: { username: true } },
} as const;

/** `AgentTokenRole` join satırlarından bir token'ın tam rol kümesi. Boşsa (eski, tek-rollü
 * token) birincil `role` alanına düşer — böylece bu özellikten önce basılmış anahtarlar da çalışır. */
function rolesOf(t: TokenRow): { id: string; name: string; isSupervisor: boolean }[] {
  if (t.roles.length > 0) return t.roles.map((r) => r.role);
  return [{ id: t.roleId, name: t.role.name, isSupervisor: t.role.isSupervisor }];
}

const toTokenInfo = (t: TokenRow): AgentTokenInfo => {
  const roles = rolesOf(t);
  return {
    id: t.id,
    label: t.label,
    roleId: t.roleId,
    roleName: t.role.name,
    isSupervisor: roles.some((r) => r.isSupervisor),
    roles,
    createdBy: t.createdBy.username,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revoked: t.revokedAt !== null,
  };
};

/** Verilen rol id kümesini bu kanvasın grubunda geçerli olup olmadığına göre doğrular. */
async function validateRoleIds(
  prisma: PrismaClient,
  roleIds: string[],
  canvasGroupId: string | null,
): Promise<{ ids: string[] } | { error: string }> {
  const ids = [...new Set(roleIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return { error: 'en az bir rol seçilmeli' };
  if (ids.length > MAX_ROLES_PER_TOKEN) return { error: `bir anahtar en fazla ${MAX_ROLES_PER_TOKEN} role bağlanabilir` };
  const rows = await prisma.agentRoleDef.findMany({ where: { id: { in: ids } } });
  if (rows.length !== ids.length) return { error: 'rol bu kanvasın grubunda tanımlı değil' };
  for (const r of rows) {
    if (r.groupId !== null && r.groupId !== canvasGroupId) return { error: 'rol bu kanvasın grubunda tanımlı değil' };
  }
  return { ids };
}

export async function mintAgentToken(
  prisma: PrismaClient,
  canvasId: string,
  roleIds: string[],
  label: string,
  createdById: string,
): Promise<{ info: AgentTokenInfo; secret: string } | { error: string }> {
  const canvas = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { type: true, groupId: true } });
  if (!canvas) return { error: 'kanvas bulunamadı' };
  if (canvas.type !== 'co-pronoia')
    return { error: 'ajan anahtarı yalnızca co-pronoia kanvasında oluşturulabilir' };
  const validated = await validateRoleIds(prisma, roleIds, canvas.groupId);
  if ('error' in validated) return validated;
  const trimmed = label.trim().slice(0, 60);
  if (!trimmed) return { error: 'anahtar etiketi gerekli' };
  const secret = TOKEN_PREFIX + nanoid(32);
  const [primaryRoleId, ...rest] = validated.ids;
  const row = await prisma.agentToken.create({
    data: {
      tokenHash: hashToken(secret), canvasId, roleId: primaryRoleId, label: trimmed, createdById,
      roles: { create: [primaryRoleId, ...rest].map((roleId) => ({ roleId })) },
    },
    include: tokenInclude,
  });
  return { info: toTokenInfo(row), secret };
}

export async function listAgentTokens(prisma: PrismaClient, canvasId: string): Promise<AgentTokenInfo[]> {
  const rows = await prisma.agentToken.findMany({
    where: { canvasId },
    orderBy: { createdAt: 'asc' },
    include: tokenInclude,
  });
  return rows.map(toTokenInfo);
}

/** İptal: satır silinmez (öneri geçmişinin sahibi okunur kalsın), revokedAt işaretlenir. */
export async function revokeAgentToken(
  prisma: PrismaClient,
  canvasId: string,
  tokenId: string,
): Promise<boolean> {
  const existing = await prisma.agentToken.findFirst({ where: { id: tokenId, canvasId } });
  if (!existing) return false;
  await prisma.agentToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  return true;
}

/**
 * Anahtarı yenile (rotate): aynı satırın `tokenHash`'ini yeni bir sırla değiştirir — `label`,
 * roller (`roles`/`roleId`), `createdBy`, ve bağlı `proposals`/`claims` AYNI KALIR (provenance
 * korunur). Eski anahtar bu satırın hash'i değiştiği anda geçersizleşir. `lastUsedAt` sıfırlanır.
 * İptal edilmiş bir token yenilenemez (revoke kalıcı bir karardır).
 */
export async function rotateAgentToken(
  prisma: PrismaClient,
  canvasId: string,
  tokenId: string,
): Promise<{ info: AgentTokenInfo; secret: string } | { error: string }> {
  const existing = await prisma.agentToken.findFirst({ where: { id: tokenId, canvasId } });
  if (!existing) return { error: 'anahtar bulunamadı' };
  if (existing.revokedAt) return { error: 'iptal edilmiş anahtar yenilenemez — yeni bir anahtar basın' };
  const secret = TOKEN_PREFIX + nanoid(32);
  const row = await prisma.agentToken.update({
    where: { id: tokenId },
    data: { tokenHash: hashToken(secret), lastUsedAt: null },
    include: tokenInclude,
  });
  return { info: toTokenInfo(row), secret };
}

export type ResolvedAgentToken = NonNullable<Awaited<ReturnType<typeof resolveAgentToken>>>;

/** Bearer değerinden anahtarı çözer; iptal edilmiş/bilinmeyen → null. lastUsedAt seyrek güncellenir. */
export async function resolveAgentToken(prisma: PrismaClient, raw: string) {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const row = await prisma.agentToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: {
      role: true,
      roles: { include: { role: true } },
      canvas: { select: { id: true, name: true, type: true, groupId: true } },
      createdBy: { select: { id: true, username: true } },
    },
  });
  if (!row || row.revokedAt) return null;
  // Presence göstergesi için yeterli; her MCP çağrısında yazmamak adına 60 sn'de bir tazelenir.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.agentToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  // Tam rol kümesi: join tablosu boşsa (bu özellikten önce basılmış token) birincil role düşer.
  const roles = row.roles.length > 0 ? row.roles.map((r) => r.role) : [row.role];
  return { ...row, roles };
}
