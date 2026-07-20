import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { testDbFactory } from './testDb.js';
import { captureEmails, registerVerified } from './testAuth.js';
import type { OpInput } from '@treemapper/shared';

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
    expect(res.json().result.serverInfo.name).toBe('treemapper-co-pronoia');

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
    expect(agentTools).not.toContain('approve_proposal');
    const supTools = await names(supervisor.secret);
    expect(supTools).toEqual(expect.arrayContaining(['approve_proposal', 'reject_proposal', 'request_changes']));
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
