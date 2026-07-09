import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { ServerMessage } from '@treemapper/shared';
import { acceptInvite, createCanvas, inviteInfo, listCanvases, listMembers, type ServiceFor } from './canvasService.js';

/** Dashboard-level routes: canvas list/create + invite lookup/accept (not canvas-scoped). */
export function registerCanvasRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  broadcast: (canvasId: string, msg: ServerMessage) => void,
): void {
  app.get('/api/canvases', async (req) => ({ canvases: await listCanvases(prisma, req.user!.id) }));

  app.post<{ Body: { name?: string } | null }>('/api/canvases', async (req, reply) => {
    const name = (req.body?.name ?? '').trim();
    if (name.length === 0) return reply.code(400).send({ error: 'kanvas adı gerekli' });
    if (name.length > 80) return reply.code(400).send({ error: 'kanvas adı en fazla 80 karakter olabilir' });
    return { canvas: await createCanvas(prisma, serviceFor, name, req.user!.id) };
  });

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
