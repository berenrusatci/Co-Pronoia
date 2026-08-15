import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { captureEmails, registerVerified } from './testAuth.js';
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

let rpcId = 0;

/**
 * Stateless MCP ucuna tek JSON-RPC isteği atar. Streamable HTTP spec'i Accept başlığında
 * iki türü birden ister; enableJsonResponse sayesinde yanıt düz JSON döner.
 */
async function rpc(app: App, secret: string | null, method: string, params?: unknown) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    payload: { jsonrpc: '2.0', id: ++rpcId, method, params: params ?? {} },
  });
  return res;
}

const initParams = {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'test-client', version: '0.0.1' },
};

/** tools/call sarmalayıcısı: sonucun content[0].text'ini ve isError bayrağını söker. */
async function callTool(app: App, secret: string, name: string, args?: unknown) {
  const res = await rpc(app, secret, 'tools/call', { name, arguments: args ?? {} });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  if (body.error) return { rpcError: body.error as { code: number; message: string }, text: '', isError: true };
  const result = body.result as { content?: { type: string; text: string }[]; isError?: boolean };
  return { text: result.content?.[0]?.text ?? '', isError: result.isError === true, rpcError: undefined };
}

/** co-pronoia kanvas + Mimar/Süpervizör rolleri + iki ajan anahtarı kurar. */
async function cpSetup() {
  const ctx = await fresh();
  const { app, sent } = ctx;
  const owner = await registerVerified(app, sent, { username: 'sahip', password: 'sifre1', email: 's@t.com' });
  const cookies = owner.cookies;
  const groupId = (await app.inject({
    method: 'POST', url: '/api/groups', cookies, payload: { name: 'CP', type: 'co-pronoia' },
  })).json().group.id as string;
  const canvasId = (await app.inject({
    method: 'POST', url: '/api/canvases', cookies, payload: { name: 'Plan', groupId, type: 'co-pronoia' },
  })).json().canvas.id as string;
  const mkRole = async (name: string, isSupervisor: boolean) =>
    (await app.inject({
      method: 'POST', url: `/api/groups/${groupId}/agent-roles`, cookies,
      payload: { name, persona: `${name} personası.`, isSupervisor },
    })).json().role.id as string;
  const architectRole = await mkRole('Mimar', false);
  const supervisorRole = await mkRole('Süpervizör', true);
  const mint = async (roleId: string, label: string) => {
    const res = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/agent-tokens`, cookies, payload: { roleId, label },
    });
    return { secret: res.json().secret as string, tokenId: res.json().token.id as string };
  };
  const agent = await mint(architectRole, 'ajan-1');
  const supervisor = await mint(supervisorRole, 'süper-1');
  const state = async () =>
    (await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/state`, cookies })).json() as {
      headSeq: number; nodes: { id: string; title: string }[];
    };
  return { ...ctx, cookies, groupId, canvasId, agent, supervisor, state };
}

describe('MCP ucu: kimlik ve araç görünürlüğü', () => {
  it('anahtarsız/yanlış/iptal anahtar 401; GET 405; geçerli anahtar initialize olur', async () => {
    const { app, cookies, canvasId, agent } = await cpSetup();

    let res = await rpc(app, null, 'initialize', initParams);
    expect(res.statusCode).toBe(401);
    res = await rpc(app, 'tma_yanlis', 'initialize', initParams);
    expect(res.statusCode).toBe(401);

    res = await app.inject({ method: 'GET', url: '/api/mcp' });
    expect(res.statusCode).toBe(405);

    res = await rpc(app, agent.secret, 'initialize', initParams);
    expect(res.statusCode).toBe(200);
    expect(res.json().result.serverInfo.name).toBe('co-pronoia');

    // iptal sonrası 401
    await app.inject({ method: 'DELETE', url: `/api/canvases/${canvasId}/agent-tokens/${agent.tokenId}`, cookies });
    res = await rpc(app, agent.secret, 'initialize', initParams);
    expect(res.statusCode).toBe(401);
  });

  it('tools/list: süpervizör araçları yalnızca süpervizör token\'ında görünür', async () => {
    const { app, agent, supervisor } = await cpSetup();
    const names = async (secret: string) => {
      const res = await rpc(app, secret, 'tools/list');
      return (res.json().result.tools as { name: string }[]).map((t) => t.name);
    };
    const agentTools = await names(agent.secret);
    expect(agentTools).toContain('submit_proposal');
    expect(agentTools).toContain('get_brief');
    expect(agentTools).toContain('wait_for_changes');
    expect(agentTools).toContain('list_regions');
    expect(agentTools).not.toContain('approve_proposal');
    expect(agentTools).not.toContain('create_region');
    const supTools = await names(supervisor.secret);
    expect(supTools).toEqual(
      expect.arrayContaining(['approve_proposal', 'reject_proposal', 'request_changes', 'create_region', 'list_regions']),
    );
  });

  it('get_brief personayı, rolü ve kadroyu taşır', async () => {
    const { app, agent, supervisor } = await cpSetup();
    const brief = await callTool(app, agent.secret, 'get_brief');
    expect(brief.isError).toBe(false);
    expect(brief.text).toContain('Mimar personası.');
    expect(brief.text).toContain('ajan-1');
    expect(brief.text).toContain('süper-1');
    expect(brief.text).toContain('wait_for_changes');
    expect(brief.text).not.toContain('SEN SÜPERVİZÖRSÜN');
    const supBrief = await callTool(app, supervisor.secret, 'get_brief');
    expect(supBrief.text).toContain('SEN SÜPERVİZÖRSÜN');
    expect(supBrief.text).toContain('wait_for_changes');
  });
});

