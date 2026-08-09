import type { PrismaClient } from '@prisma/client';
import { ValidationError } from '@co-pronoia/shared';
import type { CanvasBriefInfo, CanvasBriefRevisionInfo } from '@co-pronoia/shared';

/** Brifing içeriği üst sınırı (~50 KB): kötüye kullanım/aşırı şişme freni. */
export const MAX_BRIEF_LENGTH = 50_000;

/**
 * Kanvas brifing dokümanı ("kanvasın CLAUDE.md'si"). Bölgeler gibi kanvas AYARIDIR:
 * Node/Edge/Commit'e dokunmaz, rebuildCheck hattına girmez. Güncel içerik = en büyük id'li
 * CanvasBriefRevision satırı; her yazma append'dir, mutex gerekmez.
 */
export async function getBrief(prisma: PrismaClient, canvasId: string): Promise<CanvasBriefInfo> {
  const [latest, revisionCount] = await Promise.all([
    prisma.canvasBriefRevision.findFirst({ where: { canvasId }, orderBy: { id: 'desc' } }),
    prisma.canvasBriefRevision.count({ where: { canvasId } }),
  ]);
  return {
    content: latest?.content ?? '',
    authorLabel: latest?.authorLabel ?? null,
    updatedAt: latest?.createdAt.toISOString() ?? null,
    revisionCount,
  };
}

export async function listBriefRevisions(
  prisma: PrismaClient, canvasId: string, limit = 20,
): Promise<CanvasBriefRevisionInfo[]> {
  const rows = await prisma.canvasBriefRevision.findMany({
    where: { canvasId },
    orderBy: { id: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id, content: r.content, authorLabel: r.authorLabel, createdAt: r.createdAt.toISOString(),
  }));
}

/** Yeni bir revizyon ekler ve güncel brifi döndürür. authorLabel: kullanıcı adı ya da "label/roleName". */
export async function updateBrief(
  prisma: PrismaClient, canvasId: string, content: string, authorLabel: string,
): Promise<CanvasBriefInfo> {
  if (typeof content !== 'string') throw new ValidationError('içerik metin olmalı');
  if (content.length > MAX_BRIEF_LENGTH)
    throw new ValidationError(`kanvas notu en fazla ${MAX_BRIEF_LENGTH} karakter olabilir`);
  await prisma.canvasBriefRevision.create({
    data: { canvasId, content, authorLabel: authorLabel.slice(0, 200) },
  });
  return getBrief(prisma, canvasId);
}
