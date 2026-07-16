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

  it('prod + SMTP yoksa register 503 döner', async () => {
    const { app } = await freshApp();
    const prevEnv = process.env.NODE_ENV;
    const prevHost = process.env.SMTP_HOST;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SMTP_HOST;
      const res = await register(app, { username: 'hakan', password: 'sifre123', email: 'hakan@x.com' });
      expect(res.statusCode).toBe(503);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = prevHost;
    }
  });
});
