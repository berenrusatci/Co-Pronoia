import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { captureEmails, registerVerified } from './testAuth.js';

let db: ReturnType<typeof testDbFactory>;
beforeAll(() => {
  db = testDbFactory();
});

const opened: Array<{ prisma: { $disconnect(): Promise<void> } }> = [];
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

let rpcId = 0;
async function rpc(app: App, secret: string, method: string, params?: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${secret}`,
    },
    payload: { jsonrpc: '2.0', id: ++rpcId, method, params: params ?? {} },
  });
}

/** tools/call → JSON döndüren araçlar için parse edilmiş sonuç + isError. */
async function callTool(app: App, secret: string, name: string, args?: unknown) {
  const res = await rpc(app, secret, 'tools/call', { name, arguments: args ?? {} });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const result = body.result as { content?: { text: string }[]; isError?: boolean };
  const text = result.content?.[0]?.text ?? '';
  let data: any = undefined;
  try { data = JSON.parse(text); } catch { /* düz metin */ }
  return { text, data, isError: result.isError === true };
}

/** Co-pronoia kanvas + iki işçi + bir süpervizör anahtarı + owner cookie'si. */
async function setup() {
  const ctx = await fresh();
  const { app, sent } = ctx;
  const { cookies } = await registerVerified(app, sent, { username: 'sahip', password: 'sifre1guclu', email: 's@t.com' });
  const groupId = (await app.inject({
    method: 'POST', url: '/api/groups', cookies, payload: { name: 'CP', type: 'co-pronoia' },
  })).json().group.id as string;
  const canvasId = (await app.inject({
    method: 'POST', url: '/api/canvases', cookies, payload: { name: 'Plan', groupId, type: 'co-pronoia' },
  })).json().canvas.id as string;
  const mkRole = async (name: string, isSupervisor: boolean) =>
    (await app.inject({
      method: 'POST', url: `/api/groups/${groupId}/agent-roles`, cookies,
      payload: { name, persona: `${name}.`, isSupervisor },
    })).json().role.id as string;
  const workerRole = await mkRole('İşçi', false);
  const supRole = await mkRole('Süpervizör', true);
  const mint = async (roleId: string, label: string) =>
    (await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/agent-tokens`, cookies, payload: { roleId, label },
    })).json().secret as string;
  const a = await mint(workerRole, 'ajan-a');
  const b = await mint(workerRole, 'ajan-b');
  const sup = await mint(supRole, 'süper');
  const headSeq = async () =>
    (await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/state`, cookies })).json().headSeq as number;
  const commit = (ops: unknown[], baseSeq: number) =>
    app.inject({ method: 'POST', url: `/api/canvases/${canvasId}/commit`, cookies, payload: { ops, baseSeq } });
  return { app, cookies, canvasId, a, b, sup, headSeq, commit };
}

describe('Yumuşak claim/lease (pl1)', () => {
  it('claim çakışması: aynı bölgeyi ikinci ajan alamaz, bırakınca alabilir', async () => {
    const { app, sup, a, b } = await setup();
    const region = (await callTool(app, sup, 'create_region', {
      name: 'Alan-1', x: 0, y: 0, width: 500, height: 500,
    })).data as { id: string };

    const c1 = await callTool(app, a, 'claim_region', { regionId: region.id, ttlSec: 300 });
    expect(c1.data.ok).toBe(true);
    const claimId = c1.data.claim.id as string;

    // B aynı bölgeyi claim edemez → conflict (hata değil).
    const c2 = await callTool(app, b, 'claim_region', { regionId: region.id });
    expect(c2.isError).toBe(false);
    expect(c2.data.conflict).toBe(true);
    expect(c2.data.heldBy).toContain('ajan-a');

    // A bırakınca B alabilir.
    const rel = await callTool(app, a, 'release_claim', { claimId });
    expect(rel.data.ok).toBe(true);
    const c3 = await callTool(app, b, 'claim_region', { regionId: region.id });
    expect(c3.data.ok).toBe(true);
  });

  it('list_claims + HTTP /claims + sahip zorla düşürme', async () => {
    const { app, cookies, canvasId, sup, a } = await setup();
    const region = (await callTool(app, sup, 'create_region', {
      name: 'Alan-2', x: 0, y: 0, width: 300, height: 300,
    })).data as { id: string };
    await callTool(app, a, 'claim_region', { regionId: region.id });

    const listed = await callTool(app, a, 'list_claims');
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0].regionName).toBe('Alan-2');

    const http = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/claims`, cookies });
    expect(http.json().claims).toHaveLength(1);
    const id = http.json().claims[0].id as string;

    const del = await app.inject({ method: 'DELETE', url: `/api/canvases/${canvasId}/claims/${id}`, cookies });
    expect(del.statusCode).toBe(200);
    expect(del.json().claims).toHaveLength(0);
  });

  it('submit_proposal, başka ajanın claim ettiği düğüme dokununca uyarır (bloklamaz)', async () => {
    const { app, sup, a, b, headSeq, commit } = await setup();
    const region = (await callTool(app, sup, 'create_region', {
      name: 'Alan-3', x: 0, y: 0, width: 400, height: 400,
    })).data as { id: string };
    // Bölgenin İÇİNE bir düğüm koy (owner commit).
    const res = await commit([{ op: 'add_node', id: 'n-in', title: 'İçerideki', x: 100, y: 100 }], await headSeq());
    expect(res.statusCode).toBe(200);

    await callTool(app, a, 'claim_region', { regionId: region.id });

    const hs = await headSeq();
    const sub = await callTool(app, b, 'submit_proposal', {
      title: 'B önerisi', baseSeq: hs,
      intents: [{ op: 'update_node', id: 'n-in', fields: { title: 'B değiştirdi' } }],
    });
    expect(sub.isError).toBe(false);
    expect(sub.data.id).toBeTruthy(); // öneri yine kaydedildi
    expect(sub.data.claimWarnings).toHaveLength(1);
    expect(sub.data.claimWarnings[0].heldBy).toContain('ajan-a');
    expect(sub.data.claimWarnings[0].overlap).toContain('n-in');
  });

  it('geçersiz argüman ve oran sınırı reddedilir', async () => {
    const { app, a } = await setup();
    // Ne region ne nodes → hata.
    const bad = await callTool(app, a, 'claim_region', {});
    expect(bad.isError).toBe(true);
    // nodes claim'i (bölgesiz) çalışır.
    const ok = await callTool(app, a, 'claim_region', { nodeIds: ['x1', 'x2'], ttlSec: 60 });
    expect(ok.data.ok).toBe(true);

    // Oran sınırı: 60 sn'de >30 yazma çağrısı → sonuncusu hata.
    let limited = false;
    for (let i = 0; i < 32; i++) {
      const r = await callTool(app, a, 'claim_region', { nodeIds: [`y${i}`] });
      if (r.isError && r.text.includes('çok sık')) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
});
