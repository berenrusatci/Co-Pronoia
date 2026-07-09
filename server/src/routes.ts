import type { FastifyInstance, FastifyReply } from 'fastify';
import type { OpInput, ServerMessage } from '@treemapper/shared';
import { CommitService, ConflictError, ValidationError } from './commitService.js';

type Broadcast = (msg: ServerMessage) => void;

export function registerRoutes(app: FastifyInstance, service: CommitService, broadcast: Broadcast): void {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/state', async () => service.getState());

  app.get<{ Querystring: { limit?: string; before?: string } }>('/api/commits', async (req) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const before = req.query.before ? Number(req.query.before) : undefined;
    return { commits: await service.listCommits(limit, before) };
  });

  app.get<{ Params: { seq: string } }>('/api/commits/:seq', async (req, reply) => {
    const commit = await service.getCommit(Number(req.params.seq));
    if (!commit) return reply.code(404).send({ error: 'commit bulunamadı' });
    return commit;
  });

  app.get<{ Params: { seq: string } }>('/api/state-at/:seq', async (req, reply) => {
    const seq = Number(req.params.seq);
    if (!Number.isInteger(seq) || seq < 0 || seq > (await service.headSeq()))
      return reply.code(404).send({ error: 'commit bulunamadı' });
    return service.stateAt(seq);
  });

  app.post<{ Body: { message?: string; ops: OpInput[]; baseSeq?: number; clientId?: string } }>(
    '/api/commit',
    async (req, reply) => {
      try {
        const outcome = await service.commit(req.body.ops ?? [], {
          message: req.body.message || undefined,
          baseSeq: req.body.baseSeq,
          authorId: req.user?.id ?? null,
        });
        const clientId = req.body.clientId ?? null;
        if (outcome.result === 'committed') {
          broadcast({ type: 'commit', commit: outcome.commit, state: outcome.state, clientId });
        } else {
          broadcast({ type: 'branch_created', branch: outcome.branch, clientId });
        }
        return outcome;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.post<{ Params: { seq: string }; Body: { clientId?: string } | null }>(
    '/api/commits/:seq/revert',
    async (req, reply) => {
      try {
        const result = await service.revert(Number(req.params.seq), req.user?.id ?? null);
        broadcast({ type: 'commit', ...result, clientId: req.body?.clientId ?? null });
        return result;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.post<{ Params: { seq: string }; Body: { clientId?: string } | null }>(
    '/api/commits/:seq/restore',
    async (req, reply) => {
      try {
        const result = await service.restore(Number(req.params.seq), req.user?.id ?? null);
        broadcast({ type: 'commit', ...result, clientId: req.body?.clientId ?? null });
        return result;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.get('/api/branches', async () => ({ branches: await service.listBranches('open') }));

  app.get<{ Params: { id: string } }>('/api/branches/:id/state', async (req, reply) => {
    try {
      return await service.branchState(req.params.id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>('/api/branches/:id/commits', async (req) => {
    return { commits: await service.listCommits(100, undefined, req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/branches/:id/merge', async (req, reply) => {
    try {
      const result = await service.mergeBranch(req.params.id, req.user?.id ?? null);
      broadcast({ type: 'branch_resolved', branchId: req.params.id, status: 'merged', ...result });
      return result;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>('/api/branches/:id/discard', async (req, reply) => {
    try {
      const branch = await service.discardBranch(req.params.id);
      broadcast({ type: 'branch_resolved', branchId: req.params.id, status: 'discarded' });
      return { branch };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
  throw err;
}
