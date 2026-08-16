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

describe('kanvas dışa/içe aktarım (export/import)', () => {
  it('export → import yeni kanvas oluşturur, düğüm+kenarları taşır', async () => {
    const { app, sent } = await fresh();
    const { cookies } = await registerVerified(app, sent, { username: 'e1', password: 'sifre1guclu', email: 'e1@t.com' });
    const source = await createGroupCanvas(app, cookies, 'Kaynak');
    const root = await rootIdOf(app, cookies as Cookies, source.id);
    const ops: OpInput[] = [
      { op: 'add_node', id: 'n1', parentId: root, title: 'Görev 1', status: 'done' },
      { op: 'add_node', id: 'n2', parentId: 'n1', title: 'Alt görev' },
      { op: 'add_edge', id: 'ed1', sourceId: root, targetId: 'n2', kind: 'dependency' },
    ];
    await app.inject({ method: 'POST', url: `/api/canvases/${source.id}/commit`, cookies, payload: { ops } });

    const exp = await app.inject({ method: 'GET', url: `/api/canvases/${source.id}/export`, cookies });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toContain('application/json');
    const bundle = exp.json();
    expect(bundle.kind).toBe('treemapper.canvas');
    expect(bundle.nodes.length).toBe(3); // kök + n1 + n2

    // Aynı kullanıcı aynı gruba içe aktarır.
    const groupId = source.groupId as string;
    const imp = await app.inject({ method: 'POST', url: '/api/canvases/import', cookies, payload: { groupId, bundle, name: 'Kopya' } });
    expect(imp.statusCode).toBe(200);
    const newId = imp.json().canvas.id as string;
    expect(newId).not.toBe(source.id);

    const st = await app.inject({ method: 'GET', url: `/api/canvases/${newId}/state`, cookies });
    const s = st.json();
    expect(s.nodes.map((n: { title: string }) => n.title).sort()).toEqual(['Alt görev', 'Görev 1', 'Kaynak'].sort());
    expect(s.edges.length).toBe(1);
    expect(s.edges[0].kind).toBe('dependency');
  });

  it('groupId yoksa 400; bozuk paket 400', async () => {
    const { app, sent } = await fresh();
    const { cookies } = await registerVerified(app, sent, { username: 'e2', password: 'sifre1guclu', email: 'e2@t.com' });
    const canvas = await createGroupCanvas(app, cookies, 'G');
    const groupId = canvas.groupId as string;
    const noGroup = await app.inject({ method: 'POST', url: '/api/canvases/import', cookies, payload: { bundle: { kind: 'treemapper.canvas', version: 1, nodes: [] } } });
    expect(noGroup.statusCode).toBe(400);
    const bad = await app.inject({ method: 'POST', url: '/api/canvases/import', cookies, payload: { groupId, bundle: { kind: 'nope' } } });
    expect(bad.statusCode).toBe(400);
  });

  it('grup üyesi olmayan içe aktaramaz (403)', async () => {
    const { app, sent } = await fresh();
    const { cookies: owner } = await registerVerified(app, sent, { username: 'o1', password: 'sifre1guclu', email: 'o1@t.com' });
    const { cookies: outsider } = await registerVerified(app, sent, { username: 'x1', password: 'sifre1guclu', email: 'x1@t.com' });
    const canvas = await createGroupCanvas(app, owner, 'K');
    const groupId = canvas.groupId as string;
    const res = await app.inject({
      method: 'POST', url: '/api/canvases/import', cookies: outsider,
      payload: { groupId, bundle: { kind: 'treemapper.canvas', version: 1, name: 'z', nodes: [], edges: [], regions: [] } },
    });
    expect(res.statusCode).toBe(403);
  });
});
