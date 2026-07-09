import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createSession, hashPassword, resolveSession, SESSION_COOKIE, sessionToken, verifyPassword, setSessionCookie } from './auth.js';

interface Credentials {
  username?: string;
  password?: string;
}

export function registerAuthRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.post<{ Body: Credentials }>('/api/auth/register', async (req, reply) => {
    const username = (req.body.username ?? '').trim();
    const password = req.body.password ?? '';
    if (username.length < 2 || username.startsWith('__'))
      return reply.code(400).send({ error: 'kullanıcı adı en az 2 karakter olmalı' });
    if (password.length < 4) return reply.code(400).send({ error: 'şifre en az 4 karakter olmalı' });
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return reply.code(409).send({ error: 'bu kullanıcı adı alınmış' });
    const user = await prisma.user.create({ data: { username, passwordHash: await hashPassword(password) } });
    setSessionCookie(reply, await createSession(prisma, user.id));
    return { user: { id: user.id, username: user.username } };
  });

  app.post<{ Body: Credentials }>('/api/auth/login', async (req, reply) => {
    const username = (req.body.username ?? '').trim();
    const password = req.body.password ?? '';
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      return reply.code(401).send({ error: 'kullanıcı adı veya şifre hatalı' });
    setSessionCookie(reply, await createSession(prisma, user.id));
    return { user: { id: user.id, username: user.username } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = sessionToken(req);
    if (token) await prisma.session.deleteMany({ where: { id: token } });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = await resolveSession(prisma, sessionToken(req));
    if (!user) return reply.code(401).send({ error: 'oturum yok' });
    return { user };
  });
}
