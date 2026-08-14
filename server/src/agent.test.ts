import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { createCanvas, createRegion } from './canvasService.js';
import { captureEmails, createGroupCanvas, registerVerified } from './testAuth.js';
import { runAgent, type Llm } from './agent.js';
import type { Actor } from './commitService.js';

let db: ReturnType<typeof testDbFactory>;
beforeAll(() => {
  db = testDbFactory();
});

const opened: Array<{ prisma: { $disconnect(): Promise<void> } }> = [];
// Her test kendi buildApp'ini açar; havuzlar dosya sonuna dek bekletilirse
// Postgres max_connections dolar — bu yüzden test biter bitmez kapatılırlar.
afterEach(async () => {
  for (const { prisma } of opened.splice(0)) await prisma.$disconnect();
});
afterAll(async () => {
  await db.cleanup();
}, 30000);

async function freshCanvas() {
  const built = await buildApp(await db.fresh());
  opened.push(built);
  const owner = await built.prisma.user.create({ data: { username: 'owner', passwordHash: 'x' } });
  const canvas = await createCanvas(built.prisma, built.serviceFor, 'Test', owner.id, { seedRoot: false });
  const service = built.serviceFor(canvas.id);
  await service.commit([{ op: 'add_node', id: 'root', title: 'Kök' }]);
  const actor: Actor = { userId: owner.id, role: 'owner' };
  const run = (
    llm: Llm,
    actorOverride?: Actor,
    detail?: 'proto' | 'detailed',
    selectedIds?: string[],
    selectedRegionIds?: string[],
  ) =>
    runAgent({
      prisma: built.prisma, service, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'test isteği', actor: actorOverride ?? actor, llm,
      ...(detail ? { detail } : {}),
      ...(selectedIds ? { selectedIds } : {}),
      ...(selectedRegionIds ? { selectedRegionIds } : {}),
    });
  return { ...built, service, canvas, owner, actor, run };
}

const asLlm = (payload: unknown): Llm => async () => JSON.stringify(payload);

/** Gruba bağlı kanvas + serviceFor geçirilen run: alt kanvas (newSubCanvases) testleri için. */
async function freshGroupCanvas(type: 'plan' | 'co-pronoia' = 'plan') {
  const built = await buildApp(await db.fresh());
  opened.push(built);
  const owner = await built.prisma.user.create({ data: { username: 'owner', passwordHash: 'x' } });
  const group = await built.prisma.group.create({
    data: { name: 'Ekip', type, members: { create: { userId: owner.id, role: 'admin', status: 'approved' } } },
  });
  const canvas = await createCanvas(built.prisma, built.serviceFor, 'Test', owner.id, {
    seedRoot: false, groupId: group.id, type,
  });
  const service = built.serviceFor(canvas.id);
  await service.commit([{ op: 'add_node', id: 'root', title: 'Kök' }]);
  const actor: Actor = { userId: owner.id, role: 'owner' };
  const run = (llm: Llm, actorOverride?: Actor) =>
    runAgent({
      prisma: built.prisma, service, serviceFor: built.serviceFor, canvasId: canvas.id,
      canvasName: canvas.name, prompt: 'test isteği', actor: actorOverride ?? actor, llm,
    });
  return { ...built, service, canvas, group, owner, actor, run };
}

