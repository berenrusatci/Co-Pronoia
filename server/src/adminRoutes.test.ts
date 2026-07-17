import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { bootstrapAdmin } from './adminBootstrap.js';
import { setUserAdmin } from './adminService.js';
import { registerVerified } from './testAuth.js';
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

async function freshApp() {
  const sent: EmailMessage[] = [];
  const built = await buildApp(await db.fresh(), { emailSender: async (m) => { sent.push(m); } });
  opened.push(built);
  return { ...built, sent };
}

type App = Awaited<ReturnType<typeof freshApp>>['app'];
type Prisma = Awaited<ReturnType<typeof freshApp>>['prisma'];
type Cookies = { tm_session: string };

/** registerVerified + isAdmin terfisi: hazır yönetici oturumu döndürür. */
async function adminUser(app: App, prisma: Prisma, sent: EmailMessage[], username = 'yonetici') {
  const { cookies } = await registerVerified(app, sent, {
    username, password: 'sifre123', email: `${username}@x.com`,
  });
  await prisma.user.update({ where: { username }, data: { isAdmin: true } });
  return { cookies };
}

const createCanvas = async (app: App, cookies: Cookies, name: string, groupId?: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/canvases', payload: { name, groupId }, cookies });
  return res.json().canvas as { id: string };
};

const mintInvite = async (app: App, cookies: Cookies, canvasId: string) => {
  const res = await app.inject({ method: 'POST', url: `/api/canvases/${canvasId}/invites`, cookies });
  return res.json().token as string;
};

const acceptInvite = (app: App, cookies: Cookies, token: string) =>
  app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, cookies });

const userId = async (prisma: Prisma, username: string) =>
  (await prisma.user.findUnique({ where: { username } }))!.id;

describe('admin guard', () => {
  it('oturumsuz 401, yönetici olmayan 403, yönetici 200 alır', async () => {
    const { app, prisma, sent } = await freshApp();
    expect((await app.inject({ method: 'GET', url: '/api/admin/stats' })).statusCode).toBe(401);

    const { cookies: normal } = await registerVerified(app, sent, {
      username: 'ayse', password: 'sifre123', email: 'ayse@x.com',
    });
    const forbidden = await app.inject({ method: 'GET', url: '/api/admin/stats', cookies: normal });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error).toBe('yönetici yetkisi gerekli');

    const { cookies } = await adminUser(app, prisma, sent);
    const ok = await app.inject({ method: 'GET', url: '/api/admin/stats', cookies });
    expect(ok.statusCode).toBe(200);
    const stats = ok.json().stats;
    expect(stats.userCount).toBe(2);
    expect(stats.newUsers7d).toBe(2);
    expect(stats.activeSessionCount).toBeGreaterThanOrEqual(2);
    expect(stats.canvasCount).toBe(0);
    expect(stats.groupCount).toBe(0);
    expect(stats.commitCount).toBe(0);
  });

  it('/api/auth/me isAdmin bayrağını taşır', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await registerVerified(app, sent, {
      username: 'bora', password: 'sifre123', email: 'bora@x.com',
    });
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies })).json().user.isAdmin).toBe(false);
    await prisma.user.update({ where: { username: 'bora' }, data: { isAdmin: true } });
    // resolveSession her istekte DB okur: terfi mevcut oturuma anında yansır.
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies })).json().user.isAdmin).toBe(true);
  });
});

