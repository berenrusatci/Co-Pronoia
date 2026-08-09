import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCanvasBundle, type OpInput } from '@treemapper/shared';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { captureEmails, createGroupCanvas, registerVerified } from './testAuth.js';
import type { CloudClient } from './cloudClient.js';

/**
 * İki app tek süreçte: biri normal bulut kurulumu, biri APP_MODE=local Docker kurulumu.
 * Yerelin `CloudClient`i gerçek HTTP yerine bulut app'ine `app.inject` ile bağlanır —
 * yani el sıkışmanın iki ucu da gerçek route kodudur.
 */
const db = testDbFactory();

let cloud: Awaited<ReturnType<typeof buildApp>>;
let local: Awaited<ReturnType<typeof buildApp>>;
let cloudCookies: { tm_session: string };
let cloudCanvasIds: string[] = [];
let cpGroupId: string;

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const fakeCloudClient: CloudClient = {
  exchange: async (input) => {
    const res = await cloud.app.inject({ method: 'POST', url: '/api/activation/exchange', payload: input });
    return res.statusCode === 200 ? res.json() : { error: res.json().error };
  },
  listCanvases: async (token) => {
    const res = await cloud.app.inject({ method: 'GET', url: '/api/instance/canvases', headers: bearer(token) });
    if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
    return res.json().canvases;
  },
  listGroups: async (token) => {
    const res = await cloud.app.inject({ method: 'GET', url: '/api/instance/groups', headers: bearer(token) });
    if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
    return res.json().groups;
  },
  exportCanvas: async (token, id) => {
    const res = await cloud.app.inject({
      method: 'GET', url: `/api/instance/canvases/${id}/export`, headers: bearer(token),
    });
    if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
    return parseCanvasBundle(res.json());
  },
};

beforeAll(async () => {
  process.env.CLOUD_URL = 'http://bulut.test';
  const { sender, sent } = captureEmails();
  cloud = await buildApp(await db.fresh(), { emailSender: sender });

  const reg = await registerVerified(cloud.app, sent, {
    username: 'bulutcu', password: 'sifre123', email: 'bulutcu@t.com',
  });
  cloudCookies = reg.cookies;

  // İki kanvas: biri düğüm+kenarlı, biri bölgeli — çekmenin ikisini de taşıdığını görelim.
  const a = await createGroupCanvas(cloud.app, cloudCookies, 'Plan A');
  const b = await createGroupCanvas(cloud.app, cloudCookies, 'Plan B', a.groupId);

  // Üçüncüsü co-pronoia: grubu, türü ve ajan rolü de çekilmeli, yoksa yerelde MCP
  // paneli hiç açılmaz (anahtar üretmek bir AgentRoleDef'e bağlı).
  cpGroupId = (await cloud.app.inject({
    method: 'POST', url: '/api/groups', cookies: cloudCookies,
    payload: { name: 'Ajanlı grup', type: 'co-pronoia' },
  })).json().group.id;
  await cloud.app.inject({
    method: 'POST', url: `/api/groups/${cpGroupId}/agent-roles`, cookies: cloudCookies,
    payload: { name: 'Mimar', persona: 'Sen mimarsın.', isSupervisor: false },
  });
  await cloud.app.inject({
    method: 'POST', url: `/api/groups/${cpGroupId}/agent-roles`, cookies: cloudCookies,
    payload: { name: 'Şef', persona: 'Onaylarsın.', isSupervisor: true },
  });
  const cp = (await cloud.app.inject({
    method: 'POST', url: '/api/canvases', cookies: cloudCookies,
    payload: { name: 'CP Plan', groupId: cpGroupId, type: 'co-pronoia' },
  })).json().canvas;

  cloudCanvasIds = [a.id, b.id, cp.id];

  const state = await cloud.app.inject({ method: 'GET', url: `/api/canvases/${a.id}/state`, cookies: cloudCookies });
  const root = state.json().nodes[0].id as string;
  const ops: OpInput[] = [
    { op: 'add_node', id: 'n1', parentId: root, title: 'Görev 1', status: 'done' },
    { op: 'add_edge', id: 'e1', sourceId: root, targetId: 'n1', kind: 'dependency' },
  ];
  await cloud.app.inject({ method: 'POST', url: `/api/canvases/${a.id}/commit`, cookies: cloudCookies, payload: { ops } });
  await cloud.app.inject({
    method: 'POST', url: `/api/canvases/${b.id}/regions`, cookies: cloudCookies,
    payload: { name: 'Bölge', x: 0, y: 0, width: 100, height: 100 },
  });

  // Yerel app: mod kurulum anında sabitlenir, sonra env geri alınır.
  process.env.APP_MODE = 'local';
  local = await buildApp(await db.fresh(), { cloudClient: fakeCloudClient });
  delete process.env.APP_MODE;
}, 60000);

