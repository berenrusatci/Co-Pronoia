import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createSession, generateCode, hashPassword, resolveSession, SESSION_COOKIE, sessionToken, verifyPassword, setSessionCookie } from './auth.js';
import { MIN_PASSWORD_LENGTH } from '@co-pronoia/shared';
import { defaultEmailSender, emailConfigured, isProd, type EmailSender } from './email.js';
import { trustProxy } from './mode.js';
import { registerProfileRoute, toAuthUser } from './identityRoutes.js';

interface Credentials {
  username?: string;
  password?: string;
  email?: string;
  displayName?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Doğrulama kodunun geçerlilik süresi ve izin verilen hatalı deneme sayısı. */
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

/**
 * Login kaba kuvvet kapısı (`routes.ts`teki `agentRateLimited` deseninin eşi; süreç ömürlü,
 * DB'ye hiçbir şey yazılmaz — projenin "kullanıcı davranışına dair kalıcı veri tutmuyoruz"
 * duruşu korunur). E-posta kodunda zaten 5 deneme sınırı vardı ama giriş sınırsızdı: tek uç
 * üzerinden sözlük saldırısı hiçbir dirençle karşılaşmıyordu.
 *
 * YALNIZ BAŞARISIZ denemeler sayılır ve başarılı girişte sayaç sıfırlanır; şifresini yanlış
 * yazan gerçek kullanıcı kilitlenmez. Pencere 15 dk: 60 sn'lik bir pencere kaba kuvvete
 * anlamlı bir maliyet yüklemez.
 */
const LOGIN_WINDOW_MS = 15 * 60_000;
/** Kullanıcı adı başına 15 dakikada en çok bu kadar BAŞARISIZ giriş. */
const LOGIN_MAX_USER = 10;
/** Kaynak adres başına 15 dakikada en çok bu kadar başarısız giriş (kullanıcı adı taraması). */
const LOGIN_MAX_IP = 30;

/**
 * E-posta gönderen uçlar (kayıt, kodu tekrar gönder) için ayrı kapı. Login kovasından farklı
 * olarak BAŞARILI istekleri de sayar: burada pahalı olan şey zaten başarının kendisi — her
 * istek bir e-posta (SMTP maliyeti + alıcının gelen kutusu) ve kayıtta bir de scrypt hash'i
 * doğuruyor. Anahtar e-posta adresi; `trustProxy` açıksa ayrıca kaynak adres.
 */
const MAIL_WINDOW_MS = 60 * 60_000;
/** E-posta adresi başına saatte en çok bu kadar doğrulama postası. */
const MAIL_MAX_ADDRESS = 5;
/** Kaynak adres başına saatte en çok bu kadar (yalnız `trustProxy` açıkken uygulanır). */
const MAIL_MAX_IP = 20;

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
  /**
   * Oran sınırı sayaçları app örneğine BAĞLI (modül düzeyinde değil): tek süreçte birden çok
   * app ayağa kalkabiliyor (testler her senaryo için taze bir buildApp kurar) ve paylaşılan
   * bir sayaç, ayrı kurulumların kotasını birbirine karıştırırdı. Üretimde süreç başına tek
   * app olduğu için davranış aynı: süreç ömürlü, DB'ye hiçbir şey yazılmıyor.
   */
  const loginFails = new Map<string, number[]>();

