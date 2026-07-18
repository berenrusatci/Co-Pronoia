import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { AgentRoleInfo, AgentTokenInfo } from '@treemapper/shared';

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

const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

type TokenRow = {
  id: string; label: string; roleId: string; createdAt: Date;
  lastUsedAt: Date | null; revokedAt: Date | null;
  role: { name: string; isSupervisor: boolean };
  createdBy: { username: string };
};

const tokenInclude = {
  role: { select: { name: true, isSupervisor: true } },
  createdBy: { select: { username: true } },
} as const;

const toTokenInfo = (t: TokenRow): AgentTokenInfo => ({
  id: t.id,
  label: t.label,
  roleId: t.roleId,
  roleName: t.role.name,
  isSupervisor: t.role.isSupervisor,
  createdBy: t.createdBy.username,
  createdAt: t.createdAt.toISOString(),
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  revoked: t.revokedAt !== null,
});

export async function mintAgentToken(
  prisma: PrismaClient,
  canvasId: string,
  roleId: string,
  label: string,
  createdById: string,
): Promise<{ info: AgentTokenInfo; secret: string } | { error: string }> {
  const canvas = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { type: true, groupId: true } });
  if (!canvas) return { error: 'kanvas bulunamadı' };
  if (canvas.type !== 'co-pronoia')
    return { error: 'ajan anahtarı yalnızca co-pronoia kanvasında oluşturulabilir' };
  const role = await prisma.agentRoleDef.findUnique({ where: { id: roleId } });
  if (!role || (role.groupId !== null && role.groupId !== canvas.groupId))
    return { error: 'rol bu kanvasın grubunda tanımlı değil' };
  const trimmed = label.trim().slice(0, 60);
  if (!trimmed) return { error: 'anahtar etiketi gerekli' };
  const secret = TOKEN_PREFIX + nanoid(32);
  const row = await prisma.agentToken.create({
    data: { tokenHash: hashToken(secret), canvasId, roleId, label: trimmed, createdById },
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

export type ResolvedAgentToken = NonNullable<Awaited<ReturnType<typeof resolveAgentToken>>>;

/** Bearer değerinden anahtarı çözer; iptal edilmiş/bilinmeyen → null. lastUsedAt seyrek güncellenir. */
export async function resolveAgentToken(prisma: PrismaClient, raw: string) {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const row = await prisma.agentToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: {
      role: true,
      canvas: { select: { id: true, name: true, type: true, groupId: true } },
      createdBy: { select: { id: true, username: true } },
    },
  });
  if (!row || row.revokedAt) return null;
  // Presence göstergesi için yeterli; her MCP çağrısında yazmamak adına 60 sn'de bir tazelenir.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.agentToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return row;
}