afterAll(async () => {
  await cloud.prisma.$disconnect();
  await local.prisma.$disconnect();
  await db.cleanup();
  delete process.env.CLOUD_URL;
}, 30000);

/** Yerel `/api/activation/start` → buluta giden URL'den state + kanıtı çıkar. */
async function startActivation() {
  const res = await local.app.inject({ method: 'GET', url: '/api/activation/start' });
  expect(res.statusCode).toBe(302);
  const url = new URL(res.headers.location as string);
  return { state: url.searchParams.get('aktivasyon')!, proof: url.searchParams.get('kanit')!, url };
}

/**
 * Yerel taraf aktive olduktan sonra `/api/activation/start` yeni state üretmez; bulut
 * tarafını tek başına sınamak için el sıkışmanın yerel yarısını elle kuruyoruz.
 */
function manualHandshake() {
  const verifier = randomBytes(16).toString('hex');
  return { state: `state-${randomBytes(6).toString('hex')}`, verifier, proof: createHash('sha256').update(verifier).digest('hex') };
}

/** Bulutta onayla → yerel callback URL'i (state + tek kullanımlık kod). */
async function approve(state: string, proof: string, redirect = 'http://yerel.test:3001') {
  const res = await cloud.app.inject({
    method: 'POST', url: '/api/activation/approve', cookies: cloudCookies,
    payload: { state, redirect, proof },
  });
  return res;
}

