import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { GroupRole, ServerMessage } from '@treemapper/shared';
import {
  adminSetPassword, deleteGroup, deleteUser, getStats, listAllCanvases, listAllGroups,
  listAllUsers, revokeUserSessions, setUserAdmin,
} from './adminService.js';
import { deleteCanvas, listMembers, removeMember, setMemberRole } from './canvasService.js';
import { approveMember, listGroupMembers, removeGroupMember, setGroupMemberRole } from './groupService.js';
import {
  clearSiteAsset, LOGIN_PREVIEW, MAX_BYTES, setSiteAssetUpload, setSiteAssetUrl,
} from './siteAssetService.js';

type Broadcast = (canvasId: string, msg: ServerMessage) => void;
type Kick = (canvasId: string, reason: 'deleted' | 'removed', userId?: string) => void;

/**
 * Site yönetim paneli uçları. `/api/admin` prefix'iyle kayıtlıdır; app.ts'deki scope
 * preHandler'ı isAdmin olmayan herkese 403 döndürmüştür (401'i global hook sağlar).
 * Kanvas içeriği (state/commit) bilinçli olarak yok: admin yalnızca metadata görür ve yönetir.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  broadcast: Broadcast,
  kick: Kick,
): void {
  app.get('/stats', async () => ({ stats: await getStats(prisma) }));

  // ---------- Görünüm: giriş ekranı önizleme görseli ----------

  app.put<{ Body: { dataUrl?: string; url?: string } }>(
    '/appearance/login-preview',
    // Base64 data URL gövdesi ham dosyadan ~%34 büyür; 2 MB'lık sınıra pay bırakılır.
    { bodyLimit: Math.ceil(MAX_BYTES * 1.4) },
    async (req, reply) => {
      const { dataUrl, url } = req.body ?? {};
      if (dataUrl && url) return reply.code(400).send({ error: 'Ya dosya ya adres gönderin, ikisini birden değil.' });
      const result = dataUrl
        ? await setSiteAssetUpload(prisma, LOGIN_PREVIEW, dataUrl)
        : url
          ? await setSiteAssetUrl(prisma, LOGIN_PREVIEW, url)
          : ({ error: 'Görsel dosyası veya adresi gerekli.' } as const);
      if ('error' in result) return reply.code(400).send(result);
      return { ok: true };
    },
  );

  app.delete('/appearance/login-preview', async () => {
    await clearSiteAsset(prisma, LOGIN_PREVIEW);
    return { ok: true };
  });

  // ---------- Kullanıcılar ----------

  app.get<{ Querystring: { q?: string } }>('/users', async (req) => ({
    users: await listAllUsers(prisma, req.query.q),
  }));

  app.patch<{ Params: { userId: string }; Body: { isAdmin?: boolean } }>('/users/:userId', async (req, reply) => {
    if (typeof req.body?.isAdmin !== 'boolean')
      return reply.code(400).send({ error: 'isAdmin true/false olmalı' });
    const err = await setUserAdmin(prisma, req.user!.id, req.params.userId, req.body.isAdmin);
    if (err) return reply.code(400).send(err);
    return { ok: true };
  });

  app.post<{ Params: { userId: string }; Body: { password?: string } }>(
    '/users/:userId/password',
    async (req, reply) => {
      const err = await adminSetPassword(prisma, req.params.userId, req.body?.password ?? '');
      if (err) return reply.code(400).send(err);
      return { ok: true };
    },
  );

  app.delete<{ Params: { userId: string } }>('/users/:userId/sessions', async (req) => ({
    ok: true,
    deleted: await revokeUserSessions(prisma, req.params.userId),
  }));

  app.delete<{ Params: { userId: string } }>('/users/:userId', async (req, reply) => {
    const result = await deleteUser(prisma, req.user!.id, req.params.userId);
    if ('error' in result) return reply.code(400).send(result);
    for (const canvasId of result.deletedCanvasIds) kick(canvasId, 'deleted');
    for (const canvasId of result.memberCanvasIds) {
      kick(canvasId, 'removed', req.params.userId);
      broadcast(canvasId, { type: 'members', members: await listMembers(prisma, canvasId) });
    }
    return { ok: true };
  });

  // ---------- Kanvaslar (yalnızca metadata + yönetim; içerik ucu yok) ----------

  app.get<{ Querystring: { q?: string } }>('/canvases', async (req) => ({
    canvases: await listAllCanvases(prisma, req.query.q),
  }));

  app.delete<{ Params: { canvasId: string } }>('/canvases/:canvasId', async (req, reply) => {
    const canvasId = req.params.canvasId;
    const existing = await prisma.canvas.findUnique({ where: { id: canvasId } });
    if (!existing) return reply.code(404).send({ error: 'kanvas bulunamadı' });
    kick(canvasId, 'deleted');
    await deleteCanvas(prisma, canvasId);
    return { ok: true };
  });

  app.get<{ Params: { canvasId: string } }>('/canvases/:canvasId/members', async (req, reply) => {
    const existing = await prisma.canvas.findUnique({ where: { id: req.params.canvasId } });
    if (!existing) return reply.code(404).send({ error: 'kanvas bulunamadı' });
    return { members: await listMembers(prisma, req.params.canvasId) };
  });

  app.patch<{ Params: { canvasId: string; userId: string }; Body: { role?: string } }>(
    '/canvases/:canvasId/members/:userId',
    async (req, reply) => {
      const role = req.body?.role;
      if (role !== 'editor' && role !== 'viewer')
        return reply.code(400).send({ error: "rol 'editor' veya 'viewer' olmalı" });
      const result = await setMemberRole(prisma, req.params.canvasId, req.params.userId, role);
      if ('error' in result) return reply.code(400).send(result);
      broadcast(req.params.canvasId, { type: 'members', members: result });
      return { members: result };
    },
  );

  app.delete<{ Params: { canvasId: string; userId: string } }>(
    '/canvases/:canvasId/members/:userId',
    async (req, reply) => {
      const { canvasId, userId } = req.params;
      const result = await removeMember(prisma, canvasId, userId);
      if ('error' in result) return reply.code(400).send(result);
      kick(canvasId, 'removed', userId);
      broadcast(canvasId, { type: 'members', members: result });
      return { members: result };
    },
  );

  /** Kanvasın açık davet linklerinin tamamını geçersiz kılar. */
  app.delete<{ Params: { canvasId: string } }>('/canvases/:canvasId/invites', async (req, reply) => {
    const existing = await prisma.canvas.findUnique({ where: { id: req.params.canvasId } });
    if (!existing) return reply.code(404).send({ error: 'kanvas bulunamadı' });
    const { count } = await prisma.invite.deleteMany({ where: { canvasId: req.params.canvasId } });
    return { ok: true, deleted: count };
  });

  // ---------- Gruplar ----------

  app.get<{ Querystring: { q?: string } }>('/groups', async (req) => ({
    groups: await listAllGroups(prisma, req.query.q),
  }));

  app.delete<{ Params: { groupId: string } }>('/groups/:groupId', async (req, reply) => {
    if (!(await deleteGroup(prisma, req.params.groupId)))
      return reply.code(404).send({ error: 'grup bulunamadı' });
    return { ok: true };
  });

  app.get<{ Params: { groupId: string } }>('/groups/:groupId/members', async (req, reply) => {
    const existing = await prisma.group.findUnique({ where: { id: req.params.groupId } });
    if (!existing) return reply.code(404).send({ error: 'grup bulunamadı' });
    return { members: await listGroupMembers(prisma, req.params.groupId) };
  });

  /** groupRoutes.ts'deki PATCH ile aynı gövde sözleşmesi: {status:'approved'} onaylar, {role} rol değiştirir. */
  app.patch<{ Params: { groupId: string; userId: string }; Body: { role?: string; status?: string } }>(
    '/groups/:groupId/members/:userId',
    async (req, reply) => {
      const { groupId, userId } = req.params;
      if (req.body?.status === 'approved') {
        const result = await approveMember(prisma, groupId, userId);
        if ('error' in result) return reply.code(400).send(result);
        return { members: result };
      }
      const role = req.body?.role;
      if (role !== 'admin' && role !== 'member')
        return reply.code(400).send({ error: "rol 'admin' veya 'member' olmalı" });
      const result = await setGroupMemberRole(prisma, groupId, userId, role as GroupRole);
      if ('error' in result) return reply.code(400).send(result);
      return { members: result };
    },
  );

  app.delete<{ Params: { groupId: string; userId: string } }>(
    '/groups/:groupId/members/:userId',
    async (req, reply) => {
      const result = await removeGroupMember(prisma, req.params.groupId, req.params.userId);
      if ('error' in result) return reply.code(400).send(result);
      return { members: result };
    },
  );
}
