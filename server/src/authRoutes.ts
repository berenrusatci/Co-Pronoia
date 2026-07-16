import type { FastifyInstance } from 'fastify';
import type { PrismaClient, User } from '@prisma/client';
import { createSession, generateCode, hashPassword, resolveSession, SESSION_COOKIE, sessionToken, verifyPassword, setSessionCookie } from './auth.js';
import { defaultEmailSender, emailConfigured, isProd, type EmailSender } from './email.js';

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

/** Doğrulama kodunun geçerlilik süresi ve izin verilen hatalı deneme sayısı. */
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

function verificationEmail(code: string): { subject: string; text: string } {
  return {
    subject: 'Co-pronoia doğrulama kodunuz',
    text: `Co-pronoia kaydınızı tamamlamak için doğrulama kodunuz: ${code}\n\nBu kod 10 dakika içinde geçerliliğini yitirecek. Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.`,
  };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  emailSender: EmailSender = defaultEmailSender,
): void {
  // Kayıt: gerçek User oluşturmaz. Doğrulama kodunu e-postayla gönderir ve
  // bekleyen kaydı EmailVerification tablosuna yazar. Kullanıcı verify-email ile
  // kodu onaylayınca hesap oluşur (aşağıya bak).
  app.post<{ Body: Credentials }>('/api/auth/register', async (req, reply) => {
    const username = (req.body.username ?? '').trim();
    const password = req.body.password ?? '';
    const email = (req.body.email ?? '').trim().toLowerCase();
    const displayName = (req.body.displayName ?? '').trim();
    if (username.length < 2 || username.startsWith('__'))
      return reply.code(400).send({ error: 'kullanıcı adı en az 2 karakter olmalı' });
    if (password.length < 4) return reply.code(400).send({ error: 'şifre en az 4 karakter olmalı' });
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'geçerli bir e-posta adresi girin' });
    if (!emailConfigured() && isProd())
      return reply.code(503).send({ error: 'e-posta doğrulama yapılandırılmamış' });
    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) return reply.code(409).send({ error: 'bu kullanıcı adı alınmış' });
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) return reply.code(409).send({ error: 'bu e-posta adresi zaten kayıtlı' });

    const code = generateCode();
    const data = {
      username,
      passwordHash: await hashPassword(password),
      displayName: displayName || null,
      codeHash: await hashPassword(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      attempts: 0,
    };
    // Aynı e-postayla tekrar kayıt: bekleyen kaydı tazele (yeni kod/şifre/kullanıcı adı).
    await prisma.emailVerification.upsert({ where: { email }, create: { email, ...data }, update: data });
    try {
      await emailSender({ to: email, ...verificationEmail(code) });
    } catch (err) {
      req.log.error({ err }, 'doğrulama e-postası gönderilemedi');
      return reply.code(502).send({ error: 'doğrulama e-postası gönderilemedi, daha sonra tekrar deneyin' });
    }
    return { pending: true, email };
  });

  // Doğrulama: kodu onaylar, gerçek User'ı oluşturur ve oturum açar.
  app.post<{ Body: { email?: string; code?: string } }>('/api/auth/verify-email', async (req, reply) => {
    const email = (req.body.email ?? '').trim().toLowerCase();
    const code = (req.body.code ?? '').trim();
    const pending = await prisma.emailVerification.findUnique({ where: { email } });
    if (!pending) return reply.code(400).send({ error: 'doğrulama isteği bulunamadı, yeniden kayıt olun' });
    if (pending.expiresAt < new Date()) {
      await prisma.emailVerification.delete({ where: { email } });
      return reply.code(400).send({ error: 'kodun süresi doldu, yeniden kayıt olun' });
    }
    if (pending.attempts >= MAX_ATTEMPTS) {
      await prisma.emailVerification.delete({ where: { email } });
      return reply.code(400).send({ error: 'çok fazla hatalı deneme, yeniden kayıt olun' });
    }
    if (!(await verifyPassword(code, pending.codeHash))) {
      await prisma.emailVerification.update({ where: { email }, data: { attempts: { increment: 1 } } });
      return reply.code(400).send({ error: 'kod hatalı' });
    }
    // Kod doğru: yarış durumuna karşı benzersizliği tekrar kontrol et.
    if (await prisma.user.findUnique({ where: { username: pending.username } })) {
      await prisma.emailVerification.delete({ where: { email } });
      return reply.code(409).send({ error: 'bu kullanıcı adı alınmış' });
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      await prisma.emailVerification.delete({ where: { email } });
      return reply.code(409).send({ error: 'bu e-posta adresi zaten kayıtlı' });
    }
    const user = await prisma.user.create({
      data: {
        username: pending.username,
        email,
        displayName: pending.displayName,
        passwordHash: pending.passwordHash,
      },
    });
    await prisma.emailVerification.delete({ where: { email } });
    setSessionCookie(reply, await createSession(prisma, user.id));
    return { user: toAuthUser(user) };
  });

  // Kodu tekrar gönder. E-posta sızıntısını önlemek için bekleyen kayıt olsa da
  // olmasa da { ok: true } döner.
  app.post<{ Body: { email?: string } }>('/api/auth/resend-code', async (req, reply) => {
    const email = (req.body.email ?? '').trim().toLowerCase();
    const pending = await prisma.emailVerification.findUnique({ where: { email } });
    if (pending) {
      const code = generateCode();
      await prisma.emailVerification.update({
        where: { email },
        data: { codeHash: await hashPassword(code), expiresAt: new Date(Date.now() + CODE_TTL_MS), attempts: 0 },
      });
      try {
        await emailSender({ to: email, ...verificationEmail(code) });
      } catch (err) {
        req.log.error({ err }, 'doğrulama e-postası tekrar gönderilemedi');
        // enumeration önleme sözleşmesi bozulmasın diye yine { ok: true } dönüyoruz
      }
    }
    return { ok: true };
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