describe('bootstrapAdmin', () => {
  const withEnv = async (username: string | undefined, password: string | undefined, fn: () => Promise<void>) => {
    const saved = { u: process.env.ADMIN_USERNAME, p: process.env.ADMIN_PASSWORD };
    if (username === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = username;
    if (password === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = password;
    try {
      await fn();
    } finally {
      if (saved.u === undefined) delete process.env.ADMIN_USERNAME;
      else process.env.ADMIN_USERNAME = saved.u;
      if (saved.p === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = saved.p;
    }
  };

  it('env tanımsızsa atlar, tanımlıysa oluşturur ve idempotenttir', async () => {
    const { app, prisma } = await freshApp();
    await withEnv(undefined, undefined, async () => {
      expect(await bootstrapAdmin(prisma)).toBe('skipped');
      expect(await prisma.user.count()).toBe(0);
    });
    await withEnv('admin', 'gizli123', async () => {
      expect(await bootstrapAdmin(prisma)).toBe('created');
      const row = await prisma.user.findUnique({ where: { username: 'admin' } });
      expect(row?.isAdmin).toBe(true);
      // Oluşan hesapla gerçekten giriş yapılabilmeli.
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'gizli123' },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().user.isAdmin).toBe(true);
      expect(await bootstrapAdmin(prisma)).toBe('ok');
    });
  });

  it('mevcut kullanıcıyı şifresini ezmeden terfi ettirir', async () => {
    const { app, prisma, sent } = await freshApp();
    await registerVerified(app, sent, { username: 'ceren', password: 'orijinal1', email: 'ceren@x.com' });
    await withEnv('ceren', 'bambaska99', async () => {
      expect(await bootstrapAdmin(prisma)).toBe('promoted');
    });
    const row = await prisma.user.findUnique({ where: { username: 'ceren' } });
    expect(row?.isAdmin).toBe(true);
    // Orijinal şifre çalışmaya devam eder; env'deki şifre hesabı ELE GEÇİRMEZ.
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'ceren', password: 'orijinal1' },
    });
    expect(login.statusCode).toBe(200);
    const bad = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'ceren', password: 'bambaska99' },
    });
    expect(bad.statusCode).toBe(401);
  });
});

