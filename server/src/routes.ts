import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { OpInput, ServerMessage } from '@treemapper/shared';
import { ConflictError, RegionError, ValidationError, type Actor } from './commitService.js';
import {
  createInvite, createRegion, deleteCanvas, deleteRegion, listMembers, listRegions,
  removeMember, setCanvasRoleAccess, setMemberRole, setRegionMembers, updateRegion, type ServiceFor,
} from './canvasService.js';
import { memberPermissions } from './groupService.js';
import { geminiConfigured, runAgent } from './agent.js';

type Broadcast = (canvasId: string, msg: ServerMessage) => void;
type Kick = (canvasId: string, reason: 'deleted' | 'removed', userId?: string) => void;

interface CanvasParams {
  canvasId: string;
}

/**
 * Canvas-scoped routes. Registered under the `/api/canvases/:canvasId` prefix;
 * a preHandler in app.ts has already verified membership and set `req.memberRole`.
 */
export function registerRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  broadcast: Broadcast,
  kick: Kick,
): void {
  const scoped = (req: FastifyRequest) => {
    const canvasId = (req.params as CanvasParams).canvasId;
    return { canvasId, service: serviceFor(canvasId) };
  };

  /** Viewers are read-only. */
  const requireEditor = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.memberRole === 'viewer') {
      reply.code(403).send({ error: 'görüntüleyici rolüyle değişiklik yapamazsınız' });
      return false;
    }
    return true;
  };
  const requireOwner = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.memberRole !== 'owner') {
      reply.code(403).send({ error: 'bu işlemi yalnızca kanvas sahibi yapabilir' });
      return false;
    }
    return true;
  };

  /** The CommitService enforces the region rule per actor (owner bypasses). */
  const actorOf = (req: FastifyRequest): Actor => ({ userId: req.user!.id, role: req.memberRole! });

  app.get('/state', async (req) => scoped(req).service.getState());

  app.get<{ Params: CanvasParams; Querystring: { limit?: string; before?: string } }>('/commits', async (req) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const before = req.query.before ? Number(req.query.before) : undefined;
    return { commits: await scoped(req).service.listCommits(limit, before) };
  });

  app.get<{ Params: CanvasParams & { seq: string } }>('/commits/:seq', async (req, reply) => {
    const commit = await scoped(req).service.getCommit(Number(req.params.seq));
    if (!commit) return reply.code(404).send({ error: 'commit bulunamadı' });
    return commit;
  });

  app.get<{ Params: CanvasParams & { seq: string } }>('/state-at/:seq', async (req, reply) => {
    const { service } = scoped(req);
    const seq = Number(req.params.seq);
    if (!Number.isInteger(seq) || seq < 0 || seq > (await service.headSeq()))
      return reply.code(404).send({ error: 'commit bulunamadı' });
    return service.stateAt(seq);
  });

  app.post<{ Params: CanvasParams; Body: { message?: string; ops: OpInput[]; baseSeq?: number; clientId?: string } }>(
    '/commit',
    async (req, reply) => {
      const { canvasId, service } = scoped(req);
      if (!requireEditor(req, reply)) return;
      try {
        const outcome = await service.commit(req.body.ops ?? [], {
          message: req.body.message || undefined,
          baseSeq: req.body.baseSeq,
          authorId: req.user?.id ?? null,
          actor: actorOf(req),
        });
        const clientId = req.body.clientId ?? null;
        if (outcome.result === 'committed') {
          broadcast(canvasId, { type: 'commit', commit: outcome.commit, state: outcome.state, clientId });
        } else {
          broadcast(canvasId, { type: 'branch_created', branch: outcome.branch, clientId });
        }
        return outcome;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  /**
   * Yerleşik Gemini ajanı: doğal dil komutunu yorumlar, gerekiyorsa tek commit atar.
   * Üyelik preHandler'dan geçen herkes her kanvasta anında kullanabilir; actor istek sahibi
   * olduğundan rol/bölge kuralları normal commit'lerle aynıdır.
   */
  app.post<{ Params: CanvasParams; Body: { prompt?: string; detail?: string; selectedIds?: string[] } }>('/agent', async (req, reply) => {
    const { canvasId, service } = scoped(req);
    const prompt = (req.body?.prompt ?? '').trim();
    if (!prompt) return reply.code(400).send({ error: 'prompt gerekli' });
    if (!geminiConfigured())
      return reply.code(503).send({ error: 'ajan yapılandırılmamış: sunucuda GEMINI_API_KEY tanımlı değil' });
    const canvas = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { name: true } });
    let result;
    try {
      result = await runAgent({
        prisma, service, canvasId, canvasName: canvas?.name ?? '', prompt, actor: actorOf(req),
        detail: req.body?.detail === 'detailed' ? 'detailed' : 'proto',
        selectedIds: Array.isArray(req.body?.selectedIds)
          ? req.body.selectedIds.filter((x): x is string => typeof x === 'string').slice(0, 50)
          : [],
      });
    } catch (err) {
      return reply.code(502).send({ error: `ajan çalıştırılamadı: ${err instanceof Error ? err.message : String(err)}` });
    }
    if (result.outcome?.result === 'committed') {
      broadcast(canvasId, { type: 'commit', commit: result.outcome.commit, state: result.outcome.state, clientId: null });
    } else if (result.outcome?.result === 'branched') {
      broadcast(canvasId, { type: 'branch_created', branch: result.outcome.branch, clientId: null });
    }
    const { outcome: _outcome, ...res } = result;
    return res;
  });

  app.post<{ Params: CanvasParams & { seq: string }; Body: { clientId?: string } | null }>(
    '/commits/:seq/revert',
    async (req, reply) => {
      const { canvasId, service } = scoped(req);
      if (!requireEditor(req, reply)) return;
      try {
        const result = await service.revert(Number(req.params.seq), req.user?.id ?? null, actorOf(req));
        broadcast(canvasId, { type: 'commit', ...result, clientId: req.body?.clientId ?? null });
        return result;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.post<{ Params: CanvasParams & { seq: string }; Body: { clientId?: string } | null }>(
    '/commits/:seq/restore',
    async (req, reply) => {
      const { canvasId, service } = scoped(req);
      if (!requireEditor(req, reply)) return;
      try {
        const result = await service.restore(Number(req.params.seq), req.user?.id ?? null, actorOf(req));
        broadcast(canvasId, { type: 'commit', ...result, clientId: req.body?.clientId ?? null });
        return result;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.get('/branches', async (req) => ({ branches: await scoped(req).service.listBranches('open') }));

  app.get<{ Params: CanvasParams & { id: string } }>('/branches/:id/state', async (req, reply) => {
    try {
      return await scoped(req).service.branchState(req.params.id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get<{ Params: CanvasParams & { id: string } }>('/branches/:id/commits', async (req) => {
    return { commits: await scoped(req).service.listCommits(100, undefined, req.params.id) };
  });

  app.post<{ Params: CanvasParams & { id: string } }>('/branches/:id/merge', async (req, reply) => {
    const { canvasId, service } = scoped(req);
    if (!requireEditor(req, reply)) return;
    try {
      const result = await service.mergeBranch(req.params.id, req.user?.id ?? null, actorOf(req));
      broadcast(canvasId, { type: 'branch_resolved', branchId: req.params.id, status: 'merged', ...result });
      return result;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: CanvasParams & { id: string } }>('/branches/:id/discard', async (req, reply) => {
    const { canvasId, service } = scoped(req);
    if (!requireEditor(req, reply)) return;
    try {
      const branch = await service.discardBranch(req.params.id);
      broadcast(canvasId, { type: 'branch_resolved', branchId: req.params.id, status: 'discarded' });
      return { branch };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Editors and the owner can mint invite links. */
  app.post<{ Params: CanvasParams }>('/invites', async (req, reply) => {
    if (!requireEditor(req, reply)) return;
    return { token: await createInvite(prisma, scoped(req).canvasId, req.user!.id) };
  });

  // ---------- Members & roles (owner-managed) ----------

  app.get<{ Params: CanvasParams }>('/members', async (req) => ({
    members: await listMembers(prisma, scoped(req).canvasId),
  }));

  app.patch<{ Params: CanvasParams & { userId: string }; Body: { role?: string } }>(
    '/members/:userId',
    async (req, reply) => {
      if (!requireOwner(req, reply)) return;
      const role = req.body?.role;
      if (role !== 'editor' && role !== 'viewer')
        return reply.code(400).send({ error: "rol 'editor' veya 'viewer' olmalı" });
      const { canvasId } = scoped(req);
      const result = await setMemberRole(prisma, canvasId, req.params.userId, role);
      if ('error' in result) return reply.code(400).send(result);
      broadcast(canvasId, { type: 'members', members: result });
      return { members: result };
    },
  );

  app.delete<{ Params: CanvasParams & { userId: string } }>('/members/:userId', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const { canvasId } = scoped(req);
    const result = await removeMember(prisma, canvasId, req.params.userId);
    if ('error' in result) return reply.code(400).send(result);
    kick(canvasId, 'removed', req.params.userId);
    broadcast(canvasId, { type: 'members', members: result });
    return { members: result };
  });

  /** Owner deletes the whole canvas; connected clients are dropped to the dashboard. */
  app.delete<{ Params: CanvasParams }>('/', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const { canvasId } = scoped(req);
    kick(canvasId, 'deleted');
    await deleteCanvas(prisma, canvasId);
    return { ok: true };
  });

  // ---------- Regions (owner-defined edit zones) ----------

  app.get<{ Params: CanvasParams }>('/regions', async (req) => ({
    regions: await listRegions(prisma, scoped(req).canvasId),
  }));

  type RegionBody = { name?: string; x?: number; y?: number; width?: number; height?: number; color?: string; description?: string; aiAllowed?: boolean };
  /** Present rect fields must be finite numbers (width/height positive); `required` demands all four. */
  const rectError = (b: RegionBody | undefined, required: boolean): string | null => {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const v = b?.[key];
      if (v === undefined) {
        if (required) return 'geçersiz bölge alanı';
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v) || ((key === 'width' || key === 'height') && v <= 0))
        return 'geçersiz bölge alanı';
    }
    return null;
  };

  app.post<{ Params: CanvasParams; Body: RegionBody }>('/regions', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const name = (req.body?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'bölge adı gerekli' });
    const rectErr = rectError(req.body, true);
    if (rectErr) return reply.code(400).send({ error: rectErr });
    const { canvasId } = scoped(req);
    const region = await createRegion(prisma, canvasId, {
      name, x: req.body.x!, y: req.body.y!, width: req.body.width!, height: req.body.height!,
      ...(req.body.color ? { color: req.body.color } : {}),
      ...(req.body.description !== undefined ? { description: req.body.description.slice(0, 500) } : {}),
      ...(req.body.aiAllowed !== undefined ? { aiAllowed: req.body.aiAllowed } : {}),
    });
    broadcast(canvasId, { type: 'regions', regions: await listRegions(prisma, canvasId) });
    return { region };
  });

  app.patch<{ Params: CanvasParams & { id: string }; Body: RegionBody }>('/regions/:id', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const { canvasId } = scoped(req);
    const rectErr = rectError(req.body, false);
    if (rectErr) return reply.code(400).send({ error: rectErr });
    const data: RegionBody = {};
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (req.body?.[key] !== undefined) data[key] = req.body[key];
    }
    if (req.body?.name !== undefined) {
      const name = req.body.name.trim();
      if (!name) return reply.code(400).send({ error: 'bölge adı gerekli' });
      data.name = name;
    }
    if (req.body?.color !== undefined) data.color = req.body.color;
    if (req.body?.description !== undefined) data.description = req.body.description.slice(0, 500);
    if (req.body?.aiAllowed !== undefined) data.aiAllowed = !!req.body.aiAllowed;
    const region = await updateRegion(prisma, canvasId, req.params.id, data);
    if (!region) return reply.code(404).send({ error: 'bölge bulunamadı' });
    broadcast(canvasId, { type: 'regions', regions: await listRegions(prisma, canvasId) });
    return { region };
  });

  app.delete<{ Params: CanvasParams & { id: string } }>('/regions/:id', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const { canvasId } = scoped(req);
    if (!(await deleteRegion(prisma, canvasId, req.params.id)))
      return reply.code(404).send({ error: 'bölge bulunamadı' });
    broadcast(canvasId, { type: 'regions', regions: await listRegions(prisma, canvasId) });
    return { ok: true };
  });

  app.put<{ Params: CanvasParams & { id: string }; Body: { userIds?: string[]; roleIds?: string[] } }>(
    '/regions/:id/members',
    async (req, reply) => {
      if (!requireOwner(req, reply)) return;
      const { canvasId } = scoped(req);
      const region = await setRegionMembers(
        prisma, canvasId, req.params.id, req.body?.userIds ?? [], req.body?.roleIds,
      );
      if (!region) return reply.code(404).send({ error: 'bölge bulunamadı' });
      broadcast(canvasId, { type: 'regions', regions: await listRegions(prisma, canvasId) });
      return { region };
    },
  );

  // ---------- Rol bazlı kanvas erişimi (grup kanvasları) ----------

  app.get<{ Params: CanvasParams }>('/role-access', async (req) => {
    const { canvasId } = scoped(req);
    const rows = await prisma.canvasRoleAccess.findMany({ where: { canvasId } });
    return { access: rows.map((r) => ({ roleId: r.roleId, access: r.access })) };
  });

  /** Kanvas sahibi ya da grupta rol yönetme yetkisi olanlar ayarlayabilir. */
  app.put<{ Params: CanvasParams; Body: { roleId?: string; access?: string | null } }>(
    '/role-access',
    async (req, reply) => {
      const { canvasId } = scoped(req);
      if (req.memberRole !== 'owner') {
        const canvas = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { groupId: true } });
        const perms = canvas?.groupId ? await memberPermissions(prisma, canvas.groupId, req.user!.id) : null;
        if (!perms?.canManageRoles)
          return reply.code(403).send({ error: 'bu işlem için rol yönetme yetkisi gerekli' });
      }
      const roleId = req.body?.roleId;
      const access = req.body?.access ?? null;
      if (!roleId) return reply.code(400).send({ error: 'roleId gerekli' });
      if (access !== null && access !== 'none' && access !== 'view' && access !== 'edit')
        return reply.code(400).send({ error: "access 'none', 'view', 'edit' ya da null olmalı" });
      const err = await setCanvasRoleAccess(prisma, canvasId, roleId, access);
      if (err) return reply.code(400).send(err);
      return { ok: true };
    },
  );
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof RegionError) return reply.code(403).send({ error: err.message });
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
  throw err;
}
