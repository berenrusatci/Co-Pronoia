import type { FastifyInstance } from 'fastify';
import type { OpInput } from '@treemapper/shared';
import { CommitService, ConflictError, ValidationError } from './commitService.js';

export function registerRoutes(app: FastifyInstance, service: CommitService): void {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/state', async () => service.getState());

  app.get<{ Querystring: { limit?: string; before?: string } }>('/api/commits', async (req) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const before = req.query.before ? Number(req.query.before) : undefined;
    return { commits: service.listCommits(limit, before) };
  });

  app.get<{ Params: { seq: string } }>('/api/commits/:seq', async (req, reply) => {
    const commit = service.getCommit(Number(req.params.seq));
    if (!commit) return reply.code(404).send({ error: 'commit not found' });
    return commit;
  });

  app.get<{ Params: { seq: string } }>('/api/state-at/:seq', async (req, reply) => {
    const seq = Number(req.params.seq);
    if (!Number.isInteger(seq) || seq < 0 || seq > service.headSeq())
      return reply.code(404).send({ error: 'commit not found' });
    return service.stateAt(seq);
  });

  app.post<{ Body: { message?: string; ops: OpInput[] } }>('/api/commit', async (req, reply) => {
    try {
      return service.commit(req.body.ops ?? [], req.body.message || undefined);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { seq: string } }>('/api/commits/:seq/revert', async (req, reply) => {
    try {
      return service.revert(Number(req.params.seq));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { seq: string } }>('/api/commits/:seq/restore', async (req, reply) => {
    try {
      return service.restore(Number(req.params.seq));
    } catch (err) {
      return sendError(reply, err);
    }
  });
}

function sendError(reply: { code: (c: number) => { send: (b: unknown) => unknown } }, err: unknown) {
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
  throw err;
}
