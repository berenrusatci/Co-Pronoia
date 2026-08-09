import type { PrismaClient } from '@prisma/client';
import type { CanvasBundle, CanvasInfo, CanvasType } from '@co-pronoia/shared';
import { bundleToIntents } from '@co-pronoia/shared';
import { createCanvas, createRegion, type ServiceFor } from './canvasService.js';

/**
 * Bir paketten YENİ kanvas kurar: seed kök yok (paketin kendi kökleri gelir), düğüm+kenarlar
 * tek commit'le normal commit yolundan iner (aktör = içe aktaran), bölgeler owner config
 * olarak yeniden kurulur.
 *
 * `POST /api/canvases/import` ile buluttan çekme (activationService) aynı gövdeyi kullanır.
 */
export async function importBundle(
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  bundle: CanvasBundle,
  opts: { name: string; ownerId: string; groupId?: string; type?: CanvasType },
): Promise<CanvasInfo> {
  const canvas = await createCanvas(prisma, serviceFor, opts.name, opts.ownerId, {
    groupId: opts.groupId,
    type: opts.type,
    seedRoot: false,
  });
  const intents = bundleToIntents(bundle);
  if (intents.length > 0) {
    await serviceFor(canvas.id).commit(intents, {
      message: `İçe aktarım: ${bundle.nodes.length} düğüm, ${bundle.edges.length} kenar`,
      authorId: opts.ownerId,
      actor: { userId: opts.ownerId, role: 'owner' },
    });
  }
  for (const r of bundle.regions) {
    await createRegion(prisma, canvas.id, {
      name: r.name, x: r.x, y: r.y, width: r.width, height: r.height,
      color: r.color, description: r.description, aiAllowed: r.aiAllowed,
    });
  }
  return canvas;
}
