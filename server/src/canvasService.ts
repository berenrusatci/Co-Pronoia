import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { CanvasInfo, CanvasRole, MemberInfo, RegionInfo } from '@treemapper/shared';
import type { CommitService } from './commitService.js';

export type ServiceFor = (canvasId: string) => CommitService;

export async function listCanvases(prisma: PrismaClient, userId: string): Promise<CanvasInfo[]> {
  const rows = await prisma.canvas.findMany({
    where: {
      OR: [
        { members: { some: { userId } } },
        { groupId: { not: null }, group: { members: { some: { userId, status: 'approved' } } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { username: true } },
      group: { select: { id: true, name: true } },
      _count: { select: { members: true } },
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (rows.length === 0) return [];
  // Grup üzerinden gelen kanvaslar için rol bazlı erişimi topluca çöz (admin → edit;
  // atanmış rol → açık CanvasRoleAccess > rolün varsayılanı; rolsüz üye → edit).
  const groupIds = [...new Set(rows.filter((r) => !r.members[0] && r.group).map((r) => r.group!.id))];
  const memberships = groupIds.length
    ? await prisma.groupMember.findMany({
        where: { userId, groupId: { in: groupIds }, status: 'approved' },
        include: { roleDef: true },
      })
    : [];
  const membershipOf = new Map(memberships.map((m) => [m.groupId, m]));
  const roleIds = memberships.map((m) => m.roleDef?.id).filter((id): id is string => !!id);
  const accessRows = roleIds.length
    ? await prisma.canvasRoleAccess.findMany({
        where: { roleId: { in: roleIds }, canvasId: { in: rows.map((r) => r.id) } },
      })
    : [];
  const explicitAccess = new Map(accessRows.map((a) => [`${a.canvasId}:${a.roleId}`, a.access]));

  const groupAccess = (canvasId: string, groupId: string): 'edit' | 'view' | null => {
    const gm = membershipOf.get(groupId);
    if (!gm) return null;
    if (gm.role === 'admin' || !gm.roleDef) return 'edit';
    const access = explicitAccess.get(`${canvasId}:${gm.roleDef.id}`) ?? gm.roleDef.defaultCanvasAccess;
    return access === 'edit' ? 'edit' : access === 'view' ? 'view' : null;
  };

  const visible = rows.filter((r) => r.members[0] || (r.group && groupAccess(r.id, r.group.id) !== null));
  if (visible.length === 0) return [];
  const heads = await prisma.commit.groupBy({
    by: ['canvasId'],
    where: { canvasId: { in: visible.map((r) => r.id) }, branchId: null },
    _max: { seq: true },
  });
  const headOf = new Map(heads.map((h) => [h.canvasId, h._max.seq ?? 0]));
  return visible.map((r) => ({
    id: r.id,
    name: r.name,
    owner: r.owner.username,
    role: (r.members[0]?.role ??
      (groupAccess(r.id, r.group!.id) === 'view' ? 'viewer' : 'editor')) as CanvasInfo['role'],
    memberCount: r._count.members,
    headSeq: headOf.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
    groupId: r.group?.id ?? null,
    groupName: r.group?.name ?? null,
  }));
}

export async function getCanvasInfo(prisma: PrismaClient, canvasId: string, userId: string): Promise<CanvasInfo | null> {
  const list = await listCanvases(prisma, userId);
  return list.find((c) => c.id === canvasId) ?? null;
}

/** Creates the canvas with its owner membership and (by default) a seed root-node commit. */
export async function createCanvas(
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  name: string,
  ownerId: string,
  opts: { seedRoot?: boolean; groupId?: string } = {},
): Promise<CanvasInfo> {
  const canvas = await prisma.canvas.create({
    data: { name, ownerId, groupId: opts.groupId, members: { create: { userId: ownerId, role: 'owner' } } },
  });
  if (opts.seedRoot !== false) {
    await serviceFor(canvas.id).commit(
      [{ op: 'add_node', title: name, description: 'Kök düğüm — planınızı buradan dallandırın.', nodeType: 'milestone', x: 0, y: 0 }],
      { message: 'İlk kurulum: kök düğüm', authorId: ownerId },
    );
  }
  return (await getCanvasInfo(prisma, canvas.id, ownerId))!;
}

export async function isMember(prisma: PrismaClient, canvasId: string, userId: string): Promise<boolean> {
  return (await memberRole(prisma, canvasId, userId)) !== null;
}

export async function memberRole(prisma: PrismaClient, canvasId: string, userId: string): Promise<CanvasRole | null> {
  const row = await prisma.canvasMember.findUnique({
    where: { canvasId_userId: { canvasId, userId } },
  });
  if (row) return row.role as CanvasRole;
  // Doğrudan üyelik yok — onaylı grup üyeliği üzerinden erişim: admin her zaman editör,
  // diğerleri atanmış rollerinin kanvas erişimine göre (açık kayıt > rolün varsayılanı).
  const canvas = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { groupId: true } });
  if (!canvas?.groupId) return null;
  const gm = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: canvas.groupId, userId } },
    include: { roleDef: true },
  });
  if (gm?.status !== 'approved') return null;
  if (gm.role === 'admin') return 'editor';
  if (!gm.roleDef) return 'editor'; // rol atanmamış üye: eski davranış korunur
  const explicit = await prisma.canvasRoleAccess.findUnique({
    where: { canvasId_roleId: { canvasId, roleId: gm.roleDef.id } },
  });
  const access = explicit?.access ?? gm.roleDef.defaultCanvasAccess;
  if (access === 'edit') return 'editor';
  if (access === 'view') return 'viewer';
  return null; // 'none' → kanvas bu kullanıcıya hiç görünmez
}

