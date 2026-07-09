import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { OpInput, ServerMessage } from '@treemapper/shared';
import { ConflictError, ValidationError } from './commitService.js';
import { createInvite, type ServiceFor } from './canvasService.js';

type Broadcast = (canvasId: string, msg: ServerMessage) => void;

interface CanvasParams {
  canvasId: string;
}

/**
 * Canvas-scoped routes. Registered under the `/api/canvases/:canvasId` prefix;
 * a preHandler in app.ts has already verified the requester is a member.
 */
export function registerRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  broadcast: Broadcast,
): void {
  const scoped = (req: FastifyRequest) => {
    const canvasId = (req.params as CanvasParams).canvasId;
    return { canvasId, service: serviceFor(canvasId) };
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
    try {
      const branch = await service.discardBranch(req.params.id);
      broadcast(canvasId, { type: 'branch_resolved', branchId: req.params.id, status: 'discarded' });
      return { branch };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Any member can mint an invite link for this canvas. */
  app.post<{ Params: CanvasParams }>('/invites', async (req) => {
    return { token: await createInvite(prisma, scoped(req).canvasId, req.user!.id) };
  });
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
  throw err;
}
