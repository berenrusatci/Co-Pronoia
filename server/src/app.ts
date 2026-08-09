import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import type { CanvasRole, GroupRole, GroupMemberStatus, ServerMessage, SiteAppearance } from '@treemapper/shared';
import { CommitService } from './commitService.js';
import { memberRole } from './canvasService.js';
import { groupRole } from './groupService.js';
import { resolveSession, sessionToken } from './auth.js';
import { registerRoutes } from './routes.js';
import { registerAuthRoutes } from './authRoutes.js';
import { registerLocalIdentityRoutes } from './identityRoutes.js';
import type { EmailSender } from './email.js';
import { registerGoogleAuth } from './googleAuth.js';
import { registerCanvasRoutes } from './canvasRoutes.js';
import { registerGroupRoutes, registerGroupMemberRoutes, registerGroupAgentRoleRoutes } from './groupRoutes.js';
import { registerAdminRoutes } from './adminRoutes.js';
import { registerMcpRoutes } from './mcp/mcpRoutes.js';
import { CanvasEvents } from './canvasEvents.js';
import { getSiteAsset, LOGIN_PREVIEW } from './siteAssetService.js';
import { cloudUrl, isLocal } from './mode.js';
import { registerActivationRoutes } from './activationRoutes.js';
import { activatedUser, activationStatus } from './activationService.js';
import type { CloudClient } from './cloudClient.js';

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
  socket: {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    ping?(): void;
    terminate?(): void;
    on?(event: string, cb: () => void): void;
  };
  clientId: string;
  canvasId: string;
  userId: string;
  username: string;
  /** Heartbeat: pong geldiğinde true'ya döner; iki ping arası yanıt yoksa bağlantı ölü sayılır. */
  isAlive: boolean;
}