describe('MCP ucu: öneri yaşam döngüsü ve süpervizör zorlaması', () => {
  it('submit → request_changes → update → approve: commit iner, rebuildCheck geçer', async () => {
    const { app, serviceFor, canvasId, agent, supervisor, state } = await cpSetup();
    const head0 = (await state()).headSeq;

    // geçersiz intents (var olmayan parent) → araç hatası, kayıt yok
    const bad = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'Bozuk', intents: [{ op: 'add_node', title: 'X', parentId: 'yok' }], baseSeq: head0,
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('uygulanamıyor');

    // geçerli öneri
    const intents: OpInput[] = [
      { op: 'add_node', id: 'n1', title: 'API tasarımı', x: 100, y: 100 },
      { op: 'add_node', id: 'n2', title: 'Şema', parentId: 'n1', x: 200, y: 200 },
      { op: 'add_edge', sourceId: 'n1', targetId: 'n2' },
    ];
    const sub = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'API planı', summary: 'İki adım.', intents, baseSeq: head0,
    });
    expect(sub.isError).toBe(false);
    const proposalId = (JSON.parse(sub.text) as { id: string }).id;

    // öneri henüz uygulanmadı
    expect((await state()).headSeq).toBe(head0);

    // başka token güncelleyemez
    const foreign = await callTool(app, supervisor.secret, 'update_proposal', {
      id: proposalId, title: 'Ele geçir',
    });
    expect(foreign.isError).toBe(true);

    // süpervizör olmayan approve göremez → araç yok
    const notool = await callTool(app, agent.secret, 'approve_proposal', { id: proposalId });
    expect(notool.rpcError ?? notool.isError).toBeTruthy();

    // süpervizör değişiklik ister → sahibi günceller → tekrar submitted
    const rc = await callTool(app, supervisor.secret, 'request_changes', {
      id: proposalId, note: 'Başlıkları Türkçeleştir.',
    });
    expect(JSON.parse(rc.text).status).toBe('changes_requested');
    const upd = await callTool(app, agent.secret, 'update_proposal', {
      id: proposalId, title: 'API planı (düzeltilmiş)',
    });
    expect(JSON.parse(upd.text).status).toBe('submitted');

    // onay → commit
    const ok = await callTool(app, supervisor.secret, 'approve_proposal', {
      id: proposalId, note: 'Uygun.',
    });
    expect(ok.isError).toBe(false);
    expect(ok.text).toContain('uygulandı');
    const after = await state();
    expect(after.headSeq).toBe(head0 + 1);
    expect(after.nodes.map((n) => n.title)).toEqual(
      expect.arrayContaining(['API tasarımı', 'Şema']),
    );
    await serviceFor(canvasId).rebuildCheck();

    // list_proposals durumu 'applied' gösterir
    const list = await callTool(app, agent.secret, 'list_proposals');
    const prop = (JSON.parse(list.text) as { id: string; status: string; appliedCommitSeq: number }[])
      .find((p) => p.id === proposalId)!;
    expect(prop.status).toBe('applied');
    expect(prop.appliedCommitSeq).toBe(head0 + 1);
  });

  it("aiAllowed:false bölgeye yazan öneri onaylanamaz; bölge dışı öneri normal iner", async () => {
    const { app, serviceFor, canvasId, agent, supervisor, state } = await cpSetup();
    const head0 = (await state()).headSeq;

    // Süpervizör AI'ya kapalı bir bölge çizer (sahibin kanvas ayarı, commit üretmez).
    const region = await callTool(app, supervisor.secret, 'create_region', {
      name: 'İnsan Alanı', x: 0, y: 0, width: 500, height: 500,
      description: 'burada yalnız insanlar çalışır', aiAllowed: false,
    });
    expect(region.isError).toBe(false);

    // Bölgenin İÇİNE düğüm koyan öneri: submit geçer (kayıt), onay REDDEDİLİR.
    const inside = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'Kapalı bölgeye yaz',
      intents: [{ op: 'add_node', id: 'kapali', title: 'İzinsiz', x: 250, y: 250 }],
      baseSeq: head0,
    });
    expect(inside.isError).toBe(false);
    const insideId = (JSON.parse(inside.text) as { id: string }).id;

    const reddedildi = await callTool(app, supervisor.secret, 'approve_proposal', { id: insideId });
    expect(reddedildi.isError).toBe(true);
    expect(reddedildi.text).toContain('yapay zekâya kapalı');
    // Reddedilen öneri hiçbir şey yazmamalı ve durumu değişmemeli.
    expect((await state()).headSeq).toBe(head0);
    const liste = await callTool(app, agent.secret, 'list_proposals');
    const kayit = (JSON.parse(liste.text) as { id: string; status: string }[]).find((p) => p.id === insideId)!;
    expect(kayit.status).toBe('submitted');

    // Bölge DIŞINDAKİ aynı iş sorunsuz inmeli — kalkan geniş değil, hedefli.
    const outside = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'Bölge dışına yaz',
      intents: [{ op: 'add_node', id: 'serbest', title: 'İzinli', x: 900, y: 900 }],
      baseSeq: head0,
    });
    const onaylandi = await callTool(app, supervisor.secret, 'approve_proposal', {
      id: (JSON.parse(outside.text) as { id: string }).id,
    });
    expect(onaylandi.isError).toBe(false);
    expect((await state()).headSeq).toBe(head0 + 1);
    expect((await state()).nodes.map((n) => n.title)).toContain('İzinli');
    await serviceFor(canvasId).rebuildCheck();
  });

  it('araya giren çakışan commit: onay dala iner, main temiz kalır', async () => {
    const { app, prisma, serviceFor, cookies, canvasId, agent, supervisor, state } = await cpSetup();
    const s0 = await state();
    const rootId = s0.nodes[0].id;

    const sub = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'Kök yeniden adlandır',
      intents: [{ op: 'update_node', id: rootId, fields: { title: 'Ajan başlığı' } }],
      baseSeq: s0.headSeq,
    });
    const proposalId = (JSON.parse(sub.text) as { id: string }).id;

    // insan aynı alanı değiştirir → head ilerler
    const human = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/commit`, cookies,
      payload: { ops: [{ op: 'update_node', id: rootId, fields: { title: 'İnsan başlığı' } }], baseSeq: s0.headSeq },
    });
    expect(human.json().result).toBe('committed');

    const ok = await callTool(app, supervisor.secret, 'approve_proposal', { id: proposalId });
    expect(ok.isError).toBe(false);
    expect(ok.text).toContain('dalına kaydedildi');

    const after = await state();
    expect(after.nodes.find((n) => n.id === rootId)!.title).toBe('İnsan başlığı');
    await serviceFor(canvasId).rebuildCheck();
    const row = await prisma.planProposal.findUnique({ where: { id: proposalId } });
    expect(row!.status).toBe('applied');
    const branch = await prisma.branch.findFirst({ where: { canvasId, status: 'open' } });
    expect(branch).not.toBeNull();
    expect(row!.branchName).toBe(branch!.name);
  });

  it('anahtarı silinmiş öneri onaylanamaz; sahip reddi çalışır; öneriyle kanvas silinir', async () => {
    const { app, prisma, cookies, canvasId, agent, supervisor, state } = await cpSetup();
    const head0 = (await state()).headSeq;
    const mk = async (title: string) => {
      const sub = await callTool(app, agent.secret, 'submit_proposal', {
        title, intents: [{ op: 'add_node', title }], baseSeq: head0,
      });
      return (JSON.parse(sub.text) as { id: string }).id;
    };
    const p1 = await mk('Birinci');
    const p2 = await mk('İkinci');

    // ajan token satırı silinir → tokenId SetNull → onay reddedilir
    await prisma.agentToken.delete({ where: { id: agent.tokenId } });
    const fail = await callTool(app, supervisor.secret, 'approve_proposal', { id: p1 });
    expect(fail.isError).toBe(true);
    expect(fail.text).toContain('anahtarı silinmiş');

    // sahip HTTP'den temizlik reddi yapabilir
    const rej = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/proposals/${p2}/reject`, cookies, payload: {},
    });
    expect(rej.statusCode).toBe(200);
    expect(rej.json().proposal.status).toBe('rejected');

    // öneri + anahtar dolu kanvas silinebilir
    const del = await app.inject({ method: 'DELETE', url: `/api/canvases/${canvasId}/`, cookies });
    expect(del.statusCode).toBe(200);
    expect(await prisma.planProposal.count({ where: { canvasId } })).toBe(0);
  });

  it("viewer'ın bastığı anahtarın önerisi onaylanamaz (rol denetimi apply anında)", async () => {
    const { app, prisma, canvasId, agent, supervisor, state } = await cpSetup();
    const head0 = (await state()).headSeq;
    const sub = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'Deneme', intents: [{ op: 'add_node', title: 'D' }], baseSeq: head0,
    });
    const proposalId = (JSON.parse(sub.text) as { id: string }).id;

    // Anahtarı basan kişi apply anında viewer'sa uygulanmaz: token'ı viewer bir kullanıcıya taşı.
    const vUser = await prisma.user.create({ data: { username: 'izleyici', passwordHash: 'x' } });
    await prisma.canvasMember.create({ data: { canvasId, userId: vUser.id, role: 'viewer' } });
    await prisma.agentToken.update({ where: { id: agent.tokenId }, data: { createdById: vUser.id } });

    const fail = await callTool(app, supervisor.secret, 'approve_proposal', { id: proposalId });
    expect(fail.isError).toBe(true);
    expect(fail.text).toContain('görüntüleyici');
    // kanvas değişmedi
    expect((await state()).headSeq).toBe(head0);
  });
});

