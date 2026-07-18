import type { PrismaClient } from '@prisma/client';
import type { AdminCanvasInfo, AdminGroupInfo, AdminStats, AdminUserInfo } from '@treemapper/shared';
import { hashPassword } from './auth.js';
import { deleteCanvas } from './canvasService.js';

/** Site yönetim paneli sorguları. Tüm çağıranlar /api/admin guard'ından geçmiş bir yöneticidir. */

export async function getStats(prisma: PrismaClient): Promise<AdminStats> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);
  const [userCount, canvasCount, groupCount, commitCount, activeSessionCount, newUsers7d] =
    await prisma.$transaction([
      prisma.user.count(),
      prisma.canvas.count(),
      prisma.group.count(),
      prisma.commit.count(),
      prisma.session.count({ where: { expiresAt: { gt: now } } }),
      prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ]);
  return { userCount, canvasCount, groupCount, commitCount, activeSessionCount, newUsers7d };
}

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export async function listAllUsers(prisma: PrismaClient, q?: string): Promise<AdminUserInfo[]> {
  const query = q?.trim();
  const rows = await prisma.user.findMany({
    where: query
      ? { OR: [{ username: contains(query) }, { email: contains(query) }, { displayName: contains(query) }] }
      : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { ownedCanvases: true, memberships: true, groupMemberships: true, sessions: true } },
    },
  });
  if (rows.length === 0) return [];
  const lastCommits = await prisma.commit.groupBy({
    by: ['authorId'],
    where: { authorId: { in: rows.map((r) => r.id) } },
    _max: { createdAt: true },
  });
  const lastCommitOf = new Map(lastCommits.map((c) => [c.authorId, c._max.createdAt]));
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    email: r.email,
    displayName: r.displayName,
    isAdmin: r.isAdmin,
    hasPassword: !!r.passwordHash,
    hasGoogle: !!r.googleId,
    createdAt: r.createdAt.toISOString(),
    ownedCanvasCount: r._count.ownedCanvases,
    membershipCount: r._count.memberships,
    groupCount: r._count.groupMemberships,
    sessionCount: r._count.sessions,
    lastCommitAt: lastCommitOf.get(r.id)?.toISOString() ?? null,
  }));
}

export async function setUserAdmin(
  prisma: PrismaClient,
  actorId: string,
  targetUserId: string,
  isAdmin: boolean,
): Promise<{ error: string } | null> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { error: 'kullanıcı bulunamadı' };
  // Yönetici hesapları dokunulmazdır: yetki panelden geri alınamaz (kendi kendine dahil).
  // Tek çıkış kapısı doğrudan veritabanı / ADMIN_* bootstrap ortam değişkenleridir.
  if (!isAdmin && target.isAdmin) {
    if (targetUserId === actorId) return { error: 'kendi yönetici yetkinizi kaldıramazsınız' };
    return { error: 'yönetici hesabının yetkisi kaldırılamaz' };
  }
  await prisma.user.update({ where: { id: targetUserId }, data: { isAdmin } });
  return null;
}

/** Yeni şifreyi atar ve hedefin TÜM oturumlarını kapatır (çağıran hedefin kendisi değildir).
 * Google-only hesaplara da şifreyle giriş imkânı ekler. Yönetici hesaplarına dokunamaz:
 * bir yönetici şifresini yalnızca kendisi değiştirir (POST /api/auth/password). */
export async function adminSetPassword(
  prisma: PrismaClient,
  targetUserId: string,
  password: string,
): Promise<{ error: string } | null> {
  if (password.length < 4) return { error: 'şifre en az 4 karakter olmalı' };
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { error: 'kullanıcı bulunamadı' };
  if (target.isAdmin) return { error: 'yönetici hesabının şifresi panelden değiştirilemez' };
  await prisma.user.update({ where: { id: targetUserId }, data: { passwordHash: await hashPassword(password) } });
  await prisma.session.deleteMany({ where: { userId: targetUserId } });
  return null;
}

export async function revokeUserSessions(prisma: PrismaClient, targetUserId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId: targetUserId } });
  return count;
}

export type DeleteUserResult = { deletedCanvasIds: string[]; memberCanvasIds: string[] } | { error: string };

/**
 * Kullanıcıyı kalıcı siler. Kaskad kuralları:
 * - Sahibi olduğu kanvaslar tüm içerikleriyle silinir (deleteCanvas).
 * - Ana hattaki commit'leri kalır, authorId null olur ("sistem" görünür).
 * - Açtığı branch'ler ve o branch'lerin commit'leri silinir — branch commit'leri hiçbir zaman
 *   ana hat durumunun parçası değildir (merge, ops'ları yeni bir ana hat commit'i olarak yeniden uygular).
 * - Davet linkleri (kanvas + grup) silinir; kalan ilişkiler şema kaskadıyla düşer.
 */