export async function buildApp(
  dbUrl: string,
  opts?: { emailSender?: EmailSender; cloudClient?: CloudClient },
) {
  const adapter = new PrismaPg({ connectionString: dbUrl });
  const prisma = new PrismaClient({ adapter });

  // Mod bir kez, kurulum anında sabitlenir: tek süreçte iki app (testlerde bulut + yerel)
  // ayağa kalkabilsin ve istek anında env değişse bile karışmasın.
  //
  // Aşağıdaki kapılar bilerek `!globalThis.__LOCAL_BUILD__ && !localMode` biçiminde:
  // yerel imaj bundle'ında esbuild `define` ilk terime `true` yazar, ifade `false`a katlanır
  // ve o modüller (kayıt/giriş, Google OAuth, admin paneli) bundle'a HİÇ girmez. Bundle
  // dışında (test/dev/bulut) okuma `undefined`dır ve karar tümüyle runtime `localMode`a
  // düşer. Gerekçesi ve neden sabit yerine dot-chain olduğu: `mode.ts`.
  const localMode = isLocal();

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
    // /api/site/*: giriş ekranı oturum açılmadan çizildiği için görünüm ayarı herkese açık.
    // /api/mcp: oturum çerezi yerine Bearer ajan anahtarıyla korunur (mcpRoutes.ts kendisi 401 verir).
    // /api/activation/* + /api/instance/*: aktivasyon el sıkışmasının kendisi (yerelde oturum
    // henüz yok, bulutta Bearer kurulum anahtarıyla korunur — activationRoutes.ts 401 verir).
    // İstisnanın istisnaları: `pull` ve `reset` el sıkışmanın parçası değil, aktive
    // edilmiş kurulumun tetiklediği işlemler — normal kimlik kontrolünden geçerler.
    const activationHandshake =
      req.url.startsWith('/api/activation/') &&
      !req.url.startsWith('/api/activation/pull') &&
      !req.url.startsWith('/api/activation/reset');
    if (
      req.url.startsWith('/api/auth/') || req.url.startsWith('/api/site/') ||
      req.url.startsWith('/api/mcp') || req.url === '/api/health' || req.url === '/api/mode' ||
      activationHandshake || req.url.startsWith('/api/instance/')
    ) return;
    // Yerel mod tek kullanıcılıdır: çerez yerine aktive edilmiş kimlik kullanılır.
    req.user = localMode ? await activatedUser(prisma) : await resolveSession(prisma, sessionToken(req));
    if (!req.user)
      return reply.code(401).send({ error: localMode ? 'kurulum etkinleştirilmemiş' : 'oturum gerekli' });
  });

  const wsClients = new Set<WsClient>();
  const canvasEvents = new CanvasEvents();
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
    // MCP wait_for_changes long-poll bekleyicileri aynı choke point'ten uyanır: head'i
    // ilerletebilen ya da önerileri değiştiren her mesaj bir sinyaldir (presence/members
    // gibi mesajlar bekleyicileri ilgilendirmez, onlar için sinyal üretilmez).
    if (
      msg.type === 'commit' || msg.type === 'branch_created' ||
      msg.type === 'branch_resolved' || msg.type === 'proposals' || msg.type === 'brief'
    )
      canvasEvents.notify(canvasId);
  };

  const broadcastPresence = (canvasId: string) => {
    const users = [...new Set([...wsClients].filter((c) => c.canvasId === canvasId).map((c) => c.username))];
    broadcast(canvasId, { type: 'presence', users });
  };

  // Heartbeat: sessizce kopan bağlantılar (proxy timeout, ağ kesintisi) close olayı üretmez;
  // ping'e iki tur üst üste pong dönmeyen soket ölü sayılır, kapatılır ve presence tazelenir.
  const heartbeat = setInterval(() => {
    const staleCanvases = new Set<string>();
    for (const c of [...wsClients]) {
      if (!c.socket.ping) continue;
      if (!c.isAlive) {
        wsClients.delete(c);
        staleCanvases.add(c.canvasId);
        try {
          c.socket.terminate?.();
        } catch {
          /* already gone */
        }
        continue;
      }
      c.isAlive = false;
      try {
        c.socket.ping();
      } catch {
        wsClients.delete(c);
        staleCanvases.add(c.canvasId);
      }
    }
    for (const canvasId of staleCanvases) broadcastPresence(canvasId);
  }, 30_000);
  app.addHook('onClose', async () => clearInterval(heartbeat));

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

  // Web hangi ekranı çizeceğini (giriş / aktivasyon / pano) buradan bilir; oturum gerekmez.
  app.get('/api/mode', async () => ({
    mode: localMode ? 'local' : 'cloud',
    ...(localMode ? { activated: (await activationStatus(prisma)).activated } : { activated: true }),
    cloudUrl: localMode ? cloudUrl() : null,
  }));

  // ---------- Herkese açık site görünümü (giriş ekranı için; oturum gerekmez) ----------

  app.get('/api/site/appearance', async () => {
    const asset = await getSiteAsset(prisma, LOGIN_PREVIEW);
    // Yüklenen görsel kendi ucundan servis edilir; `v` damgası admin değiştirince cache'i kırar.
    const loginPreview = asset?.url
      ? asset.url
      : asset?.data
        ? `/api/site/login-preview?v=${asset.updatedAt.getTime()}`
        : null;
    return { appearance: { loginPreview } satisfies SiteAppearance };
  });

  app.get('/api/site/login-preview', async (_req, reply) => {
    const asset = await getSiteAsset(prisma, LOGIN_PREVIEW);
    if (!asset?.data || !asset.mimeType) return reply.code(404).send({ error: 'görsel yok' });
    return reply
      .header('Content-Type', asset.mimeType)
      // Yüklenen içerik kendi origin'imizden çıkıyor: tarayıcı tipi tahmin etmesin ve
      // doğrudan gezinilse bile hiçbir alt kaynak/script çalışmasın.
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'public, max-age=300')
      .send(Buffer.from(asset.data));
  });

  app.register(async (scope) => {
    scope.get<{ Querystring: { canvas?: string } }>('/api/ws', { websocket: true }, async (socket, req) => {
      const canvasId = req.query.canvas ?? '';
      const user = req.user;
      if (!canvasId || !user || !(await memberRole(prisma, canvasId, user.id))) {
        socket.close(4403, 'kanvas erişimi yok');
        return;
      }
      const clientId = randomUUID();
      const client: WsClient = { socket, clientId, canvasId, userId: user.id, username: user.username, isAlive: true };
      wsClients.add(client);
      socket.on('pong', () => {
        client.isAlive = true;
      });
      socket.send(JSON.stringify({ type: 'hello', clientId } satisfies ServerMessage));
      broadcastPresence(canvasId);
      socket.on('close', () => {
        wsClients.delete(client);
        broadcastPresence(canvasId);
      });
    });
  });

  // Kimlik: bulut modunda tam hesap yönetimi, yerelde yalnız "ben kimim" + profil.
  // Kapı derleme anında katlandığı için yerel imajda authRoutes.ts (scrypt, kayıt,
  // e-posta doğrulama, giriş/çıkış, şifre) bundle'a hiç girmez.
  if (!globalThis.__LOCAL_BUILD__ && !localMode) registerAuthRoutes(app, prisma, opts?.emailSender);
  else registerLocalIdentityRoutes(app, prisma);
  registerActivationRoutes(app, prisma, serviceFor, opts?.cloudClient);
  // Google girişi yerel modda anlamsız (hesap yönetimi yok).
  if (!globalThis.__LOCAL_BUILD__ && !localMode && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    await registerGoogleAuth(app, prisma);
  }
  registerCanvasRoutes(app, prisma, serviceFor, broadcast, localMode);
  registerGroupRoutes(app, prisma, localMode);
  registerMcpRoutes(app, prisma, serviceFor, broadcast, canvasEvents);

  // All graph routes live under a canvas and require membership.
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', async (req, reply) => {
        const { canvasId } = req.params as { canvasId: string };
        const role = await memberRole(prisma, canvasId, req.user!.id);
        if (!role) return reply.code(404).send({ error: 'kanvas bulunamadı' });
        req.memberRole = role;
      });
      registerRoutes(scope, prisma, serviceFor, broadcast, kick, localMode);
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
      // Üyelik/davet/iş rolleri yalnız bulutta; ajan rolleri (MCP anahtarının bağlandığı
      // AgentRoleDef) her iki modda da gerekli.
      if (!globalThis.__LOCAL_BUILD__ && !localMode) registerGroupMemberRoutes(scope, prisma);
      registerGroupAgentRoleRoutes(scope, prisma);
    },
    { prefix: '/api/groups/:groupId' },
  );

  // Site yönetim paneli: yalnızca isAdmin kullanıcılar (401'i global hook verir).
  // Yerel modda site yönetimi diye bir şey yok — uçlar hiç oluşturulmaz (404).
  if (!globalThis.__LOCAL_BUILD__ && !localMode) await app.register(
    async (scope) => {
      scope.addHook('preHandler', async (req, reply) => {
        if (!req.user?.isAdmin) return reply.code(403).send({ error: 'yönetici yetkisi gerekli' });
      });
      registerAdminRoutes(scope, prisma, broadcast, kick);
    },
    { prefix: '/api/admin' },
  );

  return { app, prisma, serviceFor, broadcast, wsClients };
}