describe('MCP ucu: wait_for_changes (long-poll)', () => {
  type WaitResult = {
    headSeq: number;
    headAdvanced: boolean;
    changedProposals: { id: string; status: string | null; branchName: string | null }[];
    timedOut: boolean;
  };

  it('değişiklik yokken timeout süresi dolunca boş döner', async () => {
    const { app, agent, state } = await cpSetup();
    const head0 = (await state()).headSeq;
    const t0 = Date.now();
    const res = await callTool(app, agent.secret, 'wait_for_changes', { sinceSeq: head0, timeoutMs: 300 });
    expect(res.isError).toBe(false);
    const body = JSON.parse(res.text) as WaitResult;
    expect(body.timedOut).toBe(true);
    expect(body.headAdvanced).toBe(false);
    expect(body.headSeq).toBe(head0);
    expect(body.changedProposals).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
  });

  it('bekleme sırasında başka bir istemci commit atınca erken döner', async () => {
    const { app, cookies, canvasId, agent, state } = await cpSetup();
    const head0 = (await state()).headSeq;
    const t0 = Date.now();
    const waiting = callTool(app, agent.secret, 'wait_for_changes', { sinceSeq: head0, timeoutMs: 10_000 });
    // long-poll gerçekten beklemeye geçsin, sonra insan HTTP'den commit atsın
    await new Promise((r) => setTimeout(r, 150));
    const human = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/commit`, cookies,
      payload: { ops: [{ op: 'add_node', title: 'Araya giren' }], baseSeq: head0 },
    });
    expect(human.json().result).toBe('committed');
    const body = JSON.parse((await waiting).text) as WaitResult;
    expect(body.timedOut).toBe(false);
    expect(body.headAdvanced).toBe(true);
    expect(body.headSeq).toBe(head0 + 1);
    // timeout'u beklemedi
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('izlenen önerinin durumu değişince erken döner', async () => {
    const { app, agent, supervisor, state } = await cpSetup();
    const head0 = (await state()).headSeq;
    const sub = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'Beklenen', intents: [{ op: 'add_node', title: 'B' }], baseSeq: head0,
    });
    const proposalId = (JSON.parse(sub.text) as { id: string }).id;

    const t0 = Date.now();
    const waiting = callTool(app, agent.secret, 'wait_for_changes', {
      proposalIds: [proposalId], sinceSeq: head0, timeoutMs: 10_000,
    });
    await new Promise((r) => setTimeout(r, 150));
    const rc = await callTool(app, supervisor.secret, 'request_changes', {
      id: proposalId, note: 'Başlığı netleştir.',
    });
    expect(rc.isError).toBe(false);
    const body = JSON.parse((await waiting).text) as WaitResult;
    expect(body.timedOut).toBe(false);
    expect(body.headAdvanced).toBe(false);
    expect(body.changedProposals).toEqual([
      expect.objectContaining({ id: proposalId, status: 'changes_requested' }),
    ]);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("başka kanvasın token'ı öneriyi göremez; iptal edilmiş anahtar 401 alır", async () => {
    const { app, cookies, groupId, canvasId, agent, supervisor, state } = await cpSetup();
    const head0 = (await state()).headSeq;
    const sub = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'Gizli', intents: [{ op: 'add_node', title: 'G' }], baseSeq: head0,
    });
    const proposalId = (JSON.parse(sub.text) as { id: string }).id;

    // aynı grupta ikinci co-pronoia kanvası + oraya bağlı anahtar
    const canvasB = (await app.inject({
      method: 'POST', url: '/api/canvases', cookies, payload: { name: 'B', groupId, type: 'co-pronoia' },
    })).json().canvas.id as string;
    const roleB = (await app.inject({
      method: 'POST', url: `/api/groups/${groupId}/agent-roles`, cookies,
      payload: { name: 'Gözcü', persona: 'x', isSupervisor: false },
    })).json().role.id as string;
    const mintB = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasB}/agent-tokens`, cookies, payload: { roleId: roleB, label: 'b-ajan' },
    });
    const secretB = mintB.json().secret as string;
    const tokenB = mintB.json().token.id as string;

    // B'nin bekleyicisi A'daki durum değişikliğini ne görür ne de ondan uyanır
    const waiting = callTool(app, secretB, 'wait_for_changes', { proposalIds: [proposalId], timeoutMs: 800 });
    await new Promise((r) => setTimeout(r, 150));
    await callTool(app, supervisor.secret, 'request_changes', { id: proposalId, note: 'düzelt' });
    const body = JSON.parse((await waiting).text) as WaitResult;
    expect(body.timedOut).toBe(true);
    expect(body.changedProposals).toEqual([]);

    // iptal edilen anahtar araca hiç ulaşamaz
    await app.inject({ method: 'DELETE', url: `/api/canvases/${canvasB}/agent-tokens/${tokenB}`, cookies });
    const denied = await rpc(app, secretB, 'tools/call', {
      name: 'wait_for_changes', arguments: { timeoutMs: 0 },
    });
    expect(denied.statusCode).toBe(401);
  });
});