describe('kullanıcı yönetimi', () => {
  it('kullanıcıları toplamlarıyla listeler ve q ile filtreler', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);
    const { cookies: bora } = await registerVerified(app, sent, {
      username: 'bora', password: 'sifre123', email: 'bora@x.com', displayName: 'Bora K',
    });
    await createCanvas(app, bora, 'Bora Planı');

    const res = await app.inject({ method: 'GET', url: '/api/admin/users', cookies });
    expect(res.statusCode).toBe(200);
    const users = res.json().users as Array<Record<string, unknown>>;
    expect(users).toHaveLength(2);
    const b = users.find((u) => u.username === 'bora')!;
    expect(b).toMatchObject({
      isAdmin: false, hasPassword: true, hasGoogle: false,
      ownedCanvasCount: 1, membershipCount: 1, groupCount: 0, sessionCount: 1,
    });
    expect(b.lastCommitAt).not.toBeNull(); // kanvasın kök-düğüm seed commit'inin yazarı

    const filtered = await app.inject({ method: 'GET', url: '/api/admin/users?q=BORA', cookies });
    expect(filtered.json().users).toHaveLength(1);
    const none = await app.inject({ method: 'GET', url: '/api/admin/users?q=yokboyle', cookies });
    expect(none.json().users).toHaveLength(0);
  });

  it('yönetici yapma/çıkarma: self-demote ve son yönetici engellenir', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);
    await registerVerified(app, sent, { username: 'bora', password: 'sifre123', email: 'bora@x.com' });
    const boraId = await userId(prisma, 'bora');
    const selfId = await userId(prisma, 'yonetici');

    // Kendi yetkisini kaldıramaz (aynı zamanda son yönetici).
    const self = await app.inject({
      method: 'PATCH', url: `/api/admin/users/${selfId}`, payload: { isAdmin: false }, cookies,
    });
    expect(self.statusCode).toBe(400);
    expect(self.json().error).toBe('kendi yönetici yetkinizi kaldıramazsınız');

    // Terfi + terfinin mevcut oturuma anında yansıması (resolveSession DB'den okur).
    const promote = await app.inject({
      method: 'PATCH', url: `/api/admin/users/${boraId}`, payload: { isAdmin: true }, cookies,
    });
    expect(promote.statusCode).toBe(200);

    // İki yöneticiyken biri diğerini düşürebilir.
    const demote = await app.inject({
      method: 'PATCH', url: `/api/admin/users/${boraId}`, payload: { isAdmin: false }, cookies,
    });
    expect(demote.statusCode).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: boraId } }))!.isAdmin).toBe(false);

    // Son yönetici guard'ı: route'a aktör olarak yalnızca yöneticiler ulaştığı için
    // bu dal ancak yarış durumunda tetiklenir — servis seviyesinde doğrula.
    expect(await setUserAdmin(prisma, boraId, selfId, false)).toEqual({
      error: 'son yöneticinin yetkisi kaldırılamaz',
    });

    // Geçersiz gövde ve olmayan kullanıcı.
    expect((await app.inject({
      method: 'PATCH', url: `/api/admin/users/${boraId}`, payload: {}, cookies,
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'PATCH', url: '/api/admin/users/yok-boyle-id', payload: { isAdmin: true }, cookies,
    })).statusCode).toBe(400);
  });

  it('şifre atama hedefin tüm oturumlarını kapatır; kısa şifre 400', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);
    const { cookies: bora } = await registerVerified(app, sent, {
      username: 'bora', password: 'eski1234', email: 'bora@x.com',
    });
    const boraId = await userId(prisma, 'bora');

    const short = await app.inject({
      method: 'POST', url: `/api/admin/users/${boraId}/password`, payload: { password: 'abc' }, cookies,
    });
    expect(short.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST', url: `/api/admin/users/${boraId}/password`, payload: { password: 'yeni1234' }, cookies,
    });
    expect(ok.statusCode).toBe(200);
    // Eski oturum düştü, eski şifre çalışmıyor, yenisi çalışıyor.
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: bora })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'bora', password: 'eski1234' },
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'bora', password: 'yeni1234' },
    })).statusCode).toBe(200);
  });

  it('oturum iptali mevcut çerezleri geçersiz kılar', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);
    const { cookies: bora } = await registerVerified(app, sent, {
      username: 'bora', password: 'sifre123', email: 'bora@x.com',
    });
    const boraId = await userId(prisma, 'bora');
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/users/${boraId}/sessions`, cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBeGreaterThanOrEqual(1);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: bora })).statusCode).toBe(401);
  });

  it('kullanıcı silme: sahip kanvaslar gider, üyelikler düşer, ana hat geçmişi kalır', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);
    const { cookies: bora } = await registerVerified(app, sent, {
      username: 'bora', password: 'sifre123', email: 'bora@x.com',
    });
    const { cookies: ceren } = await registerVerified(app, sent, {
      username: 'ceren', password: 'sifre123', email: 'ceren@x.com',
    });
    const boraId = await userId(prisma, 'bora');

    // Bora X'in sahibi (üyesi Ceren), Ceren'in Y kanvasında editör ve bir ana hat commit'inin yazarı.
    const x = await createCanvas(app, bora, 'Bora X');
    await acceptInvite(app, ceren, await mintInvite(app, bora, x.id));
    const y = await createCanvas(app, ceren, 'Ceren Y');
    const yInviteFromBora = await (async () => {
      await acceptInvite(app, bora, await mintInvite(app, ceren, y.id));
      return mintInvite(app, bora, y.id); // Bora'nın oluşturduğu davet: silinmeli
    })();
    const commitRes = await app.inject({
      method: 'POST',
      url: `/api/canvases/${y.id}/commit`,
      payload: { ops: [{ op: 'add_node', title: 'Bora düğümü' }] },
      cookies: bora,
    });
    expect(commitRes.statusCode).toBe(200);
    const boraSeq = commitRes.json().commit.seq as number;
    // Bora'nın açık bir branch'i ve branch commit'i (ana hattın parçası değil).
    const branch = await prisma.branch.create({
      data: { canvasId: y.id, name: 'bora/cakisma-1', baseSeq: 1, createdBy: boraId },
    });
    await prisma.commit.create({
      data: { canvasId: y.id, seq: 999, message: 'branch işi', ops: '[]', authorId: boraId, branchId: branch.id },
    });

    const del = await app.inject({ method: 'DELETE', url: `/api/admin/users/${boraId}`, cookies });
    expect(del.statusCode).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: boraId } })).toBeNull();
    expect(await prisma.canvas.findUnique({ where: { id: x.id } })).toBeNull(); // sahip olunan kanvas gitti
    expect(await prisma.canvas.findUnique({ where: { id: y.id } })).not.toBeNull(); // üyesi olduğu kaldı
    const mainCommit = await prisma.commit.findUnique({
      where: { canvasId_seq: { canvasId: y.id, seq: boraSeq } },
    });
    expect(mainCommit).not.toBeNull();
    expect(mainCommit!.authorId).toBeNull(); // "sistem" olarak görünür
    expect(await prisma.branch.count({ where: { canvasId: y.id } })).toBe(0);
    expect(await prisma.commit.count({ where: { canvasId: y.id, branchId: { not: null } } })).toBe(0);
    expect(await prisma.canvasMember.count({ where: { userId: boraId } })).toBe(0);
    // Bora'nın davet linki artık geçersiz.
    expect((await acceptInvite(app, ceren, yInviteFromBora)).statusCode).toBe(404);
    // Bora giriş yapamaz.
    expect((await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'bora', password: 'sifre123' },
    })).statusCode).toBe(401);
  });

  it('kendini silme ve dolu grubun tek yöneticisini silme engellenir', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);
    const selfId = await userId(prisma, 'yonetici');
    const self = await app.inject({ method: 'DELETE', url: `/api/admin/users/${selfId}`, cookies });
    expect(self.statusCode).toBe(400);
    expect(self.json().error).toBe('kendi hesabınızı silemezsiniz');

    // Bora tek yöneticisi olduğu gruba Ceren'i alır → silinemez.
    const { cookies: bora } = await registerVerified(app, sent, {
      username: 'bora', password: 'sifre123', email: 'bora@x.com',
    });
    const { cookies: ceren } = await registerVerified(app, sent, {
      username: 'ceren', password: 'sifre123', email: 'ceren@x.com',
    });
    const group = (await app.inject({
      method: 'POST', url: '/api/groups', payload: { name: 'Takım' }, cookies: bora,
    })).json().group as { id: string };
    const token = (await app.inject({
      method: 'POST', url: `/api/groups/${group.id}/invites`, cookies: bora,
    })).json().token as string;
    await app.inject({ method: 'POST', url: `/api/group-invites/${token}/accept`, payload: {}, cookies: ceren });

    const boraId = await userId(prisma, 'bora');
    const blocked = await app.inject({ method: 'DELETE', url: `/api/admin/users/${boraId}`, cookies });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toContain('Takım');
  });
});

describe('kanvas yönetimi', () => {
  it('listeler, üye rolü değiştirir, sahip korunur, davetleri ve kanvası siler', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);
    const { cookies: bora } = await registerVerified(app, sent, {
      username: 'bora', password: 'sifre123', email: 'bora@x.com',
    });
    const { cookies: ceren } = await registerVerified(app, sent, {
      username: 'ceren', password: 'sifre123', email: 'ceren@x.com',
    });
    const x = await createCanvas(app, bora, 'Proje X');
    await acceptInvite(app, ceren, await mintInvite(app, bora, x.id));

    const list = await app.inject({ method: 'GET', url: '/api/admin/canvases', cookies });
    expect(list.statusCode).toBe(200);
    const info = list.json().canvases.find((c: { id: string }) => c.id === x.id);
    expect(info).toMatchObject({ name: 'Proje X', owner: 'bora', memberCount: 2, commitCount: 1, groupId: null });

    // Üye rolü: Ceren → viewer; sahibin rolü değiştirilemez/çıkarılamaz.
    const cerenId = await userId(prisma, 'ceren');
    const boraId = await userId(prisma, 'bora');
    const roleRes = await app.inject({
      method: 'PATCH', url: `/api/admin/canvases/${x.id}/members/${cerenId}`, payload: { role: 'viewer' }, cookies,
    });
    expect(roleRes.statusCode).toBe(200);
    expect(roleRes.json().members.find((m: { userId: string }) => m.userId === cerenId).role).toBe('viewer');
    expect((await app.inject({
      method: 'PATCH', url: `/api/admin/canvases/${x.id}/members/${boraId}`, payload: { role: 'viewer' }, cookies,
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'DELETE', url: `/api/admin/canvases/${x.id}/members/${boraId}`, cookies,
    })).statusCode).toBe(400);

    // Davet iptali: açık token geçersizleşir.
    const openToken = await mintInvite(app, bora, x.id);
    const revoke = await app.inject({ method: 'DELETE', url: `/api/admin/canvases/${x.id}/invites`, cookies });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().deleted).toBeGreaterThanOrEqual(1);
    expect((await acceptInvite(app, ceren, openToken)).statusCode).toBe(404);

    // Üye çıkarma + kanvas silme.
    expect((await app.inject({
      method: 'DELETE', url: `/api/admin/canvases/${x.id}/members/${cerenId}`, cookies,
    })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/canvases/${x.id}`, cookies })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/canvases', cookies: bora })).json().canvases).toHaveLength(0);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/canvases/${x.id}`, cookies })).statusCode).toBe(404);
  });
});