  /** Pencere içindeki başarısız deneme sayısı (eskiyenleri budar). */
  function loginFailCount(key: string): number {
    const now = Date.now();
    const recent = (loginFails.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    if (recent.length === 0) loginFails.delete(key);
    else loginFails.set(key, recent);
    return recent.length;
  }
  function recordLoginFail(key: string): void {
    const now = Date.now();
    loginFails.set(key, [...(loginFails.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS), now]);
    // Harita süreç ömrü boyunca yaşar; boşalan anahtarları temizle ki sızıntı olmasın.
    if (loginFails.size > 5_000) {
      for (const [k, v] of loginFails) if (v.every((t) => now - t >= LOGIN_WINDOW_MS)) loginFails.delete(k);
    }
  }
  /**
   * İstek sahibinin adresi — YALNIZ `trustProxy` açıkken anlamlı.
   *
   * Ters proxy arkasında (Render) `trustProxy` kapalıyken `req.ip` her kullanıcı için aynı
   * değeri (proxy'nin adresini) döndürür; o adrese kova açmak "bir saldırganın 30 hatalı
   * denemesi bütün siteyi 15 dakika kilitler" demektir. Proxy yokken `trustProxy` açmak ise
   * tersine `X-Forwarded-For`u istemciye bırakır ve kovayı atlatılabilir kılar. İki halde de
   * doğru cevap kovayı hiç açmamak: `null` dönüşü çağıranlara "IP ile sınırlama" der.
   */
  function clientIp(req: { ip: string }): string | null {
    return trustProxy() ? req.ip : null;
  }

  const mailSends = new Map<string, number[]>();

  /** Kotayı tüketir ve aşıldıysa false döner (sayaç yalnız izin verilen istekte artar). */
  function claimMailSend(keys: [key: string, max: number][]): boolean {
    const now = Date.now();
    const recent = keys.map(([key, max]) => {
      const list = (mailSends.get(key) ?? []).filter((t) => now - t < MAIL_WINDOW_MS);
      return { key, max, list };
    });
    if (recent.some(({ list, max }) => list.length >= max)) return false;
    for (const { key, list } of recent) mailSends.set(key, [...list, now]);
    if (mailSends.size > 5_000) {
      for (const [k, v] of mailSends) if (v.every((t) => now - t >= MAIL_WINDOW_MS)) mailSends.delete(k);
    }
    return true;
  }
  function mailKeys(email: string, ip: string | null): [string, number][] {
    const keys: [string, number][] = [[`e:${email}`, MAIL_MAX_ADDRESS]];
    if (ip) keys.push([`i:${ip}`, MAIL_MAX_IP]);
    return keys;
  }

  // Bu modül YALNIZ bulut modunda register edilir (app.ts'teki kapı). Yerel modun
  // kimlik yüzeyi `identityRoutes.ts`teki registerLocalIdentityRoutes'tur ve bu dosya
  // yerel imaj bundle'ına hiç girmez.
  //
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
    if (password.length < MIN_PASSWORD_LENGTH)
      return reply.code(400).send({ error: `şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı` });
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'geçerli bir e-posta adresi girin' });
    if (!emailConfigured() && isProd())
      return reply.code(503).send({ error: 'e-posta doğrulama yapılandırılmamış' });
    // Kapı pahalı işten (scrypt + SMTP) ÖNCE — login kapısındaki sıranın eşi.
    if (!claimMailSend(mailKeys(email, clientIp(req))))
      return reply.code(429).send({ error: 'çok fazla doğrulama isteği — bir süre sonra tekrar deneyin' });
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
    // Kota, bekleyen kayıt olup olmadığına BAKMADAN tüketilir: aksi halde 429'un kendisi
    // "bu adres bekliyor" sinyali olur ve enumeration sözleşmesi kapıdan sızar.
    if (!claimMailSend(mailKeys(email, clientIp(req))))
      return reply.code(429).send({ error: 'çok fazla doğrulama isteği — bir süre sonra tekrar deneyin' });
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
    // Kapı, parola doğrulamasından ÖNCE: reddedilen istek scrypt'e hiç ulaşmaz (ajan oran
    // sınırındaki "önce kapı, sonra pahalı iş" sırasının eşi; scrypt bilerek yavaştır ve
    // sınırsız denemede kendisi bir CPU tüketim yüzeyine dönüşür).
    // IP kovası yalnız `trustProxy` açıkken; kapalıyken `req.ip` ters proxy arkasında herkes
    // için aynı değeri döndürür ve tek saldırgan bütün siteyi kilitler (bkz. `clientIp`).
    const ip = clientIp(req);
    if (loginFailCount(`u:${username}`) >= LOGIN_MAX_USER || (ip && loginFailCount(`i:${ip}`) >= LOGIN_MAX_IP))
      return reply.code(429).send({ error: 'çok fazla başarısız giriş denemesi — birkaç dakika sonra tekrar deneyin' });

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      recordLoginFail(`u:${username}`);
      if (ip) recordLoginFail(`i:${ip}`);
      return reply.code(401).send({ error: 'kullanıcı adı veya şifre hatalı' });
    }
    loginFails.delete(`u:${username}`); // başarılı giriş sayacı sıfırlar
    setSessionCookie(reply, await createSession(prisma, user.id));
    return { user: toAuthUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = sessionToken(req);
    if (token) await prisma.session.deleteMany({ where: { id: token } });
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' });
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
    if (next.length < MIN_PASSWORD_LENGTH)
      return reply.code(400).send({ error: `yeni şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı` });
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

  registerProfileRoute(app, prisma, (req) => resolveSession(prisma, sessionToken(req)));
}
