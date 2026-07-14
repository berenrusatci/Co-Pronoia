import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { GroupInfo, GroupMemberInfo, GroupRole, GroupMemberStatus } from '@treemapper/shared';

export async function listGroups(prisma: PrismaClient, userId: string): Promise<GroupInfo[]> {
  const rows = await prisma.groupMember.findMany({
    where: { userId, status: 'approved' },
    include: {
      group: {
        include: {
          _count: { select: { canvases: true, members: { where: { status: 'approved' } } } },
        },
      },
    },
    orderBy: { requestedAt: 'asc' },
  });
  const pendingCounts = new Map<string, number>();
  const adminGroupIds = rows.filter((r) => r.role === 'admin').map((r) => r.groupId);
  if (adminGroupIds.length > 0) {
    const pending = await prisma.groupMember.groupBy({
      by: ['groupId'],
      where: { groupId: { in: adminGroupIds }, status: 'pending' },
      _count: { _all: true },
    });
    for (const p of pending) pendingCounts.set(p.groupId, p._count._all);
  }
  return rows.map((r) => ({
    id: r.group.id,
    name: r.group.name,
    myRole: r.role as GroupRole,
    myStatus: r.status as GroupMemberStatus,
    memberCount: r.group._count.members,
    pendingCount: r.role === 'admin' ? pendingCounts.get(r.groupId) ?? 0 : 0,
    canvasCount: r.group._count.canvases,
    createdAt: r.group.createdAt.toISOString(),
  }));
}

export async function createGroup(prisma: PrismaClient, name: string, userId: string): Promise<GroupInfo> {
  const group = await prisma.group.create({
    data: { name, members: { create: { userId, role: 'admin', status: 'approved' } } },
  });
  return {
    id: group.id,
    name: group.name,
    myRole: 'admin',
    myStatus: 'approved',
    memberCount: 1,
    pendingCount: 0,
    canvasCount: 0,
    createdAt: group.createdAt.toISOString(),
  };
}

export async function groupRole(
  prisma: PrismaClient,
  groupId: string,
  userId: string,
): Promise<{ role: GroupRole; status: GroupMemberStatus } | null> {
  const row = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (!row) return null;
  return { role: row.role as GroupRole, status: row.status as GroupMemberStatus };
}

export async function listGroupMembers(prisma: PrismaClient, groupId: string): Promise<GroupMemberInfo[]> {
  const rows = await prisma.groupMember.findMany({
    where: { groupId },
    orderBy: { requestedAt: 'asc' },
    include: { user: { select: { username: true } } },
  });
  return rows.map((m) => ({
    userId: m.userId,
    username: m.user.username,
    role: m.role as GroupRole,
    status: m.status as GroupMemberStatus,
    jobTitle: m.jobTitle,
    requestedAt: m.requestedAt.toISOString(),
  }));
}

async function approvedAdminCount(prisma: PrismaClient, groupId: string): Promise<number> {
  return prisma.groupMember.count({ where: { groupId, role: 'admin', status: 'approved' } });
}

export async function approveMember(
  prisma: PrismaClient,
  groupId: string,
  targetUserId: string,
): Promise<GroupMemberInfo[] | { error: string }> {
  const target = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetUserId } } });
  if (!target) return { error: 'üye bulunamadı' };
  await prisma.groupMember.update({
    where: { groupId_userId: { groupId, userId: targetUserId } },
    data: { status: 'approved' },
  });
  return listGroupMembers(prisma, groupId);
}

export async function setGroupMemberRole(
  prisma: PrismaClient,
  groupId: string,
  targetUserId: string,
  role: GroupRole,
): Promise<GroupMemberInfo[] | { error: string }> {
  const target = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetUserId } } });
  if (!target) return { error: 'üye bulunamadı' };
  if (target.role === 'admin' && role === 'member' && (await approvedAdminCount(prisma, groupId)) <= 1)
    return { error: 'son yöneticinin rolü değiştirilemez' };
  await prisma.groupMember.update({ where: { groupId_userId: { groupId, userId: targetUserId } }, data: { role } });
  return listGroupMembers(prisma, groupId);
}

export async function removeGroupMember(
  prisma: PrismaClient,
  groupId: string,
  targetUserId: string,
): Promise<GroupMemberInfo[] | { error: string }> {
  const target = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetUserId } } });
  if (!target) return { error: 'üye bulunamadı' };
  if (target.role === 'admin' && target.status === 'approved' && (await approvedAdminCount(prisma, groupId)) <= 1)
    return { error: 'son yönetici çıkarılamaz' };
  await prisma.groupMember.delete({ where: { groupId_userId: { groupId, userId: targetUserId } } });
  return listGroupMembers(prisma, groupId);
}

export async function createGroupInvite(prisma: PrismaClient, groupId: string, userId: string): Promise<string> {
  const token = nanoid(24);
  await prisma.groupInvite.create({ data: { token, groupId, createdBy: userId } });
  return token;
}

export async function groupInviteInfo(prisma: PrismaClient, token: string) {
  return prisma.groupInvite.findUnique({
    where: { token },
    include: { group: { select: { id: true, name: true } }, creator: { select: { username: true } } },
  });
}

/** Idempotent: an existing membership (pending or approved) keeps its status/role as-is. */
export async function acceptGroupInvite(
  prisma: PrismaClient,
  token: string,
  userId: string,
  jobTitle: string,
): Promise<GroupInfo | null> {
  const invite = await prisma.groupInvite.findUnique({ where: { token } });
  if (!invite) return null;
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: invite.groupId, userId } },
    create: { groupId: invite.groupId, userId, jobTitle: jobTitle || null },
    update: {},
  });
  const row = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: invite.groupId, userId } },
    include: { group: { include: { _count: { select: { canvases: true, members: { where: { status: 'approved' } } } } } } },
  });
  if (!row) return null;
  return {
    id: row.group.id,
    name: row.group.name,
    myRole: row.role as GroupRole,
    myStatus: row.status as GroupMemberStatus,
    memberCount: row.group._count.members,
    pendingCount: 0,
    canvasCount: row.group._count.canvases,
    createdAt: row.group.createdAt.toISOString(),
  };
}
