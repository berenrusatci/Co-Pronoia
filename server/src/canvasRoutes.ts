import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { ServerMessage } from '@co-pronoia/shared';
import { acceptInvite, createCanvas, inviteInfo, listCanvases, listMembers, type ServiceFor } from './canvasService.js';
import { memberPermissions } from './groupService.js';
import { parseCanvasBundle, BundleError } from '@co-pronoia/shared';
import { importBundle } from './canvasImportService.js';

/** Dashboard-level routes: canvas list/create + invite lookup/accept (not canvas-scoped). */
export function registerCanvasRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  broadcast: (canvasId: string, msg: ServerMessage) => void,
  /** Yerel mod: davet arama/kabul uçları hiç oluşturulmaz (aşağıdaki kapıya bak). */
  localMode = false,
): void {
  app.get('/api/canvases', async (req) => ({ canvases: await listCanvases(prisma, req.user!.id) }));

  app.post<{ Body: { name?: string; groupId?: string; type?: string } | null }>('/api/canvases', async (req, reply) => {
    const name = (req.body?.name ?? '').trim();
    if (name.length === 0) return reply.code(400).send({ error: 'kanvas adı gerekli' });
    if (name.length > 80) return reply.code(400).send({ error: 'kanvas adı en fazla 80 karakter olabilir' });
    // Her yeni kanvas bir gruba bağlı olmalı; yetki = admin ya da rolünde canCreateCanvas.
    const groupId = req.body?.groupId || undefined;
    if (!groupId) return reply.code(400).send({ error: 'kanvas bir gruba bağlı olmalı (groupId gerekli)' });
    const type = req.body?.type ?? 'plan';
    if (type !== 'plan' && type !== 'co-pronoia')
      return reply.code(400).send({ error: 'geçersiz kanvas türü' });
    const perms = await memberPermissions(prisma, groupId, req.user!.id);
    if (!perms) return reply.code(403).send({ error: 'bu grubun onaylı üyesi değilsiniz' });
    if (!perms.canCreateCanvas)
      return reply.code(403).send({ error: 'bu grupta kanvas oluşturma yetkiniz yok' });
    if (type === 'co-pronoia') {
      const group = await prisma.group.findUnique({ where: { id: groupId }, select: { type: true } });
      if (group?.type !== 'co-pronoia')
        return reply.code(400).send({ error: 'co-pronoia kanvası yalnızca co-pronoia türündeki bir grupta oluşturulabilir' });
    }
    return { canvas: await createCanvas(prisma, serviceFor, name, req.user!.id, { groupId, type }) };
  });

  /**
   * JSON paketinden YENİ kanvas oluştur (plandaki tp3). groupId zorunlu; kanvas oluşturma yetkisi
   * `POST /api/canvases` ile aynı kurala tabidir; owner = içe aktaran. Düğüm+kenarlar tek commit'le
   * (aktör = içe aktaran) normal commit yolundan iner; bölgeler owner config olarak yeniden kurulur.
   */
  app.post<{ Body: { groupId?: string; bundle?: unknown; name?: string } | null }>('/api/canvases/import', async (req, reply) => {
    const groupId = req.body?.groupId || undefined;
    if (!groupId) return reply.code(400).send({ error: 'kanvas bir gruba bağlı olmalı (groupId gerekli)' });
    let bundle;
    try {
      bundle = parseCanvasBundle(req.body?.bundle);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof BundleError ? e.message : 'geçersiz paket' });
    }
    const name = ((req.body?.name ?? bundle.name) || 'İçe aktarılan kanvas').trim().slice(0, 80) || 'İçe aktarılan kanvas';
    const perms = await memberPermissions(prisma, groupId, req.user!.id);
    if (!perms) return reply.code(403).send({ error: 'bu grubun onaylı üyesi değilsiniz' });
    if (!perms.canCreateCanvas) return reply.code(403).send({ error: 'bu grupta kanvas oluşturma yetkiniz yok' });

    return { canvas: await importBundle(prisma, serviceFor, bundle, { name, ownerId: req.user!.id, groupId }) };
  });

  // Davet linkleri yerel modda yok: tek kullanıcılık kurulumda katılacak kimse yok.
  // Derleme anı kapısı sayesinde bu kod yerel imaj bundle'ına da girmez.
  if (globalThis.__LOCAL_BUILD__ || localMode) return;

  app.get<{ Params: { token: string } }>('/api/invites/:token', async (req, reply) => {
    const invite = await inviteInfo(prisma, req.params.token);
    if (!invite) return reply.code(404).send({ error: 'davet linki geçersiz' });
    return { canvasName: invite.canvas.name, invitedBy: invite.creator.username };
  });

  app.post<{ Params: { token: string } }>('/api/invites/:token/accept', async (req, reply) => {
    const canvas = await acceptInvite(prisma, req.params.token, req.user!.id);
    if (!canvas) return reply.code(404).send({ error: 'davet linki geçersiz' });
    // Anyone with the canvas open sees the new member immediately.
    broadcast(canvas.id, { type: 'members', members: await listMembers(prisma, canvas.id) });
    return { canvas };
  });
}
