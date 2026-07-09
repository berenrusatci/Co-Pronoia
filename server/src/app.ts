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
import { resolveSession, sessionToken } from './auth.js';
import { registerRoutes } from './routes.js';
import { registerAuthRoutes } from './authRoutes.js';

export interface WsClient {
  socket: { send(data: string): void };
  clientId: string;
}

export async function buildApp(dbUrl: string) {
  const filePath = dbUrl.replace(/^file:/, '');
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  const prisma = new PrismaClient({ adapter });
  const service = new CommitService(prisma);

  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket);

  // Session auth for every /api route except health, auth and the WS handshake
  // (the WS route checks the cookie itself so it can close with a WS status).
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api')) return;
    if (req.url.startsWith('/api/auth/') || req.url === '/api/health') return;
    req.user = await resolveSession(prisma, sessionToken(req));
    if (!req.user) return reply.code(401).send({ error: 'oturum gerekli' });
  });

  const wsClients = new Set<WsClient>();
  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const c of wsClients) {
      try {
        c.socket.send(data);
      } catch {
        wsClients.delete(c);
      }
    }
  };

  app.register(async (scope) => {
    scope.get('/api/ws', { websocket: true }, (socket, req) => {
      const clientId = randomUUID();
      const client: WsClient = { socket, clientId };
      wsClients.add(client);
      socket.send(JSON.stringify({ type: 'hello', clientId } satisfies ServerMessage));
      socket.on('close', () => wsClients.delete(client));
    });
  });

  registerAuthRoutes(app, prisma);
  registerRoutes(app, service, broadcast);

  return { app, service, prisma, broadcast, wsClients };
}
