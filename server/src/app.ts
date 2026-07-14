import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import type { CanvasRole, GroupRole, GroupMemberStatus, ServerMessage } from '@treemapper/shared';
import { CommitService } from './commitService.js';
import { memberRole } from './canvasService.js';
import { groupRole } from './groupService.js';
import { resolveSession, sessionToken } from './auth.js';
import { registerRoutes } from './routes.js';
import { registerAuthRoutes } from './authRoutes.js';
import { registerGoogleAuth } from './googleAuth.js';
import { registerCanvasRoutes } from './canvasRoutes.js';
import { registerGroupRoutes, registerGroupMemberRoutes } from './groupRoutes.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Requester's role on the canvas in the URL; set by the canvas-scope preHandler. */
    memberRole: CanvasRole | null;
    /** Requester's role/status on the group in the URL; set by the group-scope preHandler. */
    groupRole: GroupRole | null;
    groupStatus: GroupMemberStatus | null;
  }
}

export interface WsClient {
  socket: { send(data: string): void; close(code?: number, reason?: string): void };
  clientId: string;
  canvasId: string;
  userId: string;
  username: string;
}

export async function buildApp(dbUrl: string) {
  const adapter = new PrismaPg({ connectionString: dbUrl });
  const prisma = new PrismaClient({ adapter });

  // One CommitService per canvas: its promise-chain mutex serializes writes per canvas.
  const services = new Map<string, CommitService>();
  const serviceFor = (canvasId: string): CommitService => {
    let service = services.get(canvasId);
    if (!service) {
      service = new CommitService(prisma, canvasId);
      services.set(canvasId, service);
    }
    return service;
  };

  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket);

  // Session auth for every /api route except health and auth.
  app.decorateRequest('user', null);
  app.decorateRequest('memberRole', null);
  app.decorateRequest('groupRole', null);
  app.decorateRequest('groupStatus', null);
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api')) return;
    if (req.url.startsWith('/api/auth/') || req.url === '/api/health') return;
    req.user = await resolveSession(prisma, sessionToken(req));
    if (!req.user) return reply.code(401).send({ error: 'oturum gerekli' });
  });

  const wsClients = new Set<WsClient>();
  const broadcast = (canvasId: string, msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const c of wsClients) {
      if (c.canvasId !== canvasId) continue;
      try {
        c.socket.send(data);
      } catch {
        wsClients.delete(c);
      }
    }
  };

  const broadcastPresence = (canvasId: string) => {
    const users = [...new Set([...wsClients].filter((c) => c.canvasId === canvasId).map((c) => c.username))];
    broadcast(canvasId, { type: 'presence', users });
  };

  /** Notify + disconnect a canvas's sockets (all of them, or one removed user's). */
  const kick = (canvasId: string, reason: 'deleted' | 'removed', userId?: string) => {
    const gone = JSON.stringify({ type: 'canvas_gone', reason } satisfies ServerMessage);
    for (const c of [...wsClients]) {
      if (c.canvasId !== canvasId) continue;
      if (userId !== undefined && c.userId !== userId) continue;
      try {
        c.socket.send(gone);
        c.socket.close(4000, reason);
      } catch {
        /* already gone */
      }
      wsClients.delete(c);
    }
    broadcastPresence(canvasId);
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.register(async (scope) => {
    scope.get<{ Querystring: { canvas?: string } }>('/api/ws', { websocket: true }, async (socket, req) => {
      const canvasId = req.query.canvas ?? '';
      const user = req.user;
      if (!canvasId || !user || !(await memberRole(prisma, canvasId, user.id))) {
        socket.close(4403, 'kanvas erişimi yok');
        return;
      }
      const clientId = randomUUID();
      const client: WsClient = { socket, clientId, canvasId, userId: user.id, username: user.username };
      wsClients.add(client);
      socket.send(JSON.stringify({ type: 'hello', clientId } satisfies ServerMessage));
      broadcastPresence(canvasId);
      socket.on('close', () => {
        wsClients.delete(client);
        broadcastPresence(canvasId);
      });
    });
  });

  registerAuthRoutes(app, prisma);
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    await registerGoogleAuth(app, prisma);
  }
  registerCanvasRoutes(app, prisma, serviceFor, broadcast);
  registerGroupRoutes(app, prisma);

  // All graph routes live under a canvas and require membership.
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', async (req, reply) => {
        const { canvasId } = req.params as { canvasId: string };
        const role = await memberRole(prisma, canvasId, req.user!.id);
        if (!role) return reply.code(404).send({ error: 'kanvas bulunamadı' });
        req.memberRole = role;
      });
      registerRoutes(scope, prisma, serviceFor, broadcast, kick);
    },
    { prefix: '/api/canvases/:canvasId' },
  );

  // Group member-management routes require an existing (pending or approved) membership.
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', async (req, reply) => {
        const { groupId } = req.params as { groupId: string };
        const membership = await groupRole(prisma, groupId, req.user!.id);
        if (!membership) return reply.code(404).send({ error: 'grup bulunamadı' });
        req.groupRole = membership.role;
        req.groupStatus = membership.status;
      });
      registerGroupMemberRoutes(scope, prisma);
    },
    { prefix: '/api/groups/:groupId' },
  );

  return { app, prisma, serviceFor, broadcast, wsClients };
}