describe('grup yönetimi', () => {
  it('listeler, üye onaylar/yönetir, grup silinince kanvas kişiselleşir', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);
    const { cookies: bora } = await registerVerified(app, sent, {
      username: 'bora', password: 'sifre123', email: 'bora@x.com',
    });
    const { cookies: ceren } = await registerVerified(app, sent, {
      username: 'ceren', password: 'sifre123', email: 'ceren@x.com',
    });
    const group = (await app.inject({
      method: 'POST', url: '/api/groups', payload: { name: 'Takım' }, cookies: bora,
    })).json().group as { id: string };
    const token = (await app.inject({
      method: 'POST', url: `/api/groups/${group.id}/invites`, cookies: bora,
    })).json().token as string;
    await app.inject({ method: 'POST', url: `/api/group-invites/${token}/accept`, payload: {}, cookies: ceren });
    const canvas = await createCanvas(app, bora, 'Takım Planı', group.id);

    const list = await app.inject({ method: 'GET', url: '/api/admin/groups', cookies });
    expect(list.json().groups.find((g: { id: string }) => g.id === group.id)).toMatchObject({
      name: 'Takım', memberCount: 1, pendingCount: 1, canvasCount: 1,
    });

    // Bekleyen üyeyi onayla; son grup yöneticisi guard'ı admin uçlarında da işler.
    const cerenId = await userId(prisma, 'ceren');
    const boraId = await userId(prisma, 'bora');
    const approve = await app.inject({
      method: 'PATCH', url: `/api/admin/groups/${group.id}/members/${cerenId}`, payload: { status: 'approved' }, cookies,
    });
    expect(approve.statusCode).toBe(200);
    expect((await app.inject({
      method: 'PATCH', url: `/api/admin/groups/${group.id}/members/${boraId}`, payload: { role: 'member' }, cookies,
    })).statusCode).toBe(400); // tek yönetici
    expect((await app.inject({
      method: 'PATCH', url: `/api/admin/groups/${group.id}/members/${cerenId}`, payload: { role: 'admin' }, cookies,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'DELETE', url: `/api/admin/groups/${group.id}/members/${cerenId}`, cookies,
    })).statusCode).toBe(200);

    // Grup silme: kanvas silinmez, kişisel kanvasa dönüşür.
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/groups/${group.id}`, cookies })).statusCode).toBe(200);
    const row = await prisma.canvas.findUnique({ where: { id: canvas.id } });
    expect(row).not.toBeNull();
    expect(row!.groupId).toBeNull();
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/groups/${group.id}`, cookies })).statusCode).toBe(404);
  });
});

