import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import type { EmailMessage } from './email.js';

let db: ReturnType<typeof testDbFactory>;
beforeAll(() => {
  db = testDbFactory();
});

const opened: Array<{ prisma: { $disconnect(): Promise<void> } }> = [];
afterAll(async () => {
  for (const { prisma } of opened) await prisma.$disconnect();
  await db.cleanup();
}, 30000);

/** Yakalanan mailden 6 haneli kodu çeker. */
const codeOf = (msg: EmailMessage): string => msg.text.match(/\b(\d{6})\b/)![1];

async function freshApp() {
  const sent: EmailMessage[] = [];
  const built = await buildApp(await db.fresh(), { emailSender: async (m) => { sent.push(m); } });
  opened.push(built);
  return { ...built, sent };
}

const register = (app: Awaited<ReturnType<typeof freshApp>>['app'], body: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/api/auth/register', payload: body });

describe('kayıt e-posta doğrulama', () => {
  it('register kullanıcı oluşturmaz, kod maili gönderir', async () => {
    const { app, prisma, sent } = await freshApp();
    const res = await register(app, { username: 'ayse', password: 'sifre123', email: 'A@X.com', displayName: 'Ayşe' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pending: true, email: 'a@x.com' });
    // Oturum çerezi verilmemeli.
    expect(res.headers['set-cookie']).toBeUndefined();
    // Gerçek User henüz yok, bekleyen kayıt var.
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.emailVerification.findUnique({ where: { email: 'a@x.com' } })).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@x.com');
    expect(codeOf(sent[0])).toMatch(/^\d{6}$/);
  });

  it('doğru kodla verify hesabı oluşturup oturum açar', async () => {
    const { app, prisma, sent } = await freshApp();
    await register(app, { username: 'bora', password: 'sifre123', email: 'bora@x.com' });
    const code = codeOf(sent[0]);
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'bora@x.com', code } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('bora');
    expect(res.headers['set-cookie']).toBeDefined();
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.emailVerification.count()).toBe(0);
  });

  /**
   * Oturum çerezi HttpOnly + SameSite=Lax olmalı; `Secure` üretimde açılır (geliştirmede
   * `http://localhost` kullanıldığı için kapalı, yoksa tarayıcı çerezi hiç saklamaz).
   */
  it('oturum çerezi HttpOnly/SameSite taşır, Secure üretimde açılır', async () => {
    const { app, sent } = await freshApp();
    await register(app, { username: 'cem', password: 'sifre123', email: 'cem@x.com' });
    const login = async () => (await app.inject({
      method: 'POST', url: '/api/auth/verify-email',
      payload: { email: 'cem@x.com', code: codeOf(sent[0]) },
    })).headers['set-cookie'];

    const dev = String(await login());
    expect(dev).toMatch(/HttpOnly/i);
    expect(dev).toMatch(/SameSite=Lax/i);
    expect(dev).not.toMatch(/Secure/i);

    // Kullanıcı artık var; ikinci çerezi giriş ucundan alalım.
    process.env.SESSION_COOKIE_SECURE = '1';
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { username: 'cem', password: 'sifre123' },
      });
      expect(String(res.headers['set-cookie'])).toMatch(/Secure/i);
    } finally {
      delete process.env.SESSION_COOKIE_SECURE;
    }
  });

  it('yanlış kod 400 döner ve hesap oluşmaz', async () => {
    const { app, prisma } = await freshApp();
    await register(app, { username: 'cem', password: 'sifre123', email: 'cem@x.com' });
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'cem@x.com', code: '000000' } });
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('5 hatalı denemeden sonra bekleyen kayıt silinir', async () => {
    const { app, prisma } = await freshApp();
    await register(app, { username: 'deniz', password: 'sifre123', email: 'deniz@x.com' });
    for (let i = 0; i < 5; i++)
      await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'deniz@x.com', code: '000001' } });
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'deniz@x.com', code: '000001' } });
    expect(res.statusCode).toBe(400);
    expect(await prisma.emailVerification.count()).toBe(0);
  });

  it('login kaba kuvvet kapısı: başarısızlıklar sayılır, başarı sıfırlar, sınır aşılınca 429', async () => {
    const { app, sent } = await freshApp();
    await register(app, { username: 'kilit', password: 'dogrusifre', email: 'kilit@x.com' });
    await app.inject({
      method: 'POST', url: '/api/auth/verify-email',
      payload: { email: 'kilit@x.com', code: codeOf(sent[sent.length - 1]) },
    });
    const dene = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'kilit', password } });

    // Birkaç hatalı deneme kilitlemez ve doğru şifre sayacı sıfırlar.
    for (let i = 0; i < 3; i++) expect((await dene('yanlis')).statusCode).toBe(401);
    expect((await dene('dogrusifre')).statusCode).toBe(200);

    // Sıfırlandığı için yeniden tam sınır kadar hakkımız var; sonrasında 429.
    for (let i = 0; i < 10; i++) expect((await dene('yanlis')).statusCode).toBe(401);
    expect((await dene('yanlis')).statusCode).toBe(429);
    // Kapı parola doğrulamasından önce: doğru şifre bile bu pencerede reddedilir.
    expect((await dene('dogrusifre')).statusCode).toBe(429);
  });

  it('süresi dolmuş kod reddedilir', async () => {
    const { app, prisma, sent } = await freshApp();
    await register(app, { username: 'efe', password: 'sifre123', email: 'efe@x.com' });
    await prisma.emailVerification.update({ where: { email: 'efe@x.com' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'efe@x.com', code: codeOf(sent[0]) } });
    expect(res.statusCode).toBe(400);
    expect(await prisma.emailVerification.count()).toBe(0);
  });

  it('mevcut kullanıcı adı/e-posta register aşamasında 409', async () => {
    const { app, prisma, sent } = await freshApp();
    await register(app, { username: 'fatma', password: 'sifre123', email: 'fatma@x.com' });
    await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'fatma@x.com', code: codeOf(sent[0]) } });
    expect(await prisma.user.count()).toBe(1);
    const dupUser = await register(app, { username: 'fatma', password: 'sifre123', email: 'baska@x.com' });
    expect(dupUser.statusCode).toBe(409);
    const dupEmail = await register(app, { username: 'baska', password: 'sifre123', email: 'fatma@x.com' });
    expect(dupEmail.statusCode).toBe(409);
  });

  it('resend-code yeni kod gönderir ve önceki kodu geçersizler', async () => {
    const { app, sent } = await freshApp();
    await register(app, { username: 'gaye', password: 'sifre123', email: 'gaye@x.com' });
    const firstCode = codeOf(sent[0]);
    const rr = await app.inject({ method: 'POST', url: '/api/auth/resend-code', payload: { email: 'gaye@x.com' } });
    expect(rr.statusCode).toBe(200);
    expect(sent).toHaveLength(2);
    const secondCode = codeOf(sent[1]);
    // Eski kod artık çalışmamalı, yeni kod çalışmalı.
    const oldRes = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'gaye@x.com', code: firstCode } });
    if (firstCode !== secondCode) expect(oldRes.statusCode).toBe(400);
    const newRes = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { email: 'gaye@x.com', code: secondCode } });
    expect(newRes.statusCode).toBe(200);
  });

  it('mail gönderimi patlarsa register 502, resend-code yine 200 döner', async () => {
    const built = await buildApp(await db.fresh(), {
      emailSender: async () => { throw new Error('SMTP down'); },
    });
    opened.push(built);
    const res = await register(built.app, { username: 'irem', password: 'sifre123', email: 'irem@x.com' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('gönderilemedi');
    // enumeration önleme: resend-code gönderim hatasında bile { ok: true }
    const rr = await built.app.inject({ method: 'POST', url: '/api/auth/resend-code', payload: { email: 'irem@x.com' } });
    expect(rr.statusCode).toBe(200);
    expect(rr.json()).toEqual({ ok: true });
  });

  it('prod + SMTP yoksa register 503 döner', async () => {
    const { app } = await freshApp();
    const prevEnv = process.env.NODE_ENV;
    const prevHost = process.env.SMTP_HOST;
    const prevBrevo = process.env.BREVO_API_KEY;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SMTP_HOST;
      delete process.env.BREVO_API_KEY;
      const res = await register(app, { username: 'hakan', password: 'sifre123', email: 'hakan@x.com' });
      expect(res.statusCode).toBe(503);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = prevHost;
      if (prevBrevo === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = prevBrevo;
    }
  });
});
