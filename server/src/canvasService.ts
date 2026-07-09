import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { CanvasInfo } from '@treemapper/shared';
import type { CommitService } from './commitService.js';

export type ServiceFor = (canvasId: string) => CommitService;

export async function listCanvases(prisma: PrismaClient, userId: string): Promise<CanvasInfo[]> {
  const rows = await prisma.canvas.findMany({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { username: true } },
      _count: { select: { members: true } },
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (rows.length === 0) return [];
  const heads = await prisma.commit.groupBy({
    by: ['canvasId'],
    where: { canvasId: { in: rows.map((r) => r.id) }, branchId: null },
    _max: { seq: true },
  });
  const headOf = new Map(heads.map((h) => [h.canvasId, h._max.seq ?? 0]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    owner: r.owner.username,
    role: (r.members[0]?.role ?? 'member') as CanvasInfo['role'],
    memberCount: r._count.members,
    headSeq: headOf.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
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
  opts: { seedRoot?: boolean } = {},
): Promise<CanvasInfo> {
  const canvas = await prisma.canvas.create({
    data: { name, ownerId, members: { create: { userId: ownerId, role: 'owner' } } },
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
  const row = await prisma.canvasMember.findUnique({
    where: { canvasId_userId: { canvasId, userId } },
  });
  return row !== null;
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