describe('görünüm: giriş ekranı önizleme görseli', () => {
  // 1x1 saydam PNG.
  const pngB64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const pngDataUrl = `data:image/png;base64,${pngB64}`;
  const setPreview = (app: App, cookies: Cookies, payload: { dataUrl?: string; url?: string }) =>
    app.inject({ method: 'PUT', url: '/api/admin/appearance/login-preview', payload, cookies });

  it('görünüm ucu oturumsuz okunur ve ayarsızken boş döner', async () => {
    const { app } = await freshApp();
    const res = await app.inject({ method: 'GET', url: '/api/site/appearance' });
    expect(res.statusCode).toBe(200);
    expect(res.json().appearance.loginPreview).toBeNull();
    // Görsel yokken ucun kendisi 404 verir (istemci paketteki örneğe düşer).
    expect((await app.inject({ method: 'GET', url: '/api/site/login-preview' })).statusCode).toBe(404);
  });

  it('yalnızca yönetici değiştirebilir', async () => {
    const { app, sent } = await freshApp();
    expect((await app.inject({ method: 'PUT', url: '/api/admin/appearance/login-preview', payload: { dataUrl: pngDataUrl } })).statusCode).toBe(401);
    const { cookies } = await registerVerified(app, sent, { username: 'ayse', password: 'sifre123', email: 'a@x.com' });
    expect((await setPreview(app, cookies, { dataUrl: pngDataUrl })).statusCode).toBe(403);
  });

  it('yüklenen görsel kaydedilir, oturumsuz servis edilir ve varsayılana dönülebilir', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);

    expect((await setPreview(app, cookies, { dataUrl: pngDataUrl })).statusCode).toBe(200);

    // Oturumsuz istemci hem adresi hem baytları alabilmeli.
    const appearance = await app.inject({ method: 'GET', url: '/api/site/appearance' });
    const url = appearance.json().appearance.loginPreview as string;
    expect(url).toMatch(/^\/api\/site\/login-preview\?v=\d+$/);

    const img = await app.inject({ method: 'GET', url });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.rawPayload.equals(Buffer.from(pngB64, 'base64'))).toBe(true);

    expect((await app.inject({ method: 'DELETE', url: '/api/admin/appearance/login-preview', cookies })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/site/appearance' })).json().appearance.loginPreview).toBeNull();
  });

  it('dış adres kaydedilir ve yüklenen baytların yerini alır', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);

    await setPreview(app, cookies, { dataUrl: pngDataUrl });
    expect((await setPreview(app, cookies, { url: 'https://ornek.com/a.png' })).statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: '/api/site/appearance' })).json().appearance.loginPreview)
      .toBe('https://ornek.com/a.png');
    // Adrese geçilince eski baytlar temizlenir.
    expect((await app.inject({ method: 'GET', url: '/api/site/login-preview' })).statusCode).toBe(404);
  });

  it('geçersiz tür, bozuk veri ve tehlikeli şema reddedilir', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);

    // SVG bilerek dışarıda: aynı origin'den servis edilince script çalıştırabilir.
    expect((await setPreview(app, cookies, { dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })).statusCode).toBe(400);
    expect((await setPreview(app, cookies, { dataUrl: 'merhaba' })).statusCode).toBe(400);
    expect((await setPreview(app, cookies, { url: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await setPreview(app, cookies, {})).statusCode).toBe(400);
    expect((await setPreview(app, cookies, { dataUrl: pngDataUrl, url: 'https://ornek.com/a.png' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/site/appearance' })).json().appearance.loginPreview).toBeNull();
  });

  it('2 MB üstü görsel reddedilir', async () => {
    const { app, prisma, sent } = await freshApp();
    const { cookies } = await adminUser(app, prisma, sent);
    const big = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 64, 1).toString('base64')}`;
    expect((await setPreview(app, cookies, { dataUrl: big })).statusCode).toBe(400);
  });
});