// ---------- Members & roles (owner-managed) ----------

export async function listMembers(prisma: PrismaClient, canvasId: string): Promise<MemberInfo[]> {
  const rows = await prisma.canvasMember.findMany({
    where: { canvasId },
    orderBy: { joinedAt: 'asc' },
    include: { user: { select: { username: true } } },
  });
  return rows.map((m) => ({
    userId: m.userId,
    username: m.user.username,
    role: m.role as CanvasRole,
    joinedAt: m.joinedAt.toISOString(),
  }));
}

/** Owner assigns editor/viewer to other members; the owner role itself never changes hands here. */
export async function setMemberRole(
  prisma: PrismaClient,
  canvasId: string,
  targetUserId: string,
  role: 'editor' | 'viewer',
): Promise<MemberInfo[] | { error: string }> {
  const target = await prisma.canvasMember.findUnique({ where: { canvasId_userId: { canvasId, userId: targetUserId } } });
  if (!target) return { error: 'üye bulunamadı' };
  if (target.role === 'owner') return { error: 'kanvas sahibinin rolü değiştirilemez' };
  await prisma.canvasMember.update({
    where: { canvasId_userId: { canvasId, userId: targetUserId } },
    data: { role },
  });
  return listMembers(prisma, canvasId);
}

export async function removeMember(
  prisma: PrismaClient,
  canvasId: string,
  targetUserId: string,
): Promise<MemberInfo[] | { error: string }> {
  const target = await prisma.canvasMember.findUnique({ where: { canvasId_userId: { canvasId, userId: targetUserId } } });
  if (!target) return { error: 'üye bulunamadı' };
  if (target.role === 'owner') return { error: 'kanvas sahibi çıkarılamaz' };
  await prisma.$transaction([
    prisma.canvasMember.delete({ where: { canvasId_userId: { canvasId, userId: targetUserId } } }),
    prisma.regionMember.deleteMany({ where: { userId: targetUserId, region: { canvasId } } }),
  ]);
  return listMembers(prisma, canvasId);
}

