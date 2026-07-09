import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ServerMessage } from '@treemapper/shared';
import { CommitService } from './commitService.js';
import { isMember } from './canvasService.js';
import { resolveSession, sessionToken } from './auth.js';
import { registerRoutes } from './routes.js';
import { registerAuthRoutes } from './authRoutes.js';
import { registerCanvasRoutes } from './canvasRoutes.js';

export interface WsClient {
  socket: { send(data: string): void };
  clientId: string;
  canvasId: string;
}

export async function buildApp(dbUrl: string) {
  const filePath = dbUrl.replace(/^file:/, '');
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
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

  app.get('/api/health', async () => ({ ok: true }));

  app.register(async (scope) => {
    scope.get<{ Querystring: { canvas?: string } }>('/api/ws', { websocket: true }, async (socket, req) => {
      const canvasId = req.query.canvas ?? '';
      if (!canvasId || !req.user || !(await isMember(prisma, canvasId, req.user.id))) {
        socket.close(4403, 'kanvas erişimi yok');
        return;
      }
      const clientId = randomUUID();
      const client: WsClient = { socket, clientId, canvasId };
      wsClients.add(client);
      socket.send(JSON.stringify({ type: 'hello', clientId } satisfies ServerMessage));
      socket.on('close', () => wsClients.delete(client));
    });
  });

  registerAuthRoutes(app, prisma);
  registerCanvasRoutes(app, prisma, serviceFor);

  // All graph routes live under a canvas and require membership.
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', async (req, reply) => {
        const { canvasId } = req.params as { canvasId: string };
        if (!(await isMember(prisma, canvasId, req.user!.id)))
          return reply.code(404).send({ error: 'kanvas bulunamadı' });
      });
      registerRoutes(scope, prisma, serviceFor, broadcast);
    },
    { prefix: '/api/canvases/:canvasId' },
  );

  return { app, prisma, serviceFor, broadcast, wsClients };
}