export async function deleteUser(
  prisma: PrismaClient,
  actorId: string,
  targetUserId: string,
): Promise<DeleteUserResult> {
  if (targetUserId === actorId) return { error: 'kendi hesabınızı silemezsiniz' };
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { error: 'kullanıcı bulunamadı' };
  // Silme, yetki korumasının arka kapısı olurdu (sil + yeniden aç): yönetici hesabı silinemez.
  if (target.isAdmin) return { error: 'yönetici hesabı silinemez' };

  // Başka üyesi olan bir grubun tek yöneticisiyse silme: grup yönetimsiz kalır.
  const adminMemberships = await prisma.groupMember.findMany({
    where: { userId: targetUserId, role: 'admin', status: 'approved' },
    include: { group: { include: { _count: { select: { members: true } } } } },
  });
  const blockingGroups: string[] = [];
  for (const gm of adminMemberships) {
    if (gm.group._count.members <= 1) continue; // tek üyeli grup boş kalır, Gruplar sekmesinden silinebilir
    const otherAdmins = await prisma.groupMember.count({
      where: { groupId: gm.groupId, role: 'admin', status: 'approved', userId: { not: targetUserId } },
    });
    if (otherAdmins === 0) blockingGroups.push(gm.group.name);
  }
  if (blockingGroups.length > 0)
    return {
      error: `kullanıcı şu grupların tek yöneticisi: ${blockingGroups.join(', ')} — önce yöneticiliği devredin veya grubu silin`,
    };

  const ownedCanvases = await prisma.canvas.findMany({ where: { ownerId: targetUserId }, select: { id: true } });
  const memberCanvases = await prisma.canvasMember.findMany({
    where: { userId: targetUserId, canvasId: { notIn: ownedCanvases.map((c) => c.id) } },
    select: { canvasId: true },
  });
  // deleteCanvas kendi $transaction'ını kurar; kanvas başına sıralı silme mevcut granülariteyle aynı.
  for (const c of ownedCanvases) await deleteCanvas(prisma, c.id);

  await prisma.$transaction([
    prisma.commit.deleteMany({ where: { branch: { createdBy: targetUserId } } }),
    prisma.branch.deleteMany({ where: { createdBy: targetUserId } }),
    prisma.commit.updateMany({ where: { authorId: targetUserId }, data: { authorId: null } }),
    prisma.invite.deleteMany({ where: { createdBy: targetUserId } }),
    prisma.groupInvite.deleteMany({ where: { createdBy: targetUserId } }),
    ...(target.email ? [prisma.emailVerification.deleteMany({ where: { email: target.email } })] : []),
    prisma.user.delete({ where: { id: targetUserId } }),
  ]);

  return {
    deletedCanvasIds: ownedCanvases.map((c) => c.id),
    memberCanvasIds: memberCanvases.map((m) => m.canvasId),
  };
}

export async function listAllCanvases(prisma: PrismaClient, q?: string): Promise<AdminCanvasInfo[]> {
  const query = q?.trim();
  const rows = await prisma.canvas.findMany({
    where: query ? { name: contains(query) } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { username: true } },
      group: { select: { id: true, name: true } },
      _count: { select: { members: true, commits: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.ownerId,
    owner: r.owner.username,
    memberCount: r._count.members,
    commitCount: r._count.commits,
    groupId: r.group?.id ?? null,
    groupName: r.group?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listAllGroups(prisma: PrismaClient, q?: string): Promise<AdminGroupInfo[]> {
  const query = q?.trim();
  const rows = await prisma.group.findMany({
    where: query ? { name: contains(query) } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { canvases: true, members: { where: { status: 'approved' } } } },
    },
  });
  if (rows.length === 0) return [];
  const pending = await prisma.groupMember.groupBy({
    by: ['groupId'],
    where: { groupId: { in: rows.map((r) => r.id) }, status: 'pending' },
    _count: { _all: true },
  });
  const pendingOf = new Map(pending.map((p) => [p.groupId, p._count._all]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    memberCount: r._count.members,
    pendingCount: pendingOf.get(r.id) ?? 0,
    canvasCount: r._count.canvases,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Grubu siler: üyelik/davet/rol tanımları şema kaskadıyla düşer, kanvaslar groupId=null ile kişiselleşir. */
export async function deleteGroup(prisma: PrismaClient, groupId: string): Promise<boolean> {
  const existing = await prisma.group.findUnique({ where: { id: groupId } });
  if (!existing) return false;
  await prisma.group.delete({ where: { id: groupId } });
  return true;
}