describe('yerel mod: aktivasyon öncesi', () => {
  it('mod ucu yerel + etkinleştirilmemiş der', async () => {
    const res = await local.app.inject({ method: 'GET', url: '/api/mode' });
    expect(res.json()).toMatchObject({ mode: 'local', activated: false, cloudUrl: 'http://bulut.test' });
  });

  it('kanvas uçları 401, hesap ve admin uçları hiç yok', async () => {
    expect((await local.app.inject({ method: 'GET', url: '/api/canvases' })).statusCode).toBe(401);
    expect((await local.app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    // Çekme el sıkışmanın parçası değil: aktive edilmemiş kurulumda kimlik kontrolüne takılır.
    expect((await local.app.inject({ method: 'POST', url: '/api/activation/pull' })).statusCode).toBe(401);
    expect(
      (await local.app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { username: 'x', password: 'sifre1', email: 'x@t.com' },
      })).statusCode,
    ).toBe(404);
    expect((await local.app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode).toBe(404);
  });

  it('bulut tarafında aktivasyon uçları var, yerelde yok (ve tersi)', async () => {
    expect((await cloud.app.inject({ method: 'GET', url: '/api/activation/start' })).statusCode).toBe(404);
    expect((await local.app.inject({ method: 'POST', url: '/api/activation/exchange', payload: {} })).statusCode).toBe(404);
    expect((await cloud.app.inject({ method: 'GET', url: '/api/mode' })).json()).toMatchObject({ mode: 'cloud' });
  });
});

describe('aktivasyon el sıkışması', () => {
  it('kanıtı bilmeyen taraf kodu kullanamaz', async () => {
    const { state, proof } = await startActivation();
    const res = await approve(state, proof);
    expect(res.statusCode).toBe(200);
    const code = new URL(res.json().redirectTo).searchParams.get('code')!;
    // Yanlış verifier ile doğrudan takas: bulut reddeder.
    const bad = await cloud.app.inject({
      method: 'POST', url: '/api/activation/exchange',
      payload: { state, code, verifier: 'yanlis-verifier' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/kanıt/i);
  });

  it('onay oturum ister, dönüş adresi http(s) olmalı', async () => {
    const { state, proof } = await startActivation();
    const anon = await cloud.app.inject({
      method: 'POST', url: '/api/activation/approve', payload: { state, redirect: 'http://yerel.test', proof },
    });
    expect(anon.statusCode).toBe(401);
    const badRedirect = await approve(state, proof, 'file:///etc/passwd');
    expect(badRedirect.statusCode).toBe(400);
  });

  it('başarılı el sıkışma: yerel kullanıcı + çalışma alanı + bulut kanvasları', async () => {
    const { state, proof } = await startActivation();
    const approved = await approve(state, proof);
    const callback = new URL(approved.json().redirectTo);
    expect(callback.pathname).toBe('/api/activation/callback');

    const done = await local.app.inject({
      method: 'GET',
      url: `/api/activation/callback${callback.search}`,
    });
    expect(done.statusCode).toBe(302);
    expect(done.headers.location).toBe('/?etkin=1&alinan=3');

    // Çerezsiz kimlik: yerelde istek atan herkes aktive edilmiş kullanıcıdır.
    const me = await local.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('bulutcu');
    expect((await local.app.inject({ method: 'GET', url: '/api/mode' })).json().activated).toBe(true);

    // Aktive kullanıcı bile olsa site yönetimi yerelde yok.
    expect((await local.app.inject({ method: 'GET', url: '/api/admin/stats' })).statusCode).toBe(404);

    const groups = await local.app.inject({ method: 'GET', url: '/api/groups' });
    expect(groups.json().groups.map((g: { name: string }) => g.name)).toContain('Yerel çalışma alanı');

    const canvases = (await local.app.inject({ method: 'GET', url: '/api/canvases' })).json().canvases;
    expect(canvases.map((c: { name: string }) => c.name).sort()).toEqual(['CP Plan', 'Plan A', 'Plan B']);

    // İçerik gerçekten taşındı mı: A'da kök + n1 + kenar, B'de bölge.
    const planA = canvases.find((c: { name: string }) => c.name === 'Plan A')!;
    const stateA = (await local.app.inject({ method: 'GET', url: `/api/canvases/${planA.id}/state` })).json();
    expect(stateA.nodes).toHaveLength(2);
    expect(stateA.edges).toHaveLength(1);
    const planB = canvases.find((c: { name: string }) => c.name === 'Plan B')!;
    const regions = (await local.app.inject({ method: 'GET', url: `/api/canvases/${planB.id}/regions` })).json();
    expect(regions.regions).toHaveLength(1);
  });

  it('kod tek kullanımlıktır ve ikinci aktivasyon reddedilir', async () => {
    // Yerel taraf artık aktive olduğu için el sıkışmayı bulutta elle kuruyoruz.
    const { state, proof } = manualHandshake();
    const approved = await approve(state, proof);
    const code = new URL(approved.json().redirectTo).searchParams.get('code')!;
    // Aynı state ile tekrar onay: bulut ikinci Instance satırını yazmaz.
    expect((await approve(state, proof)).statusCode).toBe(400);

    // Yerel taraf zaten aktive: callback aktivasyonu değiştirmez.
    const again = await local.app.inject({
      method: 'GET', url: `/api/activation/callback?state=${state}&code=${code}`,
    });
    expect(again.statusCode).toBe(302);
    expect(again.headers.location).toContain('aktivasyon_hata');
    expect((await local.app.inject({ method: 'GET', url: '/api/auth/me' })).json().user.username).toBe('bulutcu');
  });

  it('tekrar çekmede yeni kanvas gelmez', async () => {
    const res = await local.app.inject({ method: 'POST', url: '/api/activation/pull' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imported: 0, skipped: 3 });
    const canvases = (await local.app.inject({ method: 'GET', url: '/api/canvases' })).json().canvases;
    expect(canvases).toHaveLength(3);
    // Gruplar da ikinci kez kurulmaz (CloudGroupImport eşlemesi).
    expect(res.json().groups).toEqual([]);
  });

  it('gruplar, kanvas türleri ve ajan rolleri de çekilir — yerelde MCP anahtarı üretilebilir', async () => {
    const groups = (await local.app.inject({ method: 'GET', url: '/api/groups' })).json().groups;
    const byName = Object.fromEntries(groups.map((g: { name: string; type: string; id: string }) => [g.name, g]));

    // Bulut grupları adıyla ve TÜRÜYLE yansıtıldı; hepsi tek çalışma alanına yığılmadı.
    expect(byName['Ajanlı grup']?.type).toBe('co-pronoia');
    expect(byName['Plan A grubu']?.type).toBe('plan');

    const canvases = (await local.app.inject({ method: 'GET', url: '/api/canvases' })).json().canvases;
    const cp = canvases.find((c: { name: string }) => c.name === 'CP Plan')!;
    const planA = canvases.find((c: { name: string }) => c.name === 'Plan A')!;
    // Kanvas türü korundu ve kanvas kendi grubuna indi.
    expect(cp.type).toBe('co-pronoia');
    expect(cp.groupId).toBe(byName['Ajanlı grup'].id);
    expect(planA.type).toBe('plan');
    expect(planA.groupId).toBe(byName['Plan A grubu'].id);

    // Grup kapsamlı ajan rolleri de geldi (süpervizör bayrağı dahil).
    const roles = (await local.app.inject({
      method: 'GET', url: `/api/groups/${byName['Ajanlı grup'].id}/agent-roles`,
    })).json().roles;
    expect(roles.map((r: { name: string }) => r.name).sort()).toEqual(['Mimar', 'Şef']);
    expect(roles.find((r: { name: string }) => r.name === 'Şef').isSupervisor).toBe(true);

    // Asıl kazanım: çekilen kanvasta yerelde MCP anahtarı üretilebiliyor. Rol ya da tür
    // taşınmasaydı bu istek 400 dönerdi ve yerel kurulumda MCP hiç kullanılamazdı.
    const mint = await local.app.inject({
      method: 'POST', url: `/api/canvases/${cp.id}/agent-tokens`,
      payload: { roleIds: roles.map((r: { id: string }) => r.id), label: 'yerel-ajan' },
    });
    expect(mint.statusCode).toBe(200);
    expect(mint.json().secret).toMatch(/^tma_/);
    expect(mint.json().token.roles.map((r: { name: string }) => r.name).sort()).toEqual(['Mimar', 'Şef']);
  });

  it('davet ve üyelik yüzeyi yerel modda hiç yok; bölgeler ve MCP çalışmaya devam eder', async () => {
    const canvases = (await local.app.inject({ method: 'GET', url: '/api/canvases' })).json().canvases;
    const planA = canvases.find((c: { name: string }) => c.name === 'Plan A')!;
    const groups = (await local.app.inject({ method: 'GET', url: '/api/groups' })).json().groups;
    const g = groups.find((x: { name: string }) => x.name === 'Plan A grubu')!;

    const gone: [string, string][] = [
      ['POST', `/api/canvases/${planA.id}/invites`],
      ['GET', `/api/canvases/${planA.id}/members`],
      ['GET', `/api/canvases/${planA.id}/role-access`],
      ['GET', '/api/invites/herhangi-bir-token'],
      ['GET', '/api/group-invites/herhangi-bir-token'],
      ['GET', `/api/groups/${g.id}/members`],
      ['POST', `/api/groups/${g.id}/invites`],
      ['GET', `/api/groups/${g.id}/roles`],
    ];
    for (const [method, url] of gone) {
      const res = await local.app.inject({ method: method as 'GET' | 'POST', url, payload: {} });
      expect(`${method} ${url} → ${res.statusCode}`).toBe(`${method} ${url} → 404`);
    }

    // Bölgeler ve ajan rolleri KALIR: MCP için işlevseller.
    expect((await local.app.inject({ method: 'GET', url: `/api/canvases/${planA.id}/regions` })).statusCode).toBe(200);
    expect((await local.app.inject({ method: 'GET', url: `/api/groups/${g.id}/agent-roles` })).statusCode).toBe(200);
  });

  it('yerleşik Gemini ajan ucu yerel modda hiç register edilmez (404), diğer uçlar çalışmaya devam eder', async () => {
    const canvases = (await local.app.inject({ method: 'GET', url: '/api/canvases' })).json().canvases;
    const planA = canvases.find((c: { name: string }) => c.name === 'Plan A')!;
    const agentRes = await local.app.inject({
      method: 'POST', url: `/api/canvases/${planA.id}/agent`, payload: { prompt: 'merhaba' },
    });
    expect(agentRes.statusCode).toBe(404);
    // Aynı kanvasta normal uçlar üye kontrolünden geçip çalışıyor olmalı (route grubu bozulmadı).
    expect((await local.app.inject({ method: 'GET', url: `/api/canvases/${planA.id}/state` })).statusCode).toBe(200);
  });
});

describe('bulut tarafı kurulum uçları', () => {
  it('geçersiz anahtar 401, geçerli anahtar yalnızca kendi kanvaslarını okur', async () => {
    expect(
      (await cloud.app.inject({ method: 'GET', url: '/api/instance/canvases', headers: bearer('tmi_yok') })).statusCode,
    ).toBe(401);

    // Yerel kurulumun aldığı gerçek anahtarla oku.
    const activation = await local.prisma.activation.findFirst();
    const token = activation!.instanceToken!;
    const list = await cloud.app.inject({ method: 'GET', url: '/api/instance/canvases', headers: bearer(token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().canvases.map((c: { id: string }) => c.id).sort()).toEqual([...cloudCanvasIds].sort());

    // Üyesi olunmayan / var olmayan kanvas → 404.
    const missing = await cloud.app.inject({
      method: 'GET', url: '/api/instance/canvases/yok-boyle-kanvas/export', headers: bearer(token),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('süresi geçmiş kod takas edilemez', async () => {
    const { state, proof } = manualHandshake();
    const approved = await approve(state, proof);
    const code = new URL(approved.json().redirectTo).searchParams.get('code')!;
    await cloud.prisma.instance.update({ where: { state }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await cloud.app.inject({
      method: 'POST', url: '/api/activation/exchange', payload: { state, code, verifier: 'ne-olursa' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/süre/i);
  });
});

/**
 * EN SONDA olmalı: aktivasyonu geri alır, yani yukarıdaki testlerin dayandığı
 * "yerel kurulum aktive" durumunu bozar.
 */
describe('bağlantıyı kaldırma (yerel modun çıkışı)', () => {
  it('reset kurulumu aktivasyon ekranına döndürür; veri kalır ve aynı hesapla geri gelinir', async () => {
    const before = (await local.app.inject({ method: 'GET', url: '/api/canvases' })).json().canvases.length;
    expect(before).toBeGreaterThan(0);

    const res = await local.app.inject({ method: 'POST', url: '/api/activation/reset', payload: {} });
    expect(res.statusCode).toBe(200);

    // Artık etkin değil: kimlik yok, her /api 401 ve mod ucu bunu söylüyor.
    expect((await local.app.inject({ method: 'GET', url: '/api/mode' })).json().activated).toBe(false);
    expect((await local.app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await local.app.inject({ method: 'GET', url: '/api/canvases' })).statusCode).toBe(401);
    // İkinci reset route'a hiç ulaşmaz: aktive olmayan kurulumda global hook 401 verir.
    expect((await local.app.inject({ method: 'POST', url: '/api/activation/reset', payload: {} })).statusCode).toBe(401);

    // Aynı bulut hesabıyla yeniden bağlan: veri yerinde, kanvaslar tekrar alınmaz.
    const { state, proof } = await startActivation();
    const approved = await approve(state, proof);
    const callback = new URL(approved.json().redirectTo);
    const done = await local.app.inject({ method: 'GET', url: `/api/activation/callback${callback.search}` });
    expect(done.statusCode).toBe(302);
    expect((await local.app.inject({ method: 'GET', url: '/api/mode' })).json().activated).toBe(true);
    const after = (await local.app.inject({ method: 'GET', url: '/api/canvases' })).json().canvases;
    expect(after).toHaveLength(before);
  });

  it('wipe:true yerel veriyi de siler; yeniden bağlanınca kanvaslar sıfırdan çekilir', async () => {
    const res = await local.app.inject({
      method: 'POST', url: '/api/activation/reset', payload: { wipe: true },
    });
    expect(res.statusCode).toBe(200);
    // Kullanıcı gitti → kanvaslar/gruplar cascade ile gitti, eşleme tabloları boşaldı.
    expect(await local.prisma.canvas.count()).toBe(0);
    expect(await local.prisma.cloudImport.count()).toBe(0);
    expect(await local.prisma.cloudGroupImport.count()).toBe(0);

    const { state, proof } = await startActivation();
    const approved = await approve(state, proof);
    const callback = new URL(approved.json().redirectTo);
    const done = await local.app.inject({ method: 'GET', url: `/api/activation/callback${callback.search}` });
    // Eşleme boşaldığı için üç kanvas da yeniden alınır.
    expect(done.headers.location).toBe('/?etkin=1&alinan=3');
    expect((await local.app.inject({ method: 'GET', url: '/api/canvases' })).json().canvases).toHaveLength(3);
  });
});
