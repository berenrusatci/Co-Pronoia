import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { captureEmails, registerVerified } from './testAuth.js';

let db: ReturnType<typeof testDbFactory>;
beforeAll(() => {
  db = testDbFactory();
});

const opened: Array<{ prisma: { $disconnect(): Promise<void> } }> = [];
// Havuzlar test biter bitmez kapatılır ki dosya boyunca Postgres bağlantıları birikmesin.
afterEach(async () => {
  for (const { prisma } of opened.splice(0)) await prisma.$disconnect();
});
afterAll(async () => {
  await db.cleanup();
}, 30000);

async function fresh() {
  const { sender, sent } = captureEmails();
  const built = await buildApp(await db.fresh(), { emailSender: sender });
  opened.push(built);
  return { ...built, sent };
}

type App = Awaited<ReturnType<typeof fresh>>['app'];
type Cookies = { tm_session: string };

const createGroup = async (app: App, cookies: Cookies, name: string, type?: string) => {
  const res = await app.inject({
    method: 'POST', url: '/api/groups', cookies,
    payload: { name, ...(type !== undefined ? { type } : {}) },
  });
  return res;
};

describe('co-pronoia tür kapılaması (grup + kanvas)', () => {
  it('grup türü round-trip eder; varsayılan plan; geçersiz tür 400', async () => {
    const { app, sent } = await fresh();
    const { cookies } = await registerVerified(app, sent, { username: 'g1', password: 'sifre1', email: 'g1@t.com' });

    let res = await createGroup(app, cookies, 'Normal');
    expect(res.statusCode).toBe(200);
    expect(res.json().group.type).toBe('plan');

    res = await createGroup(app, cookies, 'Ajanlı', 'co-pronoia');
    expect(res.statusCode).toBe(200);
    expect(res.json().group.type).toBe('co-pronoia');

    res = await createGroup(app, cookies, 'Bozuk', 'saçma');
    expect(res.statusCode).toBe(400);

    // listGroups da türü döndürür
    const list = await app.inject({ method: 'GET', url: '/api/groups', cookies });
    const types = Object.fromEntries(list.json().groups.map((g: { name: string; type: string }) => [g.name, g.type]));
    expect(types).toEqual({ Normal: 'plan', 'Ajanlı': 'co-pronoia' });
  });

  it('co-pronoia kanvası yalnızca co-pronoia grubunda; tür CanvasInfo ile döner', async () => {
    const { app, sent } = await fresh();
    const { cookies } = await registerVerified(app, sent, { username: 'k1', password: 'sifre1', email: 'k1@t.com' });
    const planGroup = (await createGroup(app, cookies, 'Plan Grubu')).json().group.id as string;
    const cpGroup = (await createGroup(app, cookies, 'CP Grubu', 'co-pronoia')).json().group.id as string;

    // plan grubunda co-pronoia kanvası → 400
    let res = await app.inject({
      method: 'POST', url: '/api/canvases', cookies,
      payload: { name: 'X', groupId: planGroup, type: 'co-pronoia' },
    });
    expect(res.statusCode).toBe(400);

    // geçersiz tür → 400
    res = await app.inject({
      method: 'POST', url: '/api/canvases', cookies,
      payload: { name: 'X', groupId: cpGroup, type: 'saçma' },
    });
    expect(res.statusCode).toBe(400);

    // co-pronoia grubunda co-pronoia kanvası → 200 + type
    res = await app.inject({
      method: 'POST', url: '/api/canvases', cookies,
      payload: { name: 'Ajan Kanvas', groupId: cpGroup, type: 'co-pronoia' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().canvas.type).toBe('co-pronoia');

    // tür verilmezse plan (co-pronoia grubunda da normal kanvas açılabilir)
    res = await app.inject({
      method: 'POST', url: '/api/canvases', cookies,
      payload: { name: 'Normal Kanvas', groupId: cpGroup },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().canvas.type).toBe('plan');

    // liste de türü taşır
    const list = await app.inject({ method: 'GET', url: '/api/canvases', cookies });
    const byName = Object.fromEntries(list.json().canvases.map((c: { name: string; type: string }) => [c.name, c.type]));
    expect(byName['Ajan Kanvas']).toBe('co-pronoia');
    expect(byName['Normal Kanvas']).toBe('plan');
  });
});

describe('ajan rol tanımları (grup + site şablonları)', () => {
  it('grup rol CRUD yetki matrisi: üye 403, admin ve canManageRoles 200', async () => {
    const { app, prisma, sent } = await fresh();
    const { cookies: admin } = await registerVerified(app, sent, { username: 'ra', password: 'sifre1', email: 'ra@t.com' });
    const r2 = await registerVerified(app, sent, { username: 'ru', password: 'sifre2', email: 'ru@t.com' });
    const member = r2.cookies;
    const memberId = r2.res.json().user.id as string;
    const groupId = (await createGroup(app, admin, 'CP', 'co-pronoia')).json().group.id as string;
    await prisma.groupMember.create({ data: { groupId, userId: memberId, status: 'approved' } });

    // düz üye rol oluşturamaz
    let res = await app.inject({
      method: 'POST', url: `/api/groups/${groupId}/agent-roles`, cookies: member,
      payload: { name: 'Mimar' },
    });
    expect(res.statusCode).toBe(403);

    // admin oluşturur; persona + süpervizör bayrağı round-trip eder
    res = await app.inject({
      method: 'POST', url: `/api/groups/${groupId}/agent-roles`, cookies: admin,
      payload: { name: 'Süpervizör', persona: 'Planları birleştir.', isSupervisor: true },
    });
    expect(res.statusCode).toBe(200);
    const roleId = res.json().role.id as string;
    expect(res.json().role).toMatchObject({
      name: 'Süpervizör', persona: 'Planları birleştir.', isSupervisor: true, scope: 'group',
    });

    // her üye listeler
    res = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/agent-roles`, cookies: member });
    expect(res.statusCode).toBe(200);
    expect(res.json().roles).toHaveLength(1);

    // canManageRoles yetkili rol atanmış üye güncelleyebilir
    const mgr = (await app.inject({
      method: 'POST', url: `/api/groups/${groupId}/roles`, cookies: admin,
      payload: { name: 'rol yöneticisi', canManageRoles: true },
    })).json().role.id as string;
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: memberId } }, data: { roleDefId: mgr },
    });
    res = await app.inject({
      method: 'PATCH', url: `/api/groups/${groupId}/agent-roles/${roleId}`, cookies: member,
      payload: { persona: 'Güncel brifing.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role.persona).toBe('Güncel brifing.');

    // boş ad 400; sil → 404 kalır
    res = await app.inject({
      method: 'POST', url: `/api/groups/${groupId}/agent-roles`, cookies: admin, payload: { name: '  ' },
    });
    expect(res.statusCode).toBe(400);
    res = await app.inject({ method: 'DELETE', url: `/api/groups/${groupId}/agent-roles/${roleId}`, cookies: admin });
    expect(res.statusCode).toBe(200);
    res = await app.inject({ method: 'DELETE', url: `/api/groups/${groupId}/agent-roles/${roleId}`, cookies: admin });
    expect(res.statusCode).toBe(404);
  });

  it('site şablonları admin uçlarından yönetilir; kapsamlar birbirine karışmaz', async () => {
    const { app, prisma, sent } = await fresh();
    const r1 = await registerVerified(app, sent, { username: 'sa', password: 'sifre1', email: 'sa@t.com' });
    const siteAdmin = r1.cookies;
    const siteAdminId = r1.res.json().user.id as string;
    const { cookies: pleb } = await registerVerified(app, sent, { username: 'sp', password: 'sifre2', email: 'sp@t.com' });

    // isAdmin olmayan → 403
    let res = await app.inject({ method: 'GET', url: '/api/admin/agent-roles', cookies: pleb });
    expect(res.statusCode).toBe(403);

    await prisma.user.update({ where: { id: siteAdminId }, data: { isAdmin: true } });
    res = await app.inject({
      method: 'POST', url: '/api/admin/agent-roles', cookies: siteAdmin,
      payload: { name: 'Genel Mimar', persona: 'Site şablonu.' },
    });
    expect(res.statusCode).toBe(200);
    const siteRoleId = res.json().role.id as string;
    expect(res.json().role.scope).toBe('site');

    // site şablonu grup rotasından görünmez/değiştirilemez
    const groupId = (await createGroup(app, siteAdmin, 'G', 'co-pronoia')).json().group.id as string;
    res = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/agent-roles`, cookies: siteAdmin });
    expect(res.json().roles).toHaveLength(0);
    res = await app.inject({
      method: 'PATCH', url: `/api/groups/${groupId}/agent-roles/${siteRoleId}`, cookies: siteAdmin,
      payload: { name: 'ele geçir' },
    });
    expect(res.statusCode).toBe(404);

    // grup rolü de admin (site) rotasından değiştirilemez
    const groupRole = (await app.inject({
      method: 'POST', url: `/api/groups/${groupId}/agent-roles`, cookies: siteAdmin, payload: { name: 'Yerel' },
    })).json().role.id as string;
    res = await app.inject({
      method: 'PATCH', url: `/api/admin/agent-roles/${groupRole}`, cookies: siteAdmin, payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('ajan anahtarları (mint/list/revoke)', () => {
  /** co-pronoia grup + kanvas + bir rol kurar; owner çerezleri ve id'leri döndürür. */
  async function cpSetup() {
    const ctx = await fresh();
    const { cookies } = await registerVerified(ctx.app, ctx.sent, { username: 'ta', password: 'sifre1', email: 'ta@t.com' });
    const groupId = (await createGroup(ctx.app, cookies, 'CP', 'co-pronoia')).json().group.id as string;
    const canvasId = (await ctx.app.inject({
      method: 'POST', url: '/api/canvases', cookies,
      payload: { name: 'K', groupId, type: 'co-pronoia' },
    })).json().canvas.id as string;
    const roleId = (await ctx.app.inject({
      method: 'POST', url: `/api/groups/${groupId}/agent-roles`, cookies,
      payload: { name: 'Mimar', persona: 'Planla.' },
    })).json().role.id as string;
    return { ...ctx, cookies, groupId, canvasId, roleId };
  }

  it('mint yalnızca co-pronoia kanvasında ve kanvasın grubundaki rolle; secret ham saklanmaz', async () => {
    const { app, prisma, cookies, groupId, canvasId, roleId, sent } = await cpSetup();

    // normal kanvasta mint → 400
    const planCanvas = (await app.inject({
      method: 'POST', url: '/api/canvases', cookies, payload: { name: 'Normal', groupId },
    })).json().canvas.id as string;
    let res = await app.inject({
      method: 'POST', url: `/api/canvases/${planCanvas}/agent-tokens`, cookies,
      payload: { roleId, label: 'a1' },
    });
    expect(res.statusCode).toBe(400);

    // başka grubun rolüyle mint → 400
    const otherGroup = (await createGroup(app, cookies, 'Diğer', 'co-pronoia')).json().group.id as string;
    const foreignRole = (await app.inject({
      method: 'POST', url: `/api/groups/${otherGroup}/agent-roles`, cookies, payload: { name: 'Yabancı' },
    })).json().role.id as string;
    res = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/agent-tokens`, cookies,
      payload: { roleId: foreignRole, label: 'a1' },
    });
    expect(res.statusCode).toBe(400);

    // geçerli mint: secret tma_ önekli, DB'de ham durmuyor
    res = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/agent-tokens`, cookies,
      payload: { roleId, label: 'ajan-1' },
    });
    expect(res.statusCode).toBe(200);
    const { token, secret } = res.json() as { token: { id: string; roleName: string }; secret: string };
    expect(secret.startsWith('tma_')).toBe(true);
    expect(token.roleName).toBe('Mimar');
    const row = await prisma.agentToken.findUnique({ where: { id: token.id } });
    expect(row!.tokenHash).not.toBe(secret);

    // site şablonu rolüyle de basılabilir
    const adminUser = await registerVerified(app, sent, { username: 'adm', password: 'sifre2', email: 'adm@t.com' });
    await prisma.user.update({ where: { id: adminUser.res.json().user.id as string }, data: { isAdmin: true } });
    const siteRole = (await app.inject({
      method: 'POST', url: '/api/admin/agent-roles', cookies: adminUser.cookies,
      payload: { name: 'Genel', isSupervisor: true },
    })).json().role.id as string;
    res = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/agent-tokens`, cookies,
      payload: { roleId: siteRole, label: 'süper-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token.isSupervisor).toBe(true);

    // /agent-roles birleşik listeyi döndürür (site + grup)
    res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/agent-roles`, cookies });
    const names = res.json().roles.map((r: { name: string }) => r.name);
    expect(names).toContain('Mimar');
    expect(names).toContain('Genel');
  });

  it('token uçları owner-only; revoke listede görünür; deleteCanvas anahtarlarla çalışır', async () => {
    const { app, prisma, cookies, canvasId, roleId, sent } = await cpSetup();
    const mint = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/agent-tokens`, cookies,
      payload: { roleId, label: 'ajan-1' },
    });
    const tokenId = mint.json().token.id as string;

    // editör üye 403 görür
    const editor = await registerVerified(app, sent, { username: 'ed', password: 'sifre2', email: 'ed@t.com' });
    await prisma.canvasMember.create({ data: { canvasId, userId: editor.res.json().user.id as string } });
    let res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/agent-tokens`, cookies: editor.cookies });
    expect(res.statusCode).toBe(403);
    res = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/agent-tokens`, cookies: editor.cookies,
      payload: { roleId, label: 'x' },
    });
    expect(res.statusCode).toBe(403);

    // revoke → listede revoked: true
    res = await app.inject({ method: 'DELETE', url: `/api/canvases/${canvasId}/agent-tokens/${tokenId}`, cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().tokens[0].revoked).toBe(true);

    // token'lı kanvas silinebilir (deleteCanvas transaction'ı anahtarları da temizler)
    res = await app.inject({ method: 'DELETE', url: `/api/canvases/${canvasId}/`, cookies });
    expect(res.statusCode).toBe(200);
    expect(await prisma.agentToken.count({ where: { canvasId } })).toBe(0);
  });
});
