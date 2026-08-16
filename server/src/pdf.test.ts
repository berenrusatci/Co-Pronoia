import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { captureEmails, createGroupCanvas, registerVerified } from './testAuth.js';
import type { OpInput } from '@co-pronoia/shared';

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
type Cookies = { tm_session: string };

const rootIdOf = async (app: App, cookies: Cookies, canvasId: string): Promise<string> => {
  const res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/state`, cookies });
  return res.json().nodes[0].id as string;
};

describe('GET /api/canvases/:id/pdf', () => {
  it('üyeye application/pdf döner ve gövde %PDF ile başlar', async () => {
    const { app, sent } = await fresh();
    const { cookies } = await registerVerified(app, sent, { username: 'p1', password: 'sifre1guclu', email: 'p1@t.com' });
    const canvas = await createGroupCanvas(app, cookies, 'PDF Kanvas');
    const root = await rootIdOf(app, cookies as Cookies, canvas.id);
    const ops: OpInput[] = [
      { op: 'add_node', id: 'c1', parentId: root, title: 'Alt görev şğı', status: 'done' },
      { op: 'add_node', id: 'c2', parentId: root, title: 'İkinci' },
    ];
    await app.inject({ method: 'POST', url: `/api/canvases/${canvas.id}/commit`, cookies, payload: { ops } });

    const res = await app.inject({ method: 'GET', url: `/api/canvases/${canvas.id}/pdf?template=a3-landscape`, cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    // rawPayload bir Buffer; PDF sihirli baytları.
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(res.rawPayload.length).toBeGreaterThan(500);
  });

  it('üye olmayan 404 alır', async () => {
    const { app, sent } = await fresh();
    const { cookies: owner } = await registerVerified(app, sent, { username: 'o1', password: 'sifre1guclu', email: 'o1@t.com' });
    const { cookies: outsider } = await registerVerified(app, sent, { username: 'x1', password: 'sifre1guclu', email: 'x1@t.com' });
    const canvas = await createGroupCanvas(app, owner, 'Gizli');
    const res = await app.inject({ method: 'GET', url: `/api/canvases/${canvas.id}/pdf`, cookies: outsider });
    expect(res.statusCode).toBe(404);
  });
});