/** Owner-only. Removes the canvas and everything scoped to it. */
export async function deleteCanvas(prisma: PrismaClient, canvasId: string): Promise<void> {
  await prisma.$transaction([
    prisma.commit.deleteMany({ where: { canvasId } }),
    prisma.branch.deleteMany({ where: { canvasId } }),
    prisma.edge.deleteMany({ where: { canvasId } }),
    prisma.node.deleteMany({ where: { canvasId } }),
    prisma.regionMember.deleteMany({ where: { region: { canvasId } } }),
    prisma.region.deleteMany({ where: { canvasId } }),
    prisma.invite.deleteMany({ where: { canvasId } }),
    prisma.canvasMember.deleteMany({ where: { canvasId } }),
    prisma.canvas.delete({ where: { id: canvasId } }),
  ]);
}

// ---------- Regions ----------

const regionInclude = {
  members: { include: { user: { select: { username: true } } } },
  roleAccess: {
    include: {
      role: {
        include: {
          members: { where: { status: 'approved' }, include: { user: { select: { username: true } } } },
        },
      },
    },
  },
} as const;

type RegionRow = {
  id: string; name: string; x: number; y: number; width: number; height: number; color: string;
  description: string; aiAllowed: boolean;
  members: { userId: string; user: { username: string } }[];
  roleAccess: {
    roleId: string;
    role: { members: { userId: string; user: { username: string } }[] };
  }[];
};

/** memberIds = doğrudan üyeler ∪ erişimli rollerin onaylı üyeleri — regionGuard tek listeyi okur. */
const toRegionInfo = (r: RegionRow): RegionInfo => {
  const byId = new Map<string, string>();
  for (const m of r.members) byId.set(m.userId, m.user.username);
  for (const ra of r.roleAccess) for (const m of ra.role.members) byId.set(m.userId, m.user.username);
  return {
    id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height, color: r.color,
    description: r.description, aiAllowed: r.aiAllowed,
    memberIds: [...byId.keys()],
    memberNames: [...byId.values()],
    directMemberIds: r.members.map((m) => m.userId),
    roleIds: r.roleAccess.map((ra) => ra.roleId),
  };
};

export async function listRegions(prisma: PrismaClient, canvasId: string): Promise<RegionInfo[]> {
  const rows = await prisma.region.findMany({
    where: { canvasId },
    orderBy: { createdAt: 'asc' },
    include: regionInclude,
  });
  return rows.map(toRegionInfo);
}

export async function createRegion(
  prisma: PrismaClient,
  canvasId: string,
  data: { name: string; x: number; y: number; width: number; height: number; color?: string; description?: string; aiAllowed?: boolean },
): Promise<RegionInfo> {
  const row = await prisma.region.create({
    data: { canvasId, ...data },
    include: regionInclude,
  });
  return toRegionInfo(row);
}

export async function updateRegion(
  prisma: PrismaClient,
  canvasId: string,
  regionId: string,
  data: Partial<{ name: string; x: number; y: number; width: number; height: number; color: string; description: string; aiAllowed: boolean }>,
): Promise<RegionInfo | null> {
  const existing = await prisma.region.findFirst({ where: { id: regionId, canvasId } });
  if (!existing) return null;
  const row = await prisma.region.update({ where: { id: regionId }, data, include: regionInclude });
  return toRegionInfo(row);
}

export async function deleteRegion(prisma: PrismaClient, canvasId: string, regionId: string): Promise<boolean> {
  const existing = await prisma.region.findFirst({ where: { id: regionId, canvasId } });
  if (!existing) return false;
  await prisma.region.delete({ where: { id: regionId } });
  return true;
}

