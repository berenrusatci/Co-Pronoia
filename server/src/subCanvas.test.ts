import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { createCanvas, deleteCanvas } from './canvasService.js';
import { captureEmails, createGroupCanvas, registerVerified } from './testAuth.js';
import type { OpInput } from '@treemapper/shared';

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

const commit = (app: App, cookies: Cookies, canvasId: string, ops: OpInput[], baseSeq?: number) =>
  app.inject({
    method: 'POST', url: `/api/canvases/${canvasId}/commit`, cookies,
    payload: { ops, ...(baseSeq !== undefined ? { baseSeq } : {}) },
  });

const rootIdOf = async (app: App, cookies: Cookies, canvasId: string): Promise<string> => {
  const res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/state`, cookies });
  return res.json().nodes[0].id as string;
};

describe('kanvas oluşturma yetki matrisi (grup zorunlu + canCreateCanvas)', () => {
  it('grupsuz istek 400; üyelik/rol durumuna göre 403 ya da 200', async () => {
    const { app, prisma, sent } = await fresh();
    const { cookies: admin } = await registerVerified(app, sent, { username: 'a1', password: 'sifre1', email: 'a1@t.com' });
    const r2 = await registerVerified(app, sent, { username: 'u2', password: 'sifre2', email: 'u2@t.com' });
    const u2 = r2.cookies;
    const u2Id = r2.res.json().user.id as string;

    // groupId olmadan → 400
    let res = await app.inject({ method: 'POST', url: '/api/canvases', cookies: admin, payload: { name: 'X' } });
    expect(res.statusCode).toBe(400);

    const groupId = (await app.inject({ method: 'POST', url: '/api/groups', cookies: admin, payload: { name: 'Ekip' } }))
      .json().group.id as string;

    // admin → ok
    res = await app.inject({ method: 'POST', url: '/api/canvases', cookies: admin, payload: { name: 'K1', groupId } });
    expect(res.statusCode).toBe(200);
    expect(res.json().canvas.groupId).toBe(groupId);

    // üye olmayan → 403
    res = await app.inject({ method: 'POST', url: '/api/canvases', cookies: u2, payload: { name: 'K2', groupId } });
    expect(res.statusCode).toBe(403);

    // pending üye → 403
    await prisma.groupMember.create({ data: { groupId, userId: u2Id, status: 'pending' } });
    res = await app.inject({ method: 'POST', url: '/api/canvases', cookies: u2, payload: { name: 'K2', groupId } });
    expect(res.statusCode).toBe(403);

    // rolsüz onaylı üye → ok (canCreateCanvas varsayılanı true)
    await prisma.groupMember.update({ where: { groupId_userId: { groupId, userId: u2Id } }, data: { status: 'approved' } });
    res = await app.inject({ method: 'POST', url: '/api/canvases', cookies: u2, payload: { name: 'K2', groupId } });
    expect(res.statusCode).toBe(200);

    // canCreateCanvas: false rolü → 403
    const role = (await app.inject({
      method: 'POST', url: `/api/groups/${groupId}/roles`, cookies: admin,
      payload: { name: 'stajyer', canCreateCanvas: false },
    })).json().role;
    await app.inject({
      method: 'PATCH', url: `/api/groups/${groupId}/members/${u2Id}`, cookies: admin, payload: { roleDefId: role.id },
    });
    res = await app.inject({ method: 'POST', url: '/api/canvases', cookies: u2, payload: { name: 'K3', groupId } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('yetkiniz yok');

    // rol canCreateCanvas: true yapılınca → ok
    await app.inject({
      method: 'PATCH', url: `/api/groups/${groupId}/roles/${role.id}`, cookies: admin, payload: { canCreateCanvas: true },
    });
    res = await app.inject({ method: 'POST', url: '/api/canvases', cookies: u2, payload: { name: 'K3', groupId } });
    expect(res.statusCode).toBe(200);
  });
});

describe('linkedCanvasId doğrulaması', () => {
  it('aynı grup bağlanır; farklı grup / olmayan / self / grupsuz kaynak 400', async () => {
    const { app, prisma, serviceFor, sent } = await fresh();
    const { cookies } = await registerVerified(app, sent, { username: 'b1', password: 'sifre1', email: 'b1@t.com' });
    const k1 = await createGroupCanvas(app, cookies, 'K1');
    const k2 = await createGroupCanvas(app, cookies, 'K2', k1.groupId); // aynı grup
    const k3 = await createGroupCanvas(app, cookies, 'K3'); // başka grup (kendi grubunu açar)
    const root = await rootIdOf(app, cookies, k1.id);

    // farklı grup → 400
    let res = await commit(app, cookies, k1.id, [{ op: 'update_node', id: root, fields: { linkedCanvasId: k3.id } }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('aynı gruptaki');

    // olmayan hedef → 400
    res = await commit(app, cookies, k1.id, [{ op: 'update_node', id: root, fields: { linkedCanvasId: 'yok-boyle' } }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('bulunamadı');

    // kendine bağlanma → 400
    res = await commit(app, cookies, k1.id, [{ op: 'update_node', id: root, fields: { linkedCanvasId: k1.id } }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('kendi kanvasına');

    // aynı grup → ok; add_node üzerinde de çalışır; materyalize state ve replay uyuşur
    res = await commit(app, cookies, k1.id, [
      { op: 'update_node', id: root, fields: { linkedCanvasId: k2.id } },
      { op: 'add_node', id: 'n2', title: 'Bağlı doğan', linkedCanvasId: k2.id },
    ]);
    expect(res.statusCode).toBe(200);
    const state = res.json().state;
    expect(state.nodes.find((n: { id: string }) => n.id === root).linkedCanvasId).toBe(k2.id);
    expect(state.nodes.find((n: { id: string }) => n.id === 'n2').linkedCanvasId).toBe(k2.id);
    expect(await serviceFor(k1.id).rebuildCheck()).toBe(true);

    // grupsuz (legacy) kaynak kanvas: bağlanamaz
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', cookies })).json().user.id as string;
    const legacy = await createCanvas(prisma, serviceFor, 'Legacy', me);
    res = await commit(app, cookies, legacy.id, [
      { op: 'update_node', id: await rootIdOf(app, cookies, legacy.id), fields: { linkedCanvasId: k2.id } },
    ]);
    expect(res.statusCode).toBe(400);
  });

  it('auto-merge yolunda da doğrular; aynı alan çakışması dallanır, ayrı alanlar birleşir', async () => {
    const { app, sent } = await fresh();
    const { cookies } = await registerVerified(app, sent, { username: 'c1', password: 'sifre1', email: 'c1@t.com' });
    const k1 = await createGroupCanvas(app, cookies, 'M1');
    const k2 = await createGroupCanvas(app, cookies, 'M2', k1.groupId);
    const root = await rootIdOf(app, cookies, k1.id);
    const base = k1.headSeq as number;

    // Araya giren commit head'i ilerletir.
    await commit(app, cookies, k1.id, [{ op: 'add_node', id: 'other', title: 'Öteki' }]);

    // Bayat baseSeq + geçersiz hedef: auto-merge yoluna girer ama doğrulama yine 400 verir.
    let res = await commit(app, cookies, k1.id, [
      { op: 'update_node', id: root, fields: { linkedCanvasId: 'yok-boyle' } },
    ], base);
    expect(res.statusCode).toBe(400);

    // Bayat baseSeq + geçerli hedef: ayrık hedefler → auto-merge commit'lenir.
    res = await commit(app, cookies, k1.id, [
      { op: 'update_node', id: root, fields: { linkedCanvasId: k2.id } },
    ], base);
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe('committed');

    // Aynı düğümün linkedCanvasId alanı yeniden bayat base ile değişirse → alan çakışması → branch.
    const k2b = await createGroupCanvas(app, cookies, 'M2b', k1.groupId);
    res = await commit(app, cookies, k1.id, [
      { op: 'update_node', id: root, fields: { linkedCanvasId: k2b.id } },
    ], base);
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe('branched');

    // Farklı alan (title) bayat base'ten çakışmaz... ama açık kişisel dal varken oraya eklenir;
    // bu yüzden ayrı bir kullanıcıyla değil aynı senaryonun alan-bazlılığını yukarıdaki
    // linkedCanvasId-vs-title karşılaştırmasıyla kuruyoruz: title güncellemesi head üzerinde sorunsuz.
    res = await commit(app, cookies, k1.id, [{ op: 'update_node', id: root, fields: { title: 'Yeni ad' } }]);
    expect(res.statusCode).toBe(200);
  });

  it('sarkan bağlantı: hedef silinince revert/restore yine çalışır (doğrulama atlanır)', async () => {
    const { app, prisma, serviceFor, sent } = await fresh();
    const { cookies } = await registerVerified(app, sent, { username: 'd1', password: 'sifre1', email: 'd1@t.com' });
    const k1 = await createGroupCanvas(app, cookies, 'D1');
    const k2 = await createGroupCanvas(app, cookies, 'D2', k1.groupId);
    const root = await rootIdOf(app, cookies, k1.id);

    const linkRes = await commit(app, cookies, k1.id, [
      { op: 'update_node', id: root, fields: { linkedCanvasId: k2.id } },
    ]);
    const linkSeq = linkRes.json().commit.seq as number;

    await deleteCanvas(prisma, k2.id); // bağ sarkık kaldı

    // revert: bağı geri alır (doğrulama yok, sorunsuz)
    let res = await app.inject({ method: 'POST', url: `/api/canvases/${k1.id}/commits/${linkSeq}/revert`, cookies, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().state.nodes[0].linkedCanvasId).toBeNull();

    // restore: silinmiş kanvasa işaret eden tarihî duruma dönmek serbest
    res = await app.inject({ method: 'POST', url: `/api/canvases/${k1.id}/commits/${linkSeq}/restore`, cookies, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().state.nodes[0].linkedCanvasId).toBe(k2.id);
    expect(await serviceFor(k1.id).rebuildCheck()).toBe(true);
  });
});

describe('GET /preview ve /info', () => {
  it('üyeye önizleme şekli; üye olmayana 404; view erişimli grup üyesine 200', async () => {
    const { app, prisma, sent } = await fresh();
    const { cookies } = await registerVerified(app, sent, { username: 'e1', password: 'sifre1', email: 'e1@t.com' });
    const { cookies: outsider } = await registerVerified(app, sent, { username: 'e2', password: 'sifre2', email: 'e2@t.com' });
    const r3 = await registerVerified(app, sent, { username: 'e3', password: 'sifre3', email: 'e3@t.com' });

    const k1 = await createGroupCanvas(app, cookies, 'P1'); // seed root x:0,y:0
    await commit(app, cookies, k1.id, [
      { op: 'add_node', id: 'done1', title: 'Biten', status: 'done', x: 100, y: 50 },
      { op: 'add_node', id: 'nowhere', title: 'Konumsuz' }, // x/y yok → noktalarda değil, sayımda var
      { op: 'add_edge', id: 'e1', sourceId: 'done1', targetId: 'nowhere' }, // ucu konumsuz → önizlemede yok
    ]);
    const root = await rootIdOf(app, cookies, k1.id);
    await commit(app, cookies, k1.id, [{ op: 'add_edge', id: 'e2', sourceId: root, targetId: 'done1' }]);

    let res = await app.inject({ method: 'GET', url: `/api/canvases/${k1.id}/preview`, cookies });
    expect(res.statusCode).toBe(200);
    const preview = res.json().preview;
    expect(preview.name).toBe('P1');
    expect(preview.nodeCount).toBe(3);
    expect(preview.doneCount).toBe(1);
    expect(preview.nodes).toHaveLength(2); // yalnızca konumu olanlar
    expect(preview.edges).toHaveLength(1); // yalnızca iki ucu da konumlu kenar
    const [s, t] = preview.edges[0];
    expect(preview.nodes[s]).toBeDefined();
    expect(preview.nodes[t]).toBeDefined();

    // /info: kanvası panodan geçmeden açacak CanvasInfo
    res = await app.inject({ method: 'GET', url: `/api/canvases/${k1.id}/info`, cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().canvas).toMatchObject({ id: k1.id, name: 'P1', role: 'owner', groupId: k1.groupId });

    // üye olmayan → 404 (erişim yok/silinmiş ayrımı sızmaz)
    res = await app.inject({ method: 'GET', url: `/api/canvases/${k1.id}/preview`, cookies: outsider });
    expect(res.statusCode).toBe(404);
    res = await app.inject({ method: 'GET', url: `/api/canvases/${k1.id}/info`, cookies: outsider });
    expect(res.statusCode).toBe(404);

    // view erişimli grup rolü: önizlemeyi görebilir, /info viewer döner
    const role = (await app.inject({
      method: 'POST', url: `/api/groups/${k1.groupId}/roles`, cookies,
      payload: { name: 'izleyici', defaultCanvasAccess: 'view' },
    })).json().role;
    await prisma.groupMember.create({
      data: { groupId: k1.groupId, userId: r3.res.json().user.id, status: 'approved', roleDefId: role.id },
    });
    res = await app.inject({ method: 'GET', url: `/api/canvases/${k1.id}/preview`, cookies: r3.cookies });
    expect(res.statusCode).toBe(200);
    res = await app.inject({ method: 'GET', url: `/api/canvases/${k1.id}/info`, cookies: r3.cookies });
    expect(res.json().canvas.role).toBe('viewer');
  });
});
