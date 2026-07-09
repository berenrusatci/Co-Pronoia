import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { OpInput, ServerMessage } from '@treemapper/shared';
import { ConflictError, ValidationError } from './commitService.js';
import {
  createInvite, createRegion, deleteCanvas, deleteRegion, listMembers, listRegions,
  removeMember, setMemberRole, setRegionMembers, updateRegion, type ServiceFor,
} from './canvasService.js';
import { regionViolation } from './regionGuard.js';

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
      // Region rule: non-owners may only touch nodes inside regions they belong to.
      if (req.memberRole !== 'owner') {
        const regions = await listRegions(prisma, canvasId);
        const violation = regionViolation(await service.getState(), regions, req.user!.id, req.body.ops ?? []);
        if (violation) return reply.code(403).send({ error: violation });
      }
      try {
        const outcome = await service.commit(req.body.ops ?? [], {
          message: req.body.message || undefined,
          baseSeq: req.body.baseSeq,
          authorId: req.user?.id ?? null,
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

  app.post<{ Params: CanvasParams & { seq: string }; Body: { clientId?: string } | null }>(
    '/commits/:seq/revert',
    async (req, reply) => {
      const { canvasId, service } = scoped(req);
      if (!requireEditor(req, reply)) return;
      try {
        const result = await service.revert(Number(req.params.seq), req.user?.id ?? null);
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
        const result = await service.restore(Number(req.params.seq), req.user?.id ?? null);
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
      const result = await service.mergeBranch(req.params.id, req.user?.id ?? null);
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

  type RegionBody = { name?: string; x?: number; y?: number; width?: number; height?: number; color?: string };
  const badRect = (b: RegionBody) =>
    [b.x, b.y, b.width, b.height].some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
    b.width! <= 0 || b.height! <= 0;

  app.post<{ Params: CanvasParams; Body: RegionBody }>('/regions', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const name = (req.body?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'bölge adı gerekli' });
    if (badRect(req.body)) return reply.code(400).send({ error: 'geçersiz bölge alanı' });
    const { canvasId } = scoped(req);
    const region = await createRegion(prisma, canvasId, {
      name, x: req.body.x!, y: req.body.y!, width: req.body.width!, height: req.body.height!,
      ...(req.body.color ? { color: req.body.color } : {}),
    });
    broadcast(canvasId, { type: 'regions', regions: await listRegions(prisma, canvasId) });
    return { region };
  });

  app.patch<{ Params: CanvasParams & { id: string }; Body: RegionBody }>('/regions/:id', async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    const { canvasId } = scoped(req);
    const data: RegionBody = {};
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const v = req.body?.[key];
      if (v !== undefined) {
        if (typeof v !== 'number' || !Number.isFinite(v) || ((key === 'width' || key === 'height') && v <= 0))
          return reply.code(400).send({ error: 'geçersiz bölge alanı' });
        data[key] = v;
      }
    }
    if (req.body?.name !== undefined) {
      const name = req.body.name.trim();
      if (!name) return reply.code(400).send({ error: 'bölge adı gerekli' });
      data.name = name;
    }
    if (req.body?.color !== undefined) data.color = req.body.color;
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

  app.put<{ Params: CanvasParams & { id: string }; Body: { userIds?: string[] } }>(
    '/regions/:id/members',
    async (req, reply) => {
      if (!requireOwner(req, reply)) return;
      const { canvasId } = scoped(req);
      const region = await setRegionMembers(prisma, canvasId, req.params.id, req.body?.userIds ?? []);
      if (!region) return reply.code(404).send({ error: 'bölge bulunamadı' });
      broadcast(canvasId, { type: 'regions', regions: await listRegions(prisma, canvasId) });
      return { region };
    },
  );
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
  throw err;
}
