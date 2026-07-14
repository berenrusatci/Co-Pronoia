import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { createCanvas } from './canvasService.js';
import { runAgent, type Llm } from './agent.js';
import type { Actor } from './commitService.js';

let db: ReturnType<typeof testDbFactory>;
beforeAll(() => {
  db = testDbFactory();
});

const opened: Array<{ prisma: { $disconnect(): Promise<void> } }> = [];
afterAll(async () => {
  for (const { prisma } of opened) await prisma.$disconnect();
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
  const run = (llm: Llm, actorOverride?: Actor, detail?: 'proto' | 'detailed', selectedIds?: string[]) =>
    runAgent({
      prisma: built.prisma, service, canvasId: canvas.id, canvasName: canvas.name,
      prompt: 'test isteği', actor: actorOverride ?? actor, llm,
      ...(detail ? { detail } : {}),
      ...(selectedIds ? { selectedIds } : {}),
    });
  return { ...built, service, canvas, owner, actor, run };
}

const asLlm = (payload: unknown): Llm => async () => JSON.stringify(payload);

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
    const built = await buildApp(await db.fresh());
    opened.push(built);
    const { app } = built;
    let res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'beren', password: 'sifre1', email: 'b@test.com' },
    });
    const cookies = { tm_session: res.cookies.find((c) => c.name === 'tm_session')!.value };
    res = await app.inject({ method: 'POST', url: '/api/canvases', cookies, payload: { name: 'Plan' } });
    const canvasId = res.json().canvas.id as string;

    res = await app.inject({ method: 'POST', url: `/api/canvases/${canvasId}/agent`, cookies, payload: {} });
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
