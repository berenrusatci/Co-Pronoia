import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { serializeCanvas } from '@co-pronoia/shared';
import { resolveSession, sessionToken } from './auth.js';
import {
  activationStatus, approveInstance, completeActivation, exchangeInstance,
  pullCloudCanvases, resetActivation, resolveInstanceToken, startActivation,
} from './activationService.js';
import { listCanvases, listRegions, memberRole, type ServiceFor } from './canvasService.js';
import { defaultCloudClient, type CloudClient } from './cloudClient.js';
import { isLocal } from './mode.js';

/** İsteğin geldiği yerel adres (bulut, callback için buraya geri yönlendirir). */
function originOf(req: FastifyRequest): string {
  const host = req.headers.host ?? '127.0.0.1:3001';
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol ?? 'http';
  return `${proto}://${host}`;
}

const bearer = (req: FastifyRequest): string =>
  (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();

/**
 * Aktivasyon uçları. Yerel kurulum onay **istemcisi** (start/callback/pull), bulut ise onay
 * **sunucusu** (approve/exchange + Bearer korumalı `/api/instance/*` okuma uçları) tarafını
 * register eder — tek kod tabanı, moda göre iki farklı yüz.
 */
export function registerActivationRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  cloud: CloudClient = defaultCloudClient,
): void {
  if (isLocal()) {
    app.get('/api/activation/status', async () => activationStatus(prisma));

    app.get('/api/activation/start', async (req, reply) => {
      const status = await activationStatus(prisma);
      if (status.activated) return reply.redirect('/?etkin=1');
      const { redirectTo } = await startActivation(prisma, originOf(req));
      return reply.redirect(redirectTo);
    });

    app.get<{ Querystring: { state?: string; code?: string; hata?: string } }>(
      '/api/activation/callback',
      async (req, reply) => {
        if (req.query.hata) return reply.redirect(`/?aktivasyon_hata=${encodeURIComponent(req.query.hata)}`);
        const result = await completeActivation(prisma, cloud, {
          state: req.query.state ?? '',
          code: req.query.code ?? '',
        });
        if ('error' in result) return reply.redirect(`/?aktivasyon_hata=${encodeURIComponent(result.error)}`);
        // İlk çekme aktivasyonun hemen ardından; hatası aktivasyonu geçersiz kılmaz.
        const pulled = await pullCloudCanvases(prisma, serviceFor, cloud);
        const count = 'error' in pulled ? 0 : pulled.imported;
        return reply.redirect(`/?etkin=1&alinan=${count}`);
      },
    );

    // Panodaki "Buluttan çek" butonu: aktivasyondan sonra istenildiği kadar tekrarlanabilir.
    app.post('/api/activation/pull', async (_req, reply) => {
      const result = await pullCloudCanvases(prisma, serviceFor, cloud);
      if ('error' in result) return reply.code(400).send(result);
      return result;
    });

    /**
     * Yerel modun "çıkış yap"ı: bağlantıyı koparır, kurulum aktivasyon ekranına döner.
     * `pull` gibi el sıkışmanın parçası DEĞİLDİR — app.ts'teki global hook bunu normal
     * kimlik kontrolünden geçirir, yani yalnız aktive edilmiş kurulum çağırabilir.
     */
    app.post<{ Body: { wipe?: boolean } | null }>('/api/activation/reset', async (req, reply) => {
      const result = await resetActivation(prisma, { wipe: req.body?.wipe === true });
      if ('error' in result) return reply.code(400).send(result);
      return result;
    });
    return;
  }

  // ---------- Bulut tarafı ----------

  // Onay ekranının "Etkinleştir" butonu. /api/activation/* global auth hook'undan muaf
  // olduğu için oturumu burada çözüyoruz (authRoutes deseni).
  app.post<{ Body: { state?: string; redirect?: string; proof?: string } }>(
    '/api/activation/approve',
    async (req, reply) => {
      const user = await resolveSession(prisma, sessionToken(req));
      if (!user) return reply.code(401).send({ error: 'oturum gerekli' });
      const result = await approveInstance(prisma, user.id, {
        state: req.body?.state ?? '',
        redirect: req.body?.redirect ?? '',
        proof: req.body?.proof ?? '',
      });
      if ('error' in result) return reply.code(400).send(result);
      return { redirectTo: result.redirectTo };
    },
  );

  app.post<{ Body: { state?: string; code?: string; verifier?: string } }>(
    '/api/activation/exchange',
    async (req, reply) => {
      const result = await exchangeInstance(prisma, {
        state: req.body?.state ?? '',
        code: req.body?.code ?? '',
        verifier: req.body?.verifier ?? '',
      });
      if ('error' in result) return reply.code(400).send(result);
      return result;
    },
  );

  // Yerel kurulumun okuma uçları: Bearer instance token, yalnızca kanvas listesi + paket.
  app.register(async (scope) => {
    scope.addHook('preHandler', async (req, reply) => {
      const row = await resolveInstanceToken(prisma, bearer(req));
      if (!row) return reply.code(401).send({ error: 'geçersiz kurulum anahtarı' });
      req.user = {
        id: row.user.id, username: row.user.username, email: row.user.email,
        displayName: row.user.displayName, avatarUrl: row.user.avatarUrl, isAdmin: row.user.isAdmin,
      };
    });

    /**
     * Çekilecek kanvasların künyesi. Grup kimliği ve **tür** de döner: bunlar olmadan
     * yerel taraf her kanvası tek bir "Yerel çalışma alanı" grubuna ve `plan` türüne
     * indiriyordu — co-pronoia kanvasları yerelde co-pronoia olarak açılamıyor,
     * dolayısıyla MCP paneli hiç görünmüyordu.
     */
    scope.get('/api/instance/canvases', async (req) => {
      const canvases = await listCanvases(prisma, req.user!.id);
      return {
        canvases: canvases.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          groupId: c.groupId ?? null,
        })),
      };
    });

    /**
     * Kanvasların bağlı olduğu gruplar + o grupların ajan rolleri. Roller de gelmeli:
     * yerelde MCP anahtarı ancak bir AgentRoleDef'e bağlanarak üretilebilir, rol yoksa
     * çekilen co-pronoia kanvası kullanılamaz. Ajan ANAHTARLARI bilerek gönderilmez —
     * DB'de yalnızca sha256'ları var ve yerel kurulum kendi anahtarını üretmelidir.
     */
    scope.get('/api/instance/groups', async (req) => {
      const memberships = await prisma.groupMember.findMany({
        where: { userId: req.user!.id, status: 'approved' },
        select: { group: { select: { id: true, name: true, type: true } } },
      });
      const groups = memberships.map((m) => m.group);
      const roles = groups.length
        ? await prisma.agentRoleDef.findMany({
            where: { groupId: { in: groups.map((g) => g.id) } },
            select: { groupId: true, name: true, persona: true, isSupervisor: true },
          })
        : [];
      return {
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          type: g.type,
          agentRoles: roles
            .filter((r) => r.groupId === g.id)
            .map((r) => ({ name: r.name, persona: r.persona, isSupervisor: r.isSupervisor })),
        })),
      };
    });

    scope.get<{ Params: { canvasId: string } }>(
      '/api/instance/canvases/:canvasId/export',
      async (req, reply) => {
        const { canvasId } = req.params;
        if (!(await memberRole(prisma, canvasId, req.user!.id)))
          return reply.code(404).send({ error: 'kanvas bulunamadı' });
        const [state, canvas, regions] = await Promise.all([
          serviceFor(canvasId).getState(),
          prisma.canvas.findUnique({ where: { id: canvasId }, select: { name: true } }),
          listRegions(prisma, canvasId),
        ]);
        return serializeCanvas(state, { name: canvas?.name ?? 'kanvas', regions });
      },
    );
  });
}
