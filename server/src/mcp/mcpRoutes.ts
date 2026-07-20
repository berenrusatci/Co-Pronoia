import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ServerMessage } from '@treemapper/shared';
import type { ServiceFor } from '../canvasService.js';
import type { CanvasEvents } from '../canvasEvents.js';
import { resolveAgentToken } from '../agentRoleService.js';
import { buildCoPronoiaServer } from './mcpServer.js';

type Broadcast = (canvasId: string, msg: ServerMessage) => void;

/**
 * Co-Pronoia MCP ucu. Oturum çerezi yerine `Authorization: Bearer tma_...` ajan anahtarıyla
 * korunur (global auth hook'u app.ts'te bu yolu muaf tutar). Transport STATELESS kuruludur:
 * her POST için taze McpServer + transport — oturum defteri yok, süpervizör araçları token
 * rolüne göre koşullu kaydedilir. Fastify gövdeyi zaten parse ettiğinden handleRequest'e
 * üçüncü argüman olarak verilir; yanıtı SDK yazsın diye reply.hijack() yapılır.
 */
export function registerMcpRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  broadcast: Broadcast,
  events: CanvasEvents,
): void {
  app.post('/api/mcp', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    const raw = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    const token = raw ? await resolveAgentToken(prisma, raw) : null;
    if (!token) return reply.code(401).send({ error: 'geçersiz ya da iptal edilmiş ajan anahtarı' });
    if (token.canvas.type !== 'co-pronoia')
      return reply.code(403).send({ error: 'bu anahtarın kanvası artık co-pronoia türünde değil' });

    const server = buildCoPronoiaServer({ prisma, serviceFor, broadcast, events, token });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Stateless mod: GET (sunucudan SSE akışı) ve DELETE (oturum kapatma) desteklenmez.
  const notAllowed = { error: 'yalnızca POST desteklenir (stateless MCP)' };
  app.get('/api/mcp', async (_req, reply) => reply.code(405).send(notAllowed));
  app.delete('/api/mcp', async (_req, reply) => reply.code(405).send(notAllowed));
}