describe('Kanvas notu (brief): HTTP + MCP', () => {
  it('HTTP: boş varsayılan, editor+ yazar, viewer 403, üye olmayan 404, revizyonlar sıralı', async () => {
    const { app, sent, prisma, cookies, canvasId } = await cpSetup();

    let res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/brief`, cookies });
    expect(res.json().brief).toMatchObject({ content: '', authorLabel: null, revisionCount: 0 });

    res = await app.inject({
      method: 'PUT', url: `/api/canvases/${canvasId}/brief`, cookies, payload: { content: '# Hedef\nMVP ilk.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().brief).toMatchObject({ content: '# Hedef\nMVP ilk.', authorLabel: 'sahip', revisionCount: 1 });

    // viewer: okur ama yazamaz
    const viewer = await registerVerified(app, sent, { username: 'izleyici', password: 'sifre1', email: 'v@t.com' });
    const viewerId = viewer.res.json().user.id as string;
    await prisma.canvasMember.create({ data: { canvasId, userId: viewerId, role: 'viewer' } });
    res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/brief`, cookies: viewer.cookies });
    expect(res.json().brief.content).toBe('# Hedef\nMVP ilk.');
    res = await app.inject({
      method: 'PUT', url: `/api/canvases/${canvasId}/brief`, cookies: viewer.cookies, payload: { content: 'x' },
    });
    expect(res.statusCode).toBe(403);

    // üye olmayan 404 (membership preHandler)
    const outsider = await registerVerified(app, sent, { username: 'disarida', password: 'sifre1', email: 'd@t.com' });
    res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/brief`, cookies: outsider.cookies });
    expect(res.statusCode).toBe(404);

    // ikinci yazma yeni revizyon; geçmiş en yeniden eskiye
    await app.inject({
      method: 'PUT', url: `/api/canvases/${canvasId}/brief`, cookies, payload: { content: 'İkinci sürüm' },
    });
    res = await app.inject({ method: 'GET', url: `/api/canvases/${canvasId}/brief/revisions`, cookies });
    const revisions = res.json().revisions as { content: string; authorLabel: string }[];
    expect(revisions.map((r) => r.content)).toEqual(['İkinci sürüm', '# Hedef\nMVP ilk.']);
    expect(revisions[0].authorLabel).toBe('sahip');

    // içerik sınırı
    res = await app.inject({
      method: 'PUT', url: `/api/canvases/${canvasId}/brief`, cookies, payload: { content: 'a'.repeat(50_001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('MCP: update_brief tüm tokenlara açık, get_brief taşır, revizyon ajan iziyle yazılır', async () => {
    const { app, prisma, canvasId, agent, supervisor } = await cpSetup();

    // update_brief her iki token'ın tools/list çıktısında var
    for (const secret of [agent.secret, supervisor.secret]) {
      const res = await rpc(app, secret, 'tools/list');
      expect((res.json().result.tools as { name: string }[]).map((t) => t.name)).toContain('update_brief');
    }

    const upd = await callTool(app, agent.secret, 'update_brief', { content: 'Karar: ödeme Stripe ile.' });
    expect(upd.isError).toBe(false);
    expect(JSON.parse(upd.text)).toMatchObject({ ok: true, revisionCount: 1 });

    const brief = await callTool(app, supervisor.secret, 'get_brief');
    expect(brief.text).toContain('Kanvas notu');
    expect(brief.text).toContain('Karar: ödeme Stripe ile.');

    const row = await prisma.canvasBriefRevision.findFirst({ where: { canvasId }, orderBy: { id: 'desc' } });
    expect(row!.authorLabel).toBe('ajan-1/Mimar');

    // kanvas silinince revizyonlar da gider (deleteCanvas explicit delete)
    const { deleteCanvas } = await import('./canvasService.js');
    await deleteCanvas(prisma, canvasId);
    expect(await prisma.canvasBriefRevision.count({ where: { canvasId } })).toBe(0);
  });

  it('wait_for_changes: başka bir token brief güncelleyince briefChanged: true ile erken döner', async () => {
    const { app, agent, supervisor } = await cpSetup();
    type WaitBrief = { briefChanged: boolean; timedOut: boolean; headAdvanced: boolean };

    const waiting = callTool(app, supervisor.secret, 'wait_for_changes', { timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 150));
    await callTool(app, agent.secret, 'update_brief', { content: 'güncellendi' });
    const body = JSON.parse((await waiting).text) as WaitBrief;
    expect(body.timedOut).toBe(false);
    expect(body.briefChanged).toBe(true);
    expect(body.headAdvanced).toBe(false);

    // değişiklik yokken briefChanged false kalır
    const idle = await callTool(app, agent.secret, 'wait_for_changes', { timeoutMs: 200 });
    const idleBody = JSON.parse(idle.text) as WaitBrief;
    expect(idleBody.timedOut).toBe(true);
    expect(idleBody.briefChanged).toBe(false);
  });
});

describe('MCP ucu: bölge araçları', () => {
  type Region = { id: string; name: string; aiAllowed: boolean; x: number; width: number };

  it('süpervizör create_region ile çizer; list_regions herkese açık; worker create_region kullanamaz', async () => {
    const { app, cookies, canvasId, agent, supervisor } = await cpSetup();

    // Başlangıçta bölge yok — hem worker hem süpervizör list_regions çağırabilir.
    const empty = await callTool(app, agent.secret, 'list_regions');
    expect(empty.isError).toBe(false);
    expect(JSON.parse(empty.text)).toEqual([]);

    // Worker'ın create_region aracı yok (tools/list'te de kayıtlı değil) → method-not-found.
    const denied = await callTool(app, agent.secret, 'create_region', {
      name: 'Yasak', x: 0, y: 0, width: 100, height: 100,
    });
    expect(denied.rpcError ?? denied.isError).toBeTruthy();

    // Süpervizör bölge çizer.
    const made = await callTool(app, supervisor.secret, 'create_region', {
      name: 'Mimari Bölge', x: -1900, y: 200, width: 220, height: 620,
      description: 'mimari alt-ağacı', aiAllowed: false,
    });
    expect(made.isError).toBe(false);
    const madeBody = JSON.parse(made.text) as Region;
    expect(madeBody.name).toBe('Mimari Bölge');
    expect(madeBody.aiAllowed).toBe(false);

    // list_regions (worker) yeni bölgeyi görür.
    const listed = await callTool(app, agent.secret, 'list_regions');
    const regions = JSON.parse(listed.text) as Region[];
    expect(regions).toHaveLength(1);
    expect(regions[0].name).toBe('Mimari Bölge');
    expect(regions[0].x).toBe(-1900);
    expect(regions[0].width).toBe(220);

    // Aynı bölge HTTP state ucundan da görünür (MCP config'i normal kanvas config'ine yazdı).
    const httpRegions = (await app.inject({
      method: 'GET', url: `/api/canvases/${canvasId}/regions`, cookies,
    })).json().regions as { name: string }[];
    expect(httpRegions.map((r) => r.name)).toContain('Mimari Bölge');
  });

  it('create_region geçersiz dikdörtgeni (width<=0) reddeder', async () => {
    const { app, supervisor } = await cpSetup();
    const bad = await callTool(app, supervisor.secret, 'create_region', {
      name: 'Bozuk', x: 0, y: 0, width: 0, height: 100,
    });
    expect(bad.rpcError ?? bad.isError).toBeTruthy();
  });
});

describe('MCP ucu: token verimliliği (get_state sinceSeq/compact/fields, get_brief version, list_proposals sayfalama)', () => {
  /** Bir öneriyi gönderip süpervizörle onaylar (head'i bir commit ilerletir); proposalId döner. */
  async function submitAndApprove(
    app: App, agent: string, supervisor: string, title: string, intents: OpInput[], baseSeq: number,
  ) {
    const sub = await callTool(app, agent, 'submit_proposal', { title, intents, baseSeq });
    expect(sub.isError).toBe(false);
    const id = (JSON.parse(sub.text) as { id: string }).id;
    const ok = await callTool(app, supervisor, 'approve_proposal', { id });
    expect(ok.isError).toBe(false);
    return id;
  }

  it('get_state {sinceSeq}: değişen/eklenen düğümler + silinen id\'ler döner', async () => {
    const { app, serviceFor, canvasId, agent, supervisor, state } = await cpSetup();
    const head0 = (await state()).headSeq;

    await submitAndApprove(app, agent.secret, supervisor.secret, 'Ekle', [
      { op: 'add_node', id: 'n1', title: 'Alfa' },
      { op: 'add_node', id: 'n2', title: 'Beta' },
    ], head0);
    const head1 = (await state()).headSeq;

    // head0'dan bu yana: iki yeni düğüm değişmiş, hiçbiri silinmemiş.
    const d1 = JSON.parse((await callTool(app, agent.secret, 'get_state', { sinceSeq: head0 })).text) as {
      headSeq: number; sinceSeq: number;
      changedNodes: { id: string; title: string }[]; deletedNodeIds: string[];
      changedEdges: unknown[]; deletedEdgeIds: string[]; regions?: unknown;
    };
    expect(d1.headSeq).toBe(head1);
    expect(d1.sinceSeq).toBe(head0);
    expect(d1.changedNodes.map((n) => n.title).sort()).toEqual(['Alfa', 'Beta']);
    expect(d1.deletedNodeIds).toEqual([]);
    expect(d1.regions).toBeUndefined(); // delta regions taşımaz

    // Bir düğümü sil → sinceSeq=head1 farkı yalnız silmeyi gösterir.
    await submitAndApprove(app, agent.secret, supervisor.secret, 'Sil', [
      { op: 'delete_node', id: 'n2' },
    ], head1);
    const d2 = JSON.parse((await callTool(app, agent.secret, 'get_state', { sinceSeq: head1 })).text) as {
      changedNodes: { id: string }[]; deletedNodeIds: string[];
    };
    expect(d2.deletedNodeIds).toEqual(['n2']);
    expect(d2.changedNodes).toEqual([]);

    // sinceSeq = güncel head → boş fark.
    const headNow = (await state()).headSeq;
    const empty = JSON.parse((await callTool(app, agent.secret, 'get_state', { sinceSeq: headNow })).text) as {
      changedNodes: unknown[]; deletedNodeIds: unknown[]; changedEdges: unknown[]; deletedEdgeIds: unknown[];
    };
    expect(empty.changedNodes).toEqual([]);
    expect(empty.deletedNodeIds).toEqual([]);
    expect(empty.changedEdges).toEqual([]);
    expect(empty.deletedEdgeIds).toEqual([]);
    await serviceFor(canvasId).rebuildCheck();
  });

  it('get_state {compact} sunum alanlarını düşürür; {fields} yalnız istenen alanları verir', async () => {
    const { app, agent, supervisor, state } = await cpSetup();
    const head0 = (await state()).headSeq;
    await submitAndApprove(app, agent.secret, supervisor.secret, 'Ekle', [
      { op: 'add_node', id: 'n1', title: 'Alfa', x: 10, y: 20 },
    ], head0);

    const compact = JSON.parse((await callTool(app, agent.secret, 'get_state', { compact: true })).text) as {
      nodes: Record<string, unknown>[];
    };
    for (const n of compact.nodes) {
      expect(n).not.toHaveProperty('x');
      expect(n).not.toHaveProperty('y');
      expect(n).not.toHaveProperty('url');
      expect(n).not.toHaveProperty('urlBy');
      expect(n).toHaveProperty('id');
      expect(n).toHaveProperty('title');
    }

    const projected = JSON.parse((await callTool(app, agent.secret, 'get_state', {
      fields: ['title', 'status', 'bilinmeyen'],
    })).text) as { nodes: Record<string, unknown>[] };
    const alfa = projected.nodes.find((n) => n.title === 'Alfa')!;
    expect(Object.keys(alfa).sort()).toEqual(['id', 'status', 'title']); // id her zaman, bilinmeyen atılır
  });

  it('get_brief version imzası: knownVersion aynıysa "değişmedi", brief değişince version değişir', async () => {
    const { app, agent } = await cpSetup();
    const b1 = await callTool(app, agent.secret, 'get_brief');
    const version = /Sürüm \(version\): ([0-9a-f]+)/.exec(b1.text)![1];
    expect(version).toHaveLength(16);

    // Aynı version → kısa "değişmedi" yanıtı, tam brief değil.
    const unchanged = JSON.parse((await callTool(app, agent.secret, 'get_brief', { knownVersion: version })).text) as {
      unchanged: boolean; version: string;
    };
    expect(unchanged.unchanged).toBe(true);
    expect(unchanged.version).toBe(version);

    // Kanvas notu değişince version da değişir → tam brief yeniden döner.
    await callTool(app, agent.secret, 'update_brief', { content: 'Yeni ortak hedef.' });
    const b2 = await callTool(app, agent.secret, 'get_brief', { knownVersion: version });
    expect(b2.text).toContain('Sürüm (version):');
    expect(b2.text).toContain('Yeni ortak hedef.');
    const version2 = /Sürüm \(version\): ([0-9a-f]+)/.exec(b2.text)![1];
    expect(version2).not.toBe(version);
  });

  it('list_proposals {limit, sinceUpdatedAt}: sayfalama ve artımlı süzgeç', async () => {
    const { app, agent, supervisor, state } = await cpSetup();
    const head0 = (await state()).headSeq;
    const s1 = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'Öneri 1', intents: [{ op: 'add_node', id: 'a', title: 'A' }], baseSeq: head0,
    });
    expect(s1.isError).toBe(false);
    const s2 = await callTool(app, supervisor.secret, 'submit_proposal', {
      title: 'Öneri 2', intents: [{ op: 'add_node', id: 'b', title: 'B' }], baseSeq: head0,
    });
    expect(s2.isError).toBe(false);

    const all = JSON.parse((await callTool(app, agent.secret, 'list_proposals')).text) as
      { id: string; title: string; updatedAt: string }[];
    expect(all).toHaveLength(2);

    // limit sonucu keser (createdAt asc → ilk öneri).
    const limited = JSON.parse((await callTool(app, agent.secret, 'list_proposals', { limit: 1 })).text) as
      { title: string }[];
    expect(limited).toHaveLength(1);
    expect(limited[0].title).toBe('Öneri 1');

    // sinceUpdatedAt = 1. önerinin updatedAt'i → yalnız daha yeni (2.) öneri döner.
    const p1 = all.find((p) => p.title === 'Öneri 1')!;
    const since = JSON.parse((await callTool(app, agent.secret, 'list_proposals', {
      sinceUpdatedAt: p1.updatedAt,
    })).text) as { title: string }[];
    expect(since.map((p) => p.title)).toEqual(['Öneri 2']);

    // Gelecekteki bir tarih → boş.
    const future = JSON.parse((await callTool(app, agent.secret, 'list_proposals', {
      sinceUpdatedAt: '2999-01-01T00:00:00.000Z',
    })).text) as unknown[];
    expect(future).toEqual([]);
  });
});

describe('MCP ucu: çoklu rollü bağlantı (tek anahtar, birden çok rol)', () => {
  /** cpSetup'ın grubunda İKİ EK rol (biri normal, biri süpervizör) tanımlayıp ikisine bağlı TEK anahtar basar. */
  async function multiRoleSetup() {
    const ctx = await cpSetup();
    const { app, cookies, groupId, canvasId } = ctx;
    const mkRole = async (name: string, isSupervisor: boolean) =>
      (await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/agent-roles`, cookies,
        payload: { name, persona: `${name} personası.`, isSupervisor },
      })).json().role.id as string;
    const techRole = await mkRole('Teknik', false);
    const chiefRole = await mkRole('Baş', true);
    const mint = await app.inject({
      method: 'POST', url: `/api/canvases/${canvasId}/agent-tokens`, cookies,
      payload: { roleIds: [techRole, chiefRole], label: 'çoklu-1' },
    });
    const secret = mint.json().secret as string;
    return { ...ctx, secret, canvasId };
  }

  it('tools/list süpervizör araçlarını gösterir (rollerden biri süpervizör olduğu için)', async () => {
    const { app, secret } = await multiRoleSetup();
    const res = await rpc(app, secret, 'tools/list');
    const names = (res.json().result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['approve_proposal', 'reject_proposal', 'request_changes', 'create_region']));
  });

  it('role verilmeden rol-bağımlı araç çağrısı Türkçe hata verir; bilinmeyen rol adı reddedilir; get_brief tüm rolleri listeler', async () => {
    const { app, secret } = await multiRoleSetup();

    const noRole = await callTool(app, secret, 'get_brief');
    expect(noRole.isError).toBe(true);
    expect(noRole.text).toMatch(/rol/i);
    expect(noRole.text).toContain('Teknik');
    expect(noRole.text).toContain('Baş');

    const unknownRole = await callTool(app, secret, 'get_brief', { role: 'Yok Böyle Rol' });
    expect(unknownRole.isError).toBe(true);
    expect(unknownRole.text).toMatch(/bilinmeyen rol/i);

    const withRole = await callTool(app, secret, 'get_brief', { role: 'Teknik' });
    expect(withRole.isError).toBe(false);
    expect(withRole.text).toContain('Teknik personası.');
    expect(withRole.text).toContain('BİRDEN ÇOK role bağlı');
  });

  it('rol adıyla öneri gönderir (roleName doğru kaydedilir); teknik rolle onay denemesi reddedilir; süpervizör rolüyle onay çalışır', async () => {
    const { app, secret } = await multiRoleSetup();
    const head0 = JSON.parse((await callTool(app, secret, 'get_state')).text).headSeq as number;

    // role verilmeden submit → hata
    const noRole = await callTool(app, secret, 'submit_proposal', {
      title: 'X', intents: [{ op: 'add_node', title: 'A' }], baseSeq: head0,
    });
    expect(noRole.isError).toBe(true);

    // role: 'Teknik' ile öneri
    const sub = await callTool(app, secret, 'submit_proposal', {
      title: 'Teknik plan', intents: [{ op: 'add_node', title: 'A' }], baseSeq: head0, role: 'Teknik',
    });
    expect(sub.isError).toBe(false);
    const proposalId = (JSON.parse(sub.text) as { id: string }).id;
    const list = JSON.parse((await callTool(app, secret, 'list_proposals')).text) as
      { id: string; roleName: string; agentLabel: string }[];
    const prop = list.find((p) => p.id === proposalId)!;
    expect(prop.roleName).toBe('Teknik');
    expect(prop.agentLabel).toBe('çoklu-1');

    // aynı bağlantı, teknik (süpervizör olmayan) rolle onay dener → reddedilir
    const approveAsTech = await callTool(app, secret, 'approve_proposal', { id: proposalId, role: 'Teknik' });
    expect(approveAsTech.isError).toBe(true);
    expect(approveAsTech.text).toMatch(/süpervizör değil/);

    // süpervizör (Baş) rolüyle onay çalışır
    const approveAsChief = await callTool(app, secret, 'approve_proposal', { id: proposalId, role: 'Baş' });
    expect(approveAsChief.isError).toBe(false);
    expect(approveAsChief.text).toContain('uygulandı');
  });

  it('tek rollü token role parametresi verilmeden eskisi gibi çalışmaya devam eder', async () => {
    const { app, agent, supervisor } = await cpSetup();
    const brief = await callTool(app, agent.secret, 'get_brief');
    expect(brief.isError).toBe(false);
    expect(brief.text).toContain('Mimar personası.');

    const head0 = JSON.parse((await callTool(app, agent.secret, 'get_state')).text).headSeq as number;
    const sub = await callTool(app, agent.secret, 'submit_proposal', {
      title: 'Tek rol', intents: [{ op: 'add_node', title: 'A' }], baseSeq: head0,
    });
    expect(sub.isError).toBe(false);
    const proposalId = (JSON.parse(sub.text) as { id: string }).id;
    const approved = await callTool(app, supervisor.secret, 'approve_proposal', { id: proposalId });
    expect(approved.isError).toBe(false);
  });
});
