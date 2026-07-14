import type { FastifyInstance } from 'fastify';
import type { PrismaClient, User } from '@prisma/client';
import { createSession, hashPassword, resolveSession, SESSION_COOKIE, sessionToken, verifyPassword, setSessionCookie } from './auth.js';

interface Credentials {
  username?: string;
  password?: string;
  email?: string;
  displayName?: string;
}

function toAuthUser(user: User) {
  return {
    id: user.id, username: user.username, email: user.email,
    displayName: user.displayName, avatarUrl: user.avatarUrl,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerAuthRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.post<{ Body: Credentials }>('/api/auth/register', async (req, reply) => {
    const username = (req.body.username ?? '').trim();
    const password = req.body.password ?? '';
    const email = (req.body.email ?? '').trim().toLowerCase();
    const displayName = (req.body.displayName ?? '').trim();
    if (username.length < 2 || username.startsWith('__'))
      return reply.code(400).send({ error: 'kullanıcı adı en az 2 karakter olmalı' });
    if (password.length < 4) return reply.code(400).send({ error: 'şifre en az 4 karakter olmalı' });
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'geçerli bir e-posta adresi girin' });
    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) return reply.code(409).send({ error: 'bu kullanıcı adı alınmış' });
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) return reply.code(409).send({ error: 'bu e-posta adresi zaten kayıtlı' });
    const user = await prisma.user.create({
      data: { username, email, displayName: displayName || null, passwordHash: await hashPassword(password) },
    });
    setSessionCookie(reply, await createSession(prisma, user.id));
    return { user: toAuthUser(user) };
  });

  app.post<{ Body: Credentials }>('/api/auth/login', async (req, reply) => {
    const username = (req.body.username ?? '').trim();
    const password = req.body.password ?? '';
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      return reply.code(401).send({ error: 'kullanıcı adı veya şifre hatalı' });
    setSessionCookie(reply, await createSession(prisma, user.id));
    return { user: toAuthUser(user) };
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

  /** Password change (dashboard user settings). /api/auth/* skips the global hook, so resolve the session here. */
  app.post<{ Body: { current?: string; next?: string } }>('/api/auth/password', async (req, reply) => {
    const user = await resolveSession(prisma, sessionToken(req));
    if (!user) return reply.code(401).send({ error: 'oturum yok' });
    const next = req.body?.next ?? '';
    if (next.length < 4) return reply.code(400).send({ error: 'yeni şifre en az 4 karakter olmalı' });
    const row = await prisma.user.findUnique({ where: { id: user.id } });
    if (!row) return reply.code(401).send({ error: 'oturum yok' });
    if (!row.passwordHash)
      return reply.code(400).send({ error: 'bu hesapta şifre yok — Google ile giriş yapıyorsunuz' });
    if (!(await verifyPassword(req.body?.current ?? '', row.passwordHash)))
      return reply.code(401).send({ error: 'mevcut şifre hatalı' });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
    // Other sessions are logged out; the current one stays.
    await prisma.session.deleteMany({ where: { userId: user.id, id: { not: sessionToken(req)! } } });
    return { ok: true };
  });

  /** Display name + avatar URL (dashboard user settings). */
  app.patch<{ Body: { displayName?: string | null; avatarUrl?: string | null } }>(
    '/api/auth/profile',
    async (req, reply) => {
      const user = await resolveSession(prisma, sessionToken(req));
      if (!user) return reply.code(401).send({ error: 'oturum yok' });
      const data: { displayName?: string | null; avatarUrl?: string | null } = {};
      if (req.body?.displayName !== undefined) {
        const displayName = (req.body.displayName ?? '').trim();
        if (displayName.length > 60) return reply.code(400).send({ error: 'görünen ad en fazla 60 karakter olabilir' });
        data.displayName = displayName || null;
      }
      if (req.body?.avatarUrl !== undefined) {
        const avatarUrl = (req.body.avatarUrl ?? '').trim();
        if (avatarUrl.length > 2000) return reply.code(400).send({ error: 'profil fotoğrafı URL\'si çok uzun' });
        if (avatarUrl && !/^https?:\/\//.test(avatarUrl))
          return reply.code(400).send({ error: 'profil fotoğrafı için geçerli bir http(s) URL girin' });
        data.avatarUrl = avatarUrl || null;
      }
      const updated = await prisma.user.update({ where: { id: user.id }, data });
      return { user: toAuthUser(updated) };
    },
  );
}