/** Replaces a region's member list (only canvas members are accepted) and, if given, its role-access list. */
export async function setRegionMembers(
  prisma: PrismaClient,
  canvasId: string,
  regionId: string,
  userIds: string[],
  roleIds?: string[],
): Promise<RegionInfo | null> {
  const existing = await prisma.region.findFirst({ where: { id: regionId, canvasId } });
  if (!existing) return null;
  const canvasMembers = await prisma.canvasMember.findMany({ where: { canvasId, userId: { in: userIds } } });
  const validUsers = canvasMembers.map((m) => m.userId);
  // Kanvas grup üyeliğiyle (CanvasMember kaydı olmadan) erişilen kullanıcılar da atanabilmeli.
  const canvas = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { groupId: true } });
  if (canvas?.groupId) {
    const groupUsers = await prisma.groupMember.findMany({
      where: { groupId: canvas.groupId, status: 'approved', userId: { in: userIds } },
      select: { userId: true },
    });
    for (const g of groupUsers) if (!validUsers.includes(g.userId)) validUsers.push(g.userId);
  }
  const tx: ReturnType<typeof prisma.regionMember.deleteMany | typeof prisma.regionMember.createMany>[] = [
    prisma.regionMember.deleteMany({ where: { regionId } }),
    ...(validUsers.length > 0
      ? [prisma.regionMember.createMany({ data: validUsers.map((userId) => ({ regionId, userId })) })]
      : []),
  ];
  if (roleIds !== undefined) {
    const validRoles = canvas?.groupId
      ? (await prisma.groupRoleDef.findMany({
          where: { groupId: canvas.groupId, id: { in: roleIds } },
          select: { id: true },
        })).map((r) => r.id)
      : [];
    tx.push(prisma.regionRoleAccess.deleteMany({ where: { regionId } }));
    if (validRoles.length > 0)
      tx.push(prisma.regionRoleAccess.createMany({ data: validRoles.map((roleId) => ({ regionId, roleId })) }));
  }
  await prisma.$transaction(tx);
  const row = await prisma.region.findUnique({ where: { id: regionId }, include: regionInclude });
  return row ? toRegionInfo(row) : null;
}

/** Rolün bir grup kanvasına erişimini ayarla ('none'|'view'|'edit'; null → açık kaydı sil, rol varsayılanına dön). */
export async function setCanvasRoleAccess(
  prisma: PrismaClient,
  canvasId: string,
  roleId: string,
  access: 'none' | 'view' | 'edit' | null,
): Promise<{ error: string } | null> {
  const canvas = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { groupId: true } });
  if (!canvas?.groupId) return { error: 'bu kanvas bir gruba bağlı değil' };
  const role = await prisma.groupRoleDef.findFirst({ where: { id: roleId, groupId: canvas.groupId } });
  if (!role) return { error: 'rol bulunamadı' };
  if (access === null) {
    await prisma.canvasRoleAccess.deleteMany({ where: { canvasId, roleId } });
  } else {
    await prisma.canvasRoleAccess.upsert({
      where: { canvasId_roleId: { canvasId, roleId } },
      create: { canvasId, roleId, access },
      update: { access },
    });
  }
  return null;
}

export async function createInvite(prisma: PrismaClient, canvasId: string, userId: string): Promise<string> {
  const token = nanoid(24);
  await prisma.invite.create({ data: { token, canvasId, createdBy: userId } });
  return token;
}

export async function inviteInfo(prisma: PrismaClient, token: string) {
  return prisma.invite.findUnique({
    where: { token },
    include: { canvas: { select: { id: true, name: true } }, creator: { select: { username: true } } },
  });
}

/** Membership via invite link is the only way into someone else's canvas. Idempotent. */
export async function acceptInvite(prisma: PrismaClient, token: string, userId: string): Promise<CanvasInfo | null> {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) return null;
  await prisma.canvasMember.upsert({
    where: { canvasId_userId: { canvasId: invite.canvasId, userId } },
    create: { canvasId: invite.canvasId, userId },
    update: {},
  });
  return getCanvasInfo(prisma, invite.canvasId, userId);
}