describe('agent', () => {
  it('commits diagram ops as a single commit', async () => {
    const { service, run } = await freshCanvas();
    const result = await run(asLlm({
      mode: 'diagram',
      reply: 'İki düğüm ekledim.',
      message: 'auth akışı',
      ops: [
        { op: 'add_node', id: 'ai-1', parentId: 'root', title: 'Kayıt' },
        { op: 'add_node', id: 'ai-2', parentId: 'root', title: 'Giriş' },
        { op: 'add_edge', sourceId: 'ai-1', targetId: 'ai-2', kind: 'flow' },
      ],
    }));
    expect(result.committed).toBe(true);
    expect(result.opCount).toBe(3);
    const state = await service.getState();
    expect(state.nodes.map((n) => n.id).sort()).toEqual(['ai-1', 'ai-2', 'root']);
    expect((await service.getCommit(result.commitSeq!))!.message).toBe('ajan: auth akışı');
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('summary mode never commits, even if ops sneak in', async () => {
    const { service, run } = await freshCanvas();
    const result = await run(asLlm({
      mode: 'summary',
      reply: 'Kanvasta 1 düğüm var.',
      ops: [{ op: 'add_node', id: 'x', title: 'X' }],
    }));
    expect(result.committed).toBe(false);
    expect(result.reply).toBe('Kanvasta 1 düğüm var.');
    expect((await service.getState()).headSeq).toBe(1);
  });

  it('falls back to plain-text reply when the model does not return JSON', async () => {
    const { run } = await freshCanvas();
    const result = await run(async () => 'düz metin yanıtı');
    expect(result.committed).toBe(false);
    expect(result.reply).toBe('düz metin yanıtı');
  });

  it('repairs JSON with a missing closing brace', async () => {
    const { run } = await freshCanvas();
    const result = await run(async () => '{\n  "mode": "summary",\n  "reply": "Tek düğüm var."');
    expect(result.committed).toBe(false);
    expect(result.reply).toBe('Tek düğüm var.');
  });

  it('refuses writes for viewers but keeps the reply', async () => {
    const { prisma, service, run } = await freshCanvas();
    const viewer = await prisma.user.create({ data: { username: 'izleyici', passwordHash: 'x' } });
    const result = await run(
      asLlm({ mode: 'diagram', reply: 'Düğüm eklerdim.', ops: [{ op: 'add_node', id: 'v1', title: 'V' }] }),
      { userId: viewer.id, role: 'viewer' },
    );
    expect(result.committed).toBe(false);
    expect(result.reply).toContain('viewer');
    expect((await service.getState()).headSeq).toBe(1);
  });

  it('agent route validates prompt and requires GEMINI_API_KEY over HTTP', async () => {
    const { sender, sent } = captureEmails();
    const built = await buildApp(await db.fresh(), { emailSender: sender });
    opened.push(built);
    const { app } = built;
    const { cookies } = await registerVerified(app, sent, { username: 'beren', password: 'sifre1', email: 'b@test.com' });
    const canvasId = (await createGroupCanvas(app, cookies, 'Plan')).id as string;

    let res = await app.inject({ method: 'POST', url: `/api/canvases/${canvasId}/agent`, cookies, payload: {} });
    expect(res.statusCode).toBe(400);

    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      res = await app.inject({
        method: 'POST', url: `/api/canvases/${canvasId}/agent`, cookies, payload: { prompt: 'özetle' },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
    }
  });

  /**
   * Maliyet/DoS kapısı: uç kanvas üyesi olan herkese açık ve her istek bir ya da daha
   * çok Gemini çağrısı doğuruyor. Uzunluk sınırı ve oran sınırı model çağrısından ÖNCE
   * çalışmalı — 503 (anahtar yok) kontrolüne bile gelmeden reddedilmeli.
   */
  it('ajan ucu prompt uzunluğunu ve çağrı oranını sınırlar', async () => {
    const { sender, sent } = captureEmails();
    const built = await buildApp(await db.fresh(), { emailSender: sender });
    opened.push(built);
    const { app } = built;
    const { cookies } = await registerVerified(app, sent, { username: 'kotaci', password: 'sifre1', email: 'k@test.com' });
    const canvasId = (await createGroupCanvas(app, cookies, 'Plan')).id as string;
    const call = (prompt: string) =>
      app.inject({ method: 'POST', url: `/api/canvases/${canvasId}/agent`, cookies, payload: { prompt } });

    const uzun = await call('a'.repeat(8_001));
    expect(uzun.statusCode).toBe(400);
    expect(uzun.json().error).toMatch(/çok uzun/i);

    // GEMINI_API_KEY yokken bile oran sınırı önce devreye girer: ilk 8 istek 503'e
    // (yapılandırma) düşer, 9.'su 429 olur — yani model çağrısına hiç gelinmez.
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const kodlar: number[] = [];
      for (let i = 0; i < 9; i++) kodlar.push((await call('özetle')).statusCode);
      expect(kodlar.slice(0, 8)).toEqual(Array(8).fill(503));
      expect(kodlar[8]).toBe(429);
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
    }
  });

  it('threads detail level and the caller permissions into the prompts', async () => {
    const { prisma, canvas, run } = await freshCanvas();
    const editor = await prisma.user.create({ data: { username: 'derya', passwordHash: 'x' } });
    await prisma.region.create({
      data: {
        canvasId: canvas.id, name: 'backend', x: 0, y: 0, width: 500, height: 400,
        members: { create: [{ userId: editor.id }] },
      },
    });
    await prisma.region.create({
      data: { canvasId: canvas.id, name: 'frontend', x: 600, y: 0, width: 500, height: 400 },
    });

    let system = '';
    let user = '';
    const capture: Llm = async (s, u) => {
      system = s;
      user = u;
      return JSON.stringify({ mode: 'summary', reply: 'ok' });
    };

    await run(capture, { userId: editor.id, role: 'editor' }, 'detailed');
    expect(system).toContain('DETAY DÜZEYİ: DETAYLI');
    expect(user).toContain('KULLANICININ YETKİSİ: rol: editor. Yazabildiği bölgeler: "backend"');

    await run(capture);
    expect(system).toContain('DETAY DÜZEYİ: PROTOTİP');
    expect(user).toContain('Yazabildiği bölgeler: HEPSİ');
  });

  it('threads a selected region: its description and every node inside it', async () => {
    const { prisma, service, canvas, run } = await freshCanvas();
    const region = await prisma.region.create({
      data: {
        canvasId: canvas.id, name: 'backend', x: 0, y: 0, width: 500, height: 400,
        description: 'Sunucu tarafı işleri.',
      },
    });
    await service.commit([
      { op: 'add_node', id: 'in1', title: 'İç 1', x: 50, y: 50 },   // bölge içinde
      { op: 'add_node', id: 'in2', title: 'İç 2', x: 60, y: 60 },   // bölge içinde
      { op: 'add_node', id: 'out', title: 'Dış', x: 900, y: 900 },  // bölge dışında
    ]);

    let user = '';
    const capture: Llm = async (_s, u) => {
      user = u;
      return JSON.stringify({ mode: 'summary', reply: 'ok' });
    };
    await run(capture, undefined, undefined, undefined, [region.id]);

    expect(user).toContain('SEÇİLİ BÖLGELER');
    expect(user).toContain('Sunucu tarafı işleri.');
    expect(user).toContain('SEÇİLİ DÜĞÜMLER');
    expect(user).toContain('"id":"in1"');
    expect(user).toContain('"id":"in2"');
    // Bölge dışındaki düğüm seçime dahil değil.
    const selectedBlock = user.slice(user.indexOf('SEÇİLİ DÜĞÜMLER'));
    expect(selectedBlock).not.toContain('"id":"out"');
  });

  it('threads selected nodes into the prompt, ignoring unknown ids', async () => {
    const { run } = await freshCanvas();
    let user = '';
    const capture: Llm = async (_s, u) => {
      user = u;
      return JSON.stringify({ mode: 'summary', reply: 'ok' });
    };
    await run(capture, undefined, undefined, ['root', 'olmayan-id']);
    expect(user).toContain('SEÇİLİ DÜĞÜMLER');
    expect(user).toContain('{"id":"root","title":"Kök"}');
    expect(user).not.toContain('olmayan-id');

    await run(capture);
    expect(user).not.toContain('SEÇİLİ DÜĞÜMLER');
  });

  it('drops ops that touch an AI-closed region, keeps the rest, and notes it', async () => {
    const { prisma, service, canvas, run } = await freshCanvas();
    await prisma.region.create({
      data: { canvasId: canvas.id, name: 'gizli', x: 0, y: 0, width: 500, height: 400, aiAllowed: false },
    });
    const result = await run(asLlm({
      mode: 'diagram',
      reply: 'İki düğüm ekledim.',
      message: 'karışık',
      ops: [
        { op: 'add_node', id: 'inside', title: 'İç', x: 100, y: 100 },   // AI'ya kapalı bölgede → atlanır
        { op: 'add_node', id: 'outside', title: 'Dış', x: 800, y: 100 }, // serbest → uygulanır
      ],
    }));
    expect(result.committed).toBe(true);
    expect(result.opCount).toBe(1);
    expect(result.reply).toContain('gizli');
    const ids = (await service.getState()).nodes.map((n) => n.id);
    expect(ids).toContain('outside');
    expect(ids).not.toContain('inside');
  });

  it('threads AI-closed regions and descriptions into the prompt', async () => {
    const { prisma, canvas, run } = await freshCanvas();
    await prisma.region.create({
      data: {
        canvasId: canvas.id, name: 'gizli', x: 0, y: 0, width: 500, height: 400,
        aiAllowed: false, description: 'Bu bölge yalnızca güvenlik ekibi içindir.',
      },
    });
    let user = '';
    const capture: Llm = async (_s, u) => {
      user = u;
      return JSON.stringify({ mode: 'summary', reply: 'ok' });
    };
    await run(capture);
    expect(user).toContain("AI'YA KAPALI bölgeler");
    expect(user).toContain('"gizli"');
    expect(user).toContain('Bu bölge yalnızca güvenlik ekibi içindir.');
  });

  it('layout mode dumps the mind-map hierarchy into the flow as one commit', async () => {
    const { prisma, service, canvas, run } = await freshCanvas();
    await prisma.region.create({
      data: { canvasId: canvas.id, name: 'alan', x: 0, y: 0, width: 600, height: 500 },
    });
    // p1 → p2 hierarchy, both positioned inside "alan"; no flow edge exists between them yet.
    await service.commit([
      { op: 'add_node', id: 'p1', title: 'P1', x: 50, y: 50 },
      { op: 'add_node', id: 'p2', parentId: 'p1', title: 'P2', x: 60, y: 60 },
    ]);

    const result = await run(asLlm({ mode: 'layout', reply: 'Zihin haritasını akışa döktüm.' }));
    expect(result.committed).toBe(true);
    const state = await service.getState();
    expect(state.edges.some((e) => e.sourceId === 'p1' && e.targetId === 'p2' && e.kind === 'flow')).toBe(true);
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('layout mode skips nodes inside an AI-closed region and notes it', async () => {
    const { prisma, service, canvas, run } = await freshCanvas();
    await prisma.region.create({
      data: { canvasId: canvas.id, name: 'gizli', x: 0, y: 0, width: 600, height: 500, aiAllowed: false },
    });
    await service.commit([
      { op: 'add_node', id: 'g1', title: 'G1', x: 50, y: 50 },
      { op: 'add_node', id: 'g2', parentId: 'g1', title: 'G2', x: 60, y: 60 },
    ]);

    const result = await run(asLlm({ mode: 'layout', reply: 'Akışa döktüm.' }));
    expect(result.reply).toContain('gizli');
    // The AI-closed region's nodes keep their original coordinates and get no hierarchy edge.
    const state = await service.getState();
    expect(state.nodes.find((n) => n.id === 'g1')).toMatchObject({ x: 50, y: 50 });
    expect(state.edges.some((e) => e.sourceId === 'g1' && e.targetId === 'g2')).toBe(false);
  });

  it('stepwise mode: each part is its own llm call and its own commit, connected to the previous', async () => {
    const { prisma, service, canvas, actor } = await freshCanvas();
    const calls: Array<{ system: string; user: string }> = [];
    const llm: Llm = async (system, user) => {
      calls.push({ system, user });
      if (calls.length === 1) {
        return JSON.stringify({
          mode: 'diagram', reply: 'İlk parça hazır.', message: 'plan',
          ops: [
            { op: 'add_node', id: 'p1a', title: 'P1-A' },
            { op: 'add_node', id: 'p1b', title: 'P1-B' },
            { op: 'add_edge', sourceId: 'p1a', targetId: 'p1b', kind: 'flow' },
          ],
          parts: ['İkinci parça'],
        });
      }
      return JSON.stringify({
        mode: 'diagram', reply: 'İkinci parça hazır.', message: 'devam',
        ops: [
          { op: 'add_node', id: 'p2a', title: 'P2-A' },
          { op: 'add_edge', sourceId: 'p1b', targetId: 'p2a', kind: 'flow' },
        ],
      });
    };
    const outcomes: string[] = [];
    const result = await runAgent({
      prisma, service, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'büyük plan', actor, llm, detail: 'detailed', stepwise: true,
      onOutcome: (o) => outcomes.push(o.result),
    });

    expect(calls).toHaveLength(2);
    // Parça parça bir üretim biçimidir; detay düzeyi (model seçimiyle birlikte) kullanıcının seçtiği gibi kalır.
    expect(calls[0].system).toContain('DETAY DÜZEYİ: DETAYLI');
    expect(calls[0].system).toContain('ÜRETİM BİÇİMİ: PARÇA PARÇA');
    expect(calls[1].user).toContain('ŞİMDİKİ PARÇA (2/2): "İkinci parça"');
    // İkinci çağrı taze durumu görür: ilk parçanın düğümleri DÜĞÜMLER listesinde.
    expect(calls[1].user).toContain('"id":"p1a"');

    expect(result.committed).toBe(true);
    expect(result.opCount).toBe(5);
    expect(outcomes).toEqual(['committed', 'committed']);
    expect(result.reply).toContain('İlk parça hazır.');
    expect(result.reply).toContain('İkinci parça hazır.');

    const state = await service.getState();
    expect(state.nodes.map((n) => n.id).sort()).toEqual(['p1a', 'p1b', 'p2a', 'root']);
    expect(state.edges.some((e) => e.sourceId === 'p1b' && e.targetId === 'p2a')).toBe(true);
    expect((await service.getCommit(result.commitSeq!))!.message).toBe('ajan: İkinci parça (parça 2/2)');
    expect((await service.getCommit(result.commitSeq! - 1))!.message).toBe('ajan: plan (parça 1/2)');
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('stepwise mode: a failing part stops the loop but keeps earlier commits', async () => {
    const { prisma, service, canvas, actor } = await freshCanvas();
    let callCount = 0;
    const llm: Llm = async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          mode: 'diagram', reply: 'İlk parça.', message: 'başlangıç',
          ops: [{ op: 'add_node', id: 'ok1', title: 'Sağlam' }],
          parts: ['Bozuk parça', 'Üçüncü parça'],
        });
      }
      return JSON.stringify({
        mode: 'diagram', reply: 'Bozuk.', message: 'bozuk',
        ops: [{ op: 'add_node', id: 'bad1', parentId: 'yok-boyle-dugum', title: 'Bozuk' }],
      });
    };
    const result = await runAgent({
      prisma, service, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'plan', actor, llm, stepwise: true,
    });

    expect(callCount).toBe(2); // üçüncü parçaya hiç geçilmedi
    expect(result.committed).toBe(true); // ilk parça kanvasta duruyor
    expect(result.error).toBeTruthy();
    expect(result.reply).toContain('uygulanamadı');
    const ids = (await service.getState()).nodes.map((n) => n.id);
    expect(ids).toContain('ok1');
    expect(ids).not.toContain('bad1');
  });

  it('ignores parts when stepwise is off', async () => {
    const { service, run } = await freshCanvas();
    let callCount = 0;
    const llm: Llm = async () => {
      callCount++;
      return JSON.stringify({
        mode: 'diagram', reply: 'Tamam.', message: 'tek atım',
        ops: [{ op: 'add_node', id: 'd1', title: 'D' }],
        parts: ['Fazladan parça'],
      });
    };
    const result = await run(llm, undefined, 'detailed');
    expect(callCount).toBe(1);
    expect(result.committed).toBe(true);
    expect((await service.getCommit(result.commitSeq!))!.message).toBe('ajan: tek atım');
  });

  it('stepwise mode: caps the part list and skips parts that produce no ops', async () => {
    const { prisma, service, canvas, actor } = await freshCanvas();
    let callCount = 0;
    const llm: Llm = async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          mode: 'diagram', reply: 'İlk.', message: 'ilk',
          ops: [{ op: 'add_node', id: 'n1', title: 'N1' }],
          parts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], // 5'e kırpılmalı
        });
      }
      if (callCount === 2) {
        // Op üretmeyen parça atlanır, döngü devam eder.
        return JSON.stringify({ mode: 'summary', reply: 'Bu parçada iş yok.' });
      }
      return JSON.stringify({
        mode: 'diagram', reply: `Parça ${callCount}.`, message: `p${callCount}`,
        ops: [{ op: 'add_node', id: `n${callCount}`, title: `N${callCount}` }],
      });
    };
    const result = await runAgent({
      prisma, service, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'plan', actor, llm, stepwise: true,
    });

    expect(callCount).toBe(6); // 1 ilk parça + en fazla 5 kalan
    expect(result.committed).toBe(true);
    expect(result.reply).toContain('işlem üretilmedi'); // atlanan parça notu
    const ids = (await service.getState()).nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['n1', 'n3', 'n4', 'n5', 'n6']));
    expect(ids).not.toContain('n2');
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('owner agent creates regions with aiAllowed forced on, fills them, and skips invalid rects', async () => {
    const { prisma, service, canvas, actor } = await freshCanvas();
    let system = '';
    const llm: Llm = async (s) => {
      system = s;
      return JSON.stringify({
        mode: 'diagram', reply: 'Bölgeyi kurdum ve doldurdum.', message: 'yeni alan',
        newRegions: [
          { name: 'Ödeme Sistemi', x: 1000, y: 0, width: 800, height: 500, description: 'Ödeme akışı burada planlanır.' },
          { name: 'Bozuk', x: 0, y: 0, width: -5, height: 100 }, // geçersiz dikdörtgen → atlanır
        ],
        ops: [{ op: 'add_node', id: 'pay1', title: 'Ödeme sağlayıcı seçimi', x: 1050, y: 50 }],
      });
    };
    const regionUpdates: number[] = [];
    const result = await runAgent({
      prisma, service, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'ödeme sistemi için bölge aç ve doldur', actor, llm,
      onRegions: (regions) => regionUpdates.push(regions.length),
    });

    expect(system).toContain('BÖLGE OLUŞTURMA');
    expect(result.committed).toBe(true);
    expect(result.reply).toContain('"Ödeme Sistemi" bölgesi/bölgeleri oluşturuldu');

    const rows = await prisma.region.findMany({ where: { canvasId: canvas.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Ödeme Sistemi', aiAllowed: true, description: 'Ödeme akışı burada planlanır.',
      x: 1000, y: 0, width: 800, height: 500,
    });
    expect(regionUpdates).toEqual([1]);
    expect((await service.getState()).nodes.some((n) => n.id === 'pay1')).toBe(true);
  });

  it('non-owner agents cannot create regions: newRegions are dropped with a note, ops still apply', async () => {
    const { prisma, service, canvas, run } = await freshCanvas();
    const editor = await prisma.user.create({ data: { username: 'ekin', passwordHash: 'x' } });
    let system = '';
    const llm: Llm = async (s) => {
      system = s;
      return JSON.stringify({
        mode: 'diagram', reply: 'Bölge ve düğüm ekledim.', message: 'deneme',
        newRegions: [{ name: 'Kaçak Bölge', x: 0, y: 600, width: 400, height: 300 }],
        ops: [{ op: 'add_node', id: 'e1', title: 'Serbest düğüm' }],
      });
    };
    const result = await run(llm, { userId: editor.id, role: 'editor' });

    expect(system).toContain('"newRegions" ve "updateRegions" alanlarını KULLANMA');
    expect(result.committed).toBe(true);
    expect(result.reply).toContain('bölge oluşturma yalnızca kanvas sahibine açık');
    expect(await prisma.region.count({ where: { canvasId: canvas.id } })).toBe(0);
    expect((await service.getState()).nodes.some((n) => n.id === 'e1')).toBe(true);
  });

  it('owner agent recolors/edits existing regions via updateRegions; invalid color dropped; unknown id skipped', async () => {
    const { prisma, service, canvas, actor } = await freshCanvas();
    const a = await createRegion(prisma, canvas.id, { name: 'Alan A', x: 0, y: 0, width: 300, height: 200 });
    const b = await createRegion(prisma, canvas.id, { name: 'Alan B', x: 400, y: 0, width: 300, height: 200 });
    let system = '';
    const llm: Llm = async (s, u) => {
      system = s;
      // Modele mevcut renk bağlam olarak gitmeli.
      expect(u).toContain('"color"');
      return JSON.stringify({
        mode: 'diagram', reply: 'Bölgeleri renklendirdim.', message: 'renklendirme',
        updateRegions: [
          { id: a.id, color: '#ff0000', description: 'kırmızı alan' },
          { id: b.id, color: 'mavi', name: 'Alan B2' }, // geçersiz renk düşer, ad yine değişir
          { id: 'yok', color: '#00ff00' }, // bilinmeyen id atlanır
        ],
      });
    };
    const regionUpdates: number[] = [];
    const result = await runAgent({
      prisma, service, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'bölgeleri renklendir', actor, llm,
      onRegions: (regions) => regionUpdates.push(regions.length),
    });

    expect(system).toContain('BÖLGE DÜZENLEME');
    // Saf config düzenlemesi commit üretmez ama bölgeler güncellenir + yayınlanır.
    expect(result.reply).toContain('"Alan A", "Alan B2" bölgesi/bölgeleri güncellendi');
    expect(regionUpdates).toEqual([2]);
    const rows = await prisma.region.findMany({ where: { canvasId: canvas.id }, orderBy: { createdAt: 'asc' } });
    expect(rows[0]).toMatchObject({ name: 'Alan A', color: '#ff0000', description: 'kırmızı alan' });
    expect(rows[1]).toMatchObject({ name: 'Alan B2' });
    expect(rows[1].color).not.toBe('mavi'); // geçersiz renk yazılmadı
  });

  it('non-owner agents cannot edit regions: updateRegions dropped with a note', async () => {
    const { prisma, service, canvas, run } = await freshCanvas();
    const a = await createRegion(prisma, canvas.id, { name: 'Alan A', x: 0, y: 0, width: 300, height: 200, color: '#111111' });
    const editor = await prisma.user.create({ data: { username: 'ekin', passwordHash: 'x' } });
    let system = '';
    const llm: Llm = async (s) => {
      system = s;
      return JSON.stringify({
        mode: 'diagram', reply: 'Renklendirdim.', message: 'deneme',
        updateRegions: [{ id: a.id, color: '#ff0000' }],
      });
    };
    const result = await run(llm, { userId: editor.id, role: 'editor' });

    expect(system).toContain('"updateRegions" alanlarını KULLANMA');
    expect(result.reply).toContain('bölge düzenleme yalnızca kanvas sahibine açık');
    expect((await prisma.region.findUnique({ where: { id: a.id } }))!.color).toBe('#111111');
  });

  it('region-only diagram responses create the region without a commit', async () => {
    const { prisma, canvas, run } = await freshCanvas();
    const result = await run(asLlm({
      mode: 'diagram', reply: 'Boş bölge açtım.', message: 'bölge',
      newRegions: [{ name: 'Boş Alan', x: 2000, y: 0, width: 600, height: 400 }],
      ops: [],
    }));
    expect(result.committed).toBe(false);
    expect(result.reply).toContain('"Boş Alan" bölgesi/bölgeleri oluşturuldu');
    expect(await prisma.region.count({ where: { canvasId: canvas.id, name: 'Boş Alan' } })).toBe(1);
  });

  it('creates sub-canvases in the same group, links nodes (incl. same-round adds) and fills each with one llm call', async () => {
    const { prisma, service, serviceFor, group, owner, canvas, run } = await freshGroupCanvas();
    const calls: Array<{ system: string; user: string }> = [];
    const llm: Llm = async (system, user) => {
      calls.push({ system, user });
      if (calls.length === 1) {
        return JSON.stringify({
          mode: 'diagram', reply: 'Alt kanvasları açtım.', message: 'detay planları',
          ops: [{ op: 'add_node', id: 'ai-1', title: 'Ödeme adımı' }],
          newSubCanvases: [
            { nodeId: 'root', name: 'Kök Planı', description: 'Kökün detayları' },
            { nodeId: 'ai-1', name: 'Ödeme Planı' }, // aynı turda eklenen düğüme de bağlanabilir
          ],
        });
      }
      // Doldurma çağrıları: alt kanvasa küçük bir plan.
      return JSON.stringify({
        mode: 'diagram', reply: 'Plan çizildi.', message: 'iç plan',
        ops: [{ op: 'add_node', id: `fill-${calls.length}`, title: 'İlk adım' }],
      });
    };
    const result = await run(llm);

    expect(calls).toHaveLength(3); // 1 tur + 2 doldurma
    expect(calls[0].system).toContain('ALT KANVAS OLUŞTURMA');
    expect(calls[0].user).toContain('"linkedCanvasId":null'); // düğüm projeksiyonunda alan var
    // Doldurma çağrısı: recursion kapalı, bağlam alt kanvası anlatıyor.
    expect(calls[1].system).toContain('"newSubCanvases" alanı KULLANMA');
    expect(calls[1].user).toContain('alt kanvasıdır');
    expect(calls[1].user).toContain('Kökün detayları');

    expect(result.committed).toBe(true);
    expect(result.reply).toContain('alt kanvası oluşturuldu');
    expect(result.reply).toContain('plan çizildi');

    // Alt kanvaslar aynı grupta, sahibi istek atan kullanıcı.
    const subs = await prisma.canvas.findMany({ where: { id: { not: canvas.id } } });
    expect(subs).toHaveLength(2);
    for (const s of subs) expect(s).toMatchObject({ groupId: group.id, ownerId: owner.id });

    // Bağlar tek tur commit'iyle kuruldu.
    const state = await service.getState();
    const subByName = new Map(subs.map((s) => [s.name, s.id]));
    expect(state.nodes.find((n) => n.id === 'root')!.linkedCanvasId).toBe(subByName.get('Kök Planı'));
    expect(state.nodes.find((n) => n.id === 'ai-1')!.linkedCanvasId).toBe(subByName.get('Ödeme Planı'));

    // Doldurma commit'leri alt kanvaslara indi; her iki tarafta da replay tutarlı.
    for (const s of subs) {
      const subState = await serviceFor(s.id).getState();
      expect(subState.nodes.some((n) => n.id.startsWith('fill-'))).toBe(true);
      expect(await serviceFor(s.id).rebuildCheck()).toBe(true);
    }
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('sub-canvases inherit the parent canvas type (co-pronoia stays co-pronoia so MCP tokens work)', async () => {
    const { prisma, canvas, run } = await freshGroupCanvas('co-pronoia');
    const llm: Llm = async () =>
      JSON.stringify({
        mode: 'diagram', reply: 'Alt kanvas açtım.', message: 'detay',
        newSubCanvases: [{ nodeId: 'root', name: 'Kök Planı' }],
      });
    const result = await run(llm);

    expect(result.committed).toBe(true);
    const sub = await prisma.canvas.findFirst({ where: { id: { not: canvas.id } } });
    expect(sub!.type).toBe('co-pronoia');
  });

  it('drops newSubCanvases without canvas-create permission; ops still commit', async () => {
    const { prisma, service, group, canvas, run } = await freshGroupCanvas();
    const member = await prisma.user.create({ data: { username: 'kisitli', passwordHash: 'x' } });
    const role = await prisma.groupRoleDef.create({
      data: { groupId: group.id, name: 'stajyer', canCreateCanvas: false },
    });
    await prisma.groupMember.create({
      data: { groupId: group.id, userId: member.id, status: 'approved', roleDefId: role.id },
    });
    let system = '';
    const llm: Llm = async (s) => {
      system = s;
      return JSON.stringify({
        mode: 'diagram', reply: 'Denedim.', message: 'deneme',
        ops: [{ op: 'add_node', id: 'm1', title: 'Serbest' }],
        newSubCanvases: [{ nodeId: 'root', name: 'Kaçak Kanvas' }],
      });
    };
    const result = await run(llm, { userId: member.id, role: 'editor' });

    expect(system).toContain('"newSubCanvases" alanı KULLANMA');
    expect(result.committed).toBe(true);
    expect(result.reply).toContain('alt kanvas oluşturma bu kanvasta size kapalı');
    expect(await prisma.canvas.count()).toBe(1); // yeni kanvas yok
    const state = await service.getState();
    expect(state.nodes.find((n) => n.id === 'root')!.linkedCanvasId).toBeNull();
    expect(state.nodes.some((n) => n.id === 'm1')).toBe(true);
    expect(canvas.id).toBeTruthy();
  });

  it('groupless canvas: sub-canvas creation is disabled even with serviceFor', async () => {
    const { prisma, service, serviceFor, canvas, owner, actor } = await freshCanvas();
    let system = '';
    const llm: Llm = async (s) => {
      system = s;
      return JSON.stringify({
        mode: 'diagram', reply: 'Denedim.', message: 'deneme',
        ops: [{ op: 'add_node', id: 'g1', title: 'Düğüm' }],
        newSubCanvases: [{ nodeId: 'root', name: 'Olmayacak' }],
      });
    };
    const result = await runAgent({
      prisma, service, serviceFor, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'alt kanvas aç', actor, llm,
    });
    expect(system).toContain('"newSubCanvases" alanı KULLANMA');
    expect(result.committed).toBe(true);
    expect(result.reply).toContain('alt kanvas oluşturma bu kanvasta size kapalı');
    expect(await prisma.canvas.count()).toBe(1);
    expect(owner.id).toBeTruthy();
  });

  it('tolerates a failing fill: parent commit and link stand, reply notes the failure', async () => {
    const { prisma, service, run } = await freshGroupCanvas();
    let callCount = 0;
    const llm: Llm = async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          mode: 'diagram', reply: 'Açtım.', message: 'aç',
          ops: [],
          newSubCanvases: [{ nodeId: 'root', name: 'Sorunlu Plan' }],
        });
      }
      throw new Error('model patladı');
    };
    const result = await run(llm);

    expect(callCount).toBe(2);
    expect(result.committed).toBe(true); // bağ commit'i (yalnızca link op'u) durdu
    expect(result.reply).toContain('doldurulamadı');
    const sub = await prisma.canvas.findFirst({ where: { name: 'Sorunlu Plan' } });
    expect(sub).not.toBeNull();
    expect((await service.getState()).nodes.find((n) => n.id === 'root')!.linkedCanvasId).toBe(sub!.id);
  });

  it('skips unknown and already-linked nodes with notes; strips model-written linkedCanvasId from ops', async () => {
    const { prisma, service, serviceFor, group, owner, run } = await freshGroupCanvas();
    // root'u önceden bağla.
    const existing = await createCanvas(prisma, serviceFor, 'Mevcut', owner.id, { groupId: group.id });
    await service.commit([{ op: 'update_node', id: 'root', fields: { linkedCanvasId: existing.id } }]);

    const result = await run(asLlm({
      mode: 'diagram', reply: 'Denedim.', message: 'deneme',
      ops: [
        // Modelin kendi yazdığı linkedCanvasId alanları soyulur; kalan alanlar uygulanır.
        { op: 'update_node', id: 'root', fields: { linkedCanvasId: 'hileli-id', title: 'Yeni Kök' } },
        { op: 'add_node', id: 's1', title: 'Sızma', linkedCanvasId: 'hileli-id' },
      ],
      newSubCanvases: [
        { nodeId: 'olmayan', name: 'Hedefsiz' },
        { nodeId: 'root', name: 'İkinci Bağ' }, // zaten bağlı → düşer
      ],
    }));

    expect(result.committed).toBe(true);
    expect(result.reply).toContain('düğüm bulunamadı');
    expect(result.reply).toContain('zaten bağlı');
    expect(await prisma.canvas.count({ where: { name: { in: ['Hedefsiz', 'İkinci Bağ'] } } })).toBe(0);
    const state = await service.getState();
    const root = state.nodes.find((n) => n.id === 'root')!;
    expect(root.title).toBe('Yeni Kök'); // kalan alan uygulandı
    expect(root.linkedCanvasId).toBe(existing.id); // hileli id yazılmadı
    expect(state.nodes.find((n) => n.id === 's1')!.linkedCanvasId).toBeNull();
  });

  it('notes/data: prompt anlatır, projeksiyon taşır, ops içindeki alanlar commit edilir', async () => {
    const { service, run } = await freshCanvas();
    await service.commit([{ op: 'update_node', id: 'root', fields: { notes: 'kök notu', data: { sahip: 'bora' } } }]);
    const calls: Array<{ system: string; user: string }> = [];
    const llm: Llm = async (system, user) => {
      calls.push({ system, user });
      return JSON.stringify({
        mode: 'diagram', reply: 'Ekledim.', message: 'notlu düğüm',
        ops: [
          { op: 'add_node', id: 'n1', title: 'Adım', notes: '# Ayrıntı\nuzun metin', data: { tahmin: '3g' } },
          { op: 'update_node', id: 'root', fields: { data: { sahip: 'ayşe' } } },
        ],
      });
    };
    const result = await run(llm);
    expect(calls[0].system).toContain('NOTES/DATA');
    expect(calls[0].user).toContain('kök notu'); // projeksiyon notes taşıyor
    expect(calls[0].user).toContain('"sahip":"bora"');
    expect(result.committed).toBe(true);
    const state = await service.getState();
    expect(state.nodes.find((n) => n.id === 'n1')!.notes).toBe('# Ayrıntı\nuzun metin');
    expect(state.nodes.find((n) => n.id === 'n1')!.data).toEqual({ tahmin: '3g' });
    expect(state.nodes.find((n) => n.id === 'root')!.data).toEqual({ sahip: 'ayşe' });
    expect(await service.rebuildCheck()).toBe(true);
  });

  it('detaylandır: ops boş + newSubCanvases → üst kanvasa yalnız bağ commit\'i iner', async () => {
    const { prisma, service, serviceFor, run } = await freshGroupCanvas();
    const calls: string[] = [];
    const llm: Llm = async (system) => {
      calls.push(system);
      if (calls.length === 1) {
        return JSON.stringify({
          mode: 'diagram', reply: 'Detay alt kanvasa.', message: 'detaylandırma',
          ops: [], // üst kanvasa içerik yok — DETAYLANDIRMA kuralına uygun
          newSubCanvases: [{ nodeId: 'root', name: 'Kök Detayı' }],
        });
      }
      return JSON.stringify({
        mode: 'diagram', reply: 'Plan.', message: 'iç plan',
        ops: [{ op: 'add_node', id: 'd1', title: 'Detay adımı' }],
      });
    };
    const result = await run(llm);
    expect(calls[0]).toContain('DETAYLANDIRMA (kesin)');
    expect(result.committed).toBe(true);
    const state = await service.getState();
    // Üst kanvasta içerik düğümü YOK; yalnızca kök + bağ.
    expect(state.nodes).toHaveLength(1);
    const sub = await prisma.canvas.findFirst({ where: { name: 'Kök Detayı' } });
    expect(state.nodes[0].linkedCanvasId).toBe(sub!.id);
    expect((await serviceFor(sub!.id).getState()).nodes.some((n) => n.id === 'd1')).toBe(true);
  });

  it('fillSubCanvases: bağlı düğümün detayı mevcut alt kanvasa çizilir, üst kanvasa commit inmez', async () => {
    const { prisma, service, serviceFor, group, owner, run } = await freshGroupCanvas();
    const sub = await createCanvas(prisma, serviceFor, 'Mevcut Plan', owner.id, { groupId: group.id });
    await service.commit([{ op: 'update_node', id: 'root', fields: { linkedCanvasId: sub.id } }]);
    const parentHead = (await service.getState()).headSeq;
    const subHead = (await serviceFor(sub.id).getState()).headSeq;

    const calls: Array<{ system: string; user: string }> = [];
    const subCommits: string[] = [];
    const llm: Llm = async (system, user) => {
      calls.push({ system, user });
      if (calls.length === 1) {
        return JSON.stringify({
          mode: 'diagram', reply: 'Detaylandırıyorum.', message: 'detay',
          ops: [],
          fillSubCanvases: [{ nodeId: 'root', prompt: 'ödeme akışını derinleştir' }],
        });
      }
      return JSON.stringify({
        mode: 'diagram', reply: 'Derinleştirdim.', message: 'derin',
        ops: [{ op: 'add_node', id: 'derin-1', title: 'Derin adım', notes: 'ayrıntı' }],
      });
    };
    const result = await runAgent({
      prisma, service, serviceFor, canvasId: (await prisma.canvas.findFirst({ where: { name: 'Test' } }))!.id,
      canvasName: 'Test', prompt: 'kökü detaylandır', actor: { userId: owner.id, role: 'owner' }, llm,
      onSubCommit: (subId) => subCommits.push(subId),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].system).toContain('fillSubCanvases');
    expect(calls[1].user).toContain('ödeme akışını derinleştir'); // model prompt'u fill çağrısına taşındı
    expect(result.committed).toBe(false); // üst kanvasa commit yok
    expect(result.reply).toContain('alt kanvasına çizildi');
    expect((await service.getState()).headSeq).toBe(parentHead); // üst kanvas dokunulmadı
    const subState = await serviceFor(sub.id).getState();
    expect(subState.headSeq).toBe(subHead + 1);
    expect(subState.nodes.some((n) => n.id === 'derin-1')).toBe(true);
    expect(subCommits).toEqual([sub.id]);
    expect(await serviceFor(sub.id).rebuildCheck()).toBe(true);
    expect(await service.rebuildCheck()).toBe(true);
    expect(run).toBeTruthy();
  });

  it('fillSubCanvases: hedefte üyelik yoksa ya da rol viewer ise notla düşer, commit inmez', async () => {
    const { prisma, service, serviceFor, group, owner, canvas } = await freshGroupCanvas();
    const other = await prisma.user.create({ data: { username: 'baskasi', passwordHash: 'x' } });
    // Ajanı çağıran kullanıcı: kanvas erişimi 'none' olan bir role sahip sıradan grup üyesi
    // (grup admin'i olsaydı memberRole onu her grup kanvasında editör sayardı).
    const kisitli = await prisma.user.create({ data: { username: 'kisitli', passwordHash: 'x' } });
    const roleDef = await prisma.groupRoleDef.create({
      data: { groupId: group.id, name: 'dar', defaultCanvasAccess: 'none' },
    });
    await prisma.groupMember.create({
      data: { groupId: group.id, userId: kisitli.id, status: 'approved', roleDefId: roleDef.id },
    });
    await prisma.canvasMember.create({ data: { canvasId: canvas.id, userId: kisitli.id, role: 'editor' } });
    // Alt kanvasların sahibi başka biri; kisitli birinde hiç üye değil, diğerinde viewer.
    const foreignSub = await createCanvas(prisma, serviceFor, 'Yabancı Plan', other.id, { groupId: group.id });
    const viewerSub = await createCanvas(prisma, serviceFor, 'Salt Okunur Plan', other.id, { groupId: group.id });
    await prisma.canvasMember.create({ data: { canvasId: viewerSub.id, userId: kisitli.id, role: 'viewer' } });
    await service.commit([
      { op: 'add_node', id: 'n-yabanci', title: 'Yabancı', linkedCanvasId: foreignSub.id },
      { op: 'add_node', id: 'n-viewer', title: 'İzleyici', linkedCanvasId: viewerSub.id },
      { op: 'add_node', id: 'n-bagsiz', title: 'Bağsız' },
    ]);

    let llmCalls = 0;
    const llm: Llm = async () => {
      llmCalls++;
      return JSON.stringify({
        mode: 'diagram', reply: 'Deniyorum.', message: 'detay',
        ops: [],
        fillSubCanvases: [
          { nodeId: 'n-yabanci' },
          { nodeId: 'hayalet' },
          { nodeId: 'n-viewer' },
          { nodeId: 'n-bagsiz' }, // 4. kayıt: MAX_FILL_SUBCANVASES sınırında düşer
        ],
      });
    };
    const result = await runAgent({
      prisma, service, serviceFor, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'hepsini detaylandır', actor: { userId: kisitli.id, role: 'editor' }, llm,
    });

    expect(llmCalls).toBe(1); // hiçbir hedef için fill çağrısı yapılmadı
    expect(result.committed).toBe(false);
    expect(result.reply).toContain('erişiminiz olmadığı');
    expect(result.reply).toContain('salt okunur');
    expect(result.reply).toContain('bulunamadığı');
    expect(result.reply).not.toContain('Bağsız'); // sınır: 4. kayıt hiç işlenmedi
    expect((await serviceFor(foreignSub.id).getState()).headSeq).toBe(1); // yalnızca seed commit
    expect((await serviceFor(viewerSub.id).getState()).headSeq).toBe(1);
    expect(owner.id).toBeTruthy();
  });

  it('fillSubCanvases diagram dışı modlarda temizlenir; viewer aktörle yetenek kapalı', async () => {
    const { prisma, service, serviceFor, group, owner, canvas } = await freshGroupCanvas();
    const sub = await createCanvas(prisma, serviceFor, 'Hedef', owner.id, { groupId: group.id });
    await service.commit([{ op: 'update_node', id: 'root', fields: { linkedCanvasId: sub.id } }]);

    // summary modunda fillSubCanvases yok sayılır.
    let calls = 0;
    const summaryLlm: Llm = async () => {
      calls++;
      return JSON.stringify({ mode: 'summary', reply: 'Özet.', fillSubCanvases: [{ nodeId: 'root' }] });
    };
    const r1 = await runAgent({
      prisma, service, serviceFor, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'özetle', actor: { userId: owner.id, role: 'owner' }, llm: summaryLlm,
    });
    expect(calls).toBe(1);
    expect(r1.committed).toBe(false);
    expect((await serviceFor(sub.id).getState()).headSeq).toBe(1);

    // viewer: sistem prompt'unda DETAYLANDIRMA kuralı yok, sızan fillSubCanvases nota döner.
    const viewer = await prisma.user.create({ data: { username: 'izleyen', passwordHash: 'x' } });
    let viewerSystem = '';
    const viewerLlm: Llm = async (s) => {
      viewerSystem = s;
      return JSON.stringify({
        mode: 'diagram', reply: 'Deniyorum.', message: 'x',
        ops: [], fillSubCanvases: [{ nodeId: 'root' }],
      });
    };
    const r2 = await runAgent({
      prisma, service, serviceFor, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'detaylandır', actor: { userId: viewer.id, role: 'viewer' }, llm: viewerLlm,
    });
    expect(viewerSystem).not.toContain('DETAYLANDIRMA (kesin)');
    expect(r2.committed).toBe(false);
    expect(r2.reply).toContain('kullanılamadı');
    expect((await serviceFor(sub.id).getState()).headSeq).toBe(1);
  });

  it('kanvas notu (brief) ajan bağlamına taşınır; boşken blok hiç eklenmez', async () => {
    const { prisma, canvas, run } = await freshCanvas();
    let user = '';
    const llm: Llm = async (_s, u) => {
      user = u;
      return JSON.stringify({ mode: 'summary', reply: 'Tamam.' });
    };
    await run(llm);
    expect(user).not.toContain('KANVAS NOTU');

    await prisma.canvasBriefRevision.create({
      data: { canvasId: canvas.id, content: 'Hedef: MVP önce ödeme akışı.', authorLabel: 'sahip' },
    });
    await run(llm);
    expect(user).toContain('KANVAS NOTU');
    expect(user).toContain('Hedef: MVP önce ödeme akışı.');
  });

  it('reports invalid ops as an error reply instead of throwing', async () => {
    const { service, run } = await freshCanvas();
    const result = await run(asLlm({
      mode: 'diagram',
      reply: 'Alt düğüm ekledim.',
      ops: [{ op: 'add_node', id: 'k1', parentId: 'yok-boyle-dugum', title: 'K' }],
    }));
    expect(result.committed).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.reply).toContain('Değişiklik uygulanamadı');
    expect((await service.getState()).headSeq).toBe(1);
  });
});
