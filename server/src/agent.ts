import type { PrismaClient } from '@prisma/client';
import type { GraphState, OpInput, RegionInfo } from '@treemapper/shared';
import {
  ConflictError, RegionError, ValidationError,
  type Actor, type CommitOutcome, type CommitService,
} from './commitService.js';
import { listRegions } from './canvasService.js';

/** Model çağrısı enjekte edilebilir: testler sahte bir LLM verir, route Gemini'yi kullanır. */
export type Llm = (system: string, user: string) => Promise<string>;

export interface AgentResult {
  reply: string;
  committed: boolean;
  commitSeq?: number;
  opCount?: number;
  branched?: boolean;
  branch?: string;
  error?: string;
  /** Committed/branched sonucu — route WS yayını için kullanır, HTTP yanıtından ayıklanır. */
  outcome?: CommitOutcome;
}

export const geminiConfigured = (): boolean => Boolean(process.env.GEMINI_API_KEY);

/** Çizim detay düzeyi: proto = hızlı iskelet, detailed = kapsamlı döküm. */
export type AgentDetail = 'proto' | 'detailed';

/**
 * Detay düzeyine göre model sırası: prototip hafif modeli (ayrı ve geniş ücretsiz kota),
 * detaylı tam modeli kullanır; ilki kota/yoğunluk yüzünden düşerse diğerine geçilir.
 * `GEMINI_MODEL_PROTO` / `GEMINI_MODEL` env değişkenleriyle ezilebilir.
 */
function modelsFor(detail: AgentDetail): string[] {
  const lite = process.env.GEMINI_MODEL_PROTO || 'gemini-flash-lite-latest';
  const full = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  return [...new Set(detail === 'proto' ? [lite, full] : [full, lite])];
}

async function geminiGenerate(system: string, user: string, models: string[]): Promise<string> {
  let lastErr = 'model listesi boş';
  for (const model of models) {
    // 429/503 (kota/yoğunluk) geçici olabilir: bir kısa deneme daha, sonra sıradaki model.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      }
      const body = (await res.text()).slice(0, 300);
      lastErr = `(${res.status}, ${model}): ${body}`;
      if (res.status === 429 || res.status === 503) {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
        continue; // ikinci denemede de düşerse iç döngü biter → sıradaki model
      }
      if (res.status === 404) break; // model bu hesapta yok → sıradaki model
      throw new Error(`Gemini isteği başarısız ${lastErr}`);
    }
  }
  throw new Error(`Gemini isteği başarısız ${lastErr}`);
}

function buildSystemPrompt(detail: AgentDetail): string {
  return [
    'Sen TreeMapper adlı iş birlikli planlama uygulaması için çalışan bir ajansın. Sana bir kanvasın güncel durumu (düğümler, kenarlar, bölgeler), kullanıcının yetkileri ve doğal dildeki isteği verilir.',
    '',
    'YALNIZCA geçerli bir JSON nesnesi döndür (markdown, kod bloğu, ek metin YOK). İki mod var:',
    '1) Bilgi/özet isteği ("özetle", "anlat", "listele", "durum ne"): {"mode":"summary","reply":"<Türkçe yanıt>"}',
    '2) Değişiklik/diyagram isteği ("çiz", "ekle", "oluştur", "diyagramını yap"): {"mode":"diagram","reply":"<yapılanın Türkçe özeti>","message":"<kısa commit mesajı>","ops":[...]}',
    '',
    'ops dizisindeki geçerli işlemler (intent şemaları — alanlara birebir uy):',
    '- {"op":"add_node","id":"<benzersiz kısa id>","title":"...","parentId":"<mevcut düğüm id, isteğe bağlı>","description":"...","nodeType":"task|idea|feature|milestone","status":"planned|in_progress|done","x":<sayı>,"y":<sayı>}',
    '- {"op":"add_edge","sourceId":"...","targetId":"...","kind":"flow|loop|dependency|relation","label":"...","direction":"directed|bidirectional"}',
    '- {"op":"update_node","id":"...","fields":{"title"?,"description"?,"nodeType"?,"status"?,"parentId"?}}',
    '- {"op":"move_node","id":"...","x":<sayı>,"y":<sayı>}',
    '- {"op":"delete_node","id":"..."} ve {"op":"delete_edge","id":"..."}',
    '',
    'KURALLAR:',
    '- EN ÖNEMLİ KURAL — parentId: add_node işlemlerine parentId alanını EKLEME; yeni düğümler bağımsız olur, bu istenen davranıştır. MEVCUT bir düğümün id\'sini parentId olarak kullanmak YASAKTIR — tek istisna: kullanıcı isteğinde açıkça bir üst düğüm adı geçirdi ya da "şu düğümü alt adımlara böl" gibi bir kırılım istedi. Kendi eklediğin düğümler arasında hiyerarşi gerekiyorsa parentId olarak yalnızca KENDİ verdiğin yeni id\'leri kullanabilirsin. KÖTÜ örnek: {"op":"add_node","id":"ai-a1","parentId":"<kanvastaki kök düğümün id\'si>",...} — bunu yapma.',
    '- Yeni düğümlere kendin id ver (ör. "ai-a1") ve kenarlarda bu id\'leri kullan; mevcut id\'lerle çakışmasın.',
    '- BÖLGE KURALI (kesin): Kullanıcı bir bölge adı verdiyse yeni düğümlerin TAMAMINA x/y koordinatı ver ve HEPSİ o bölgenin dikdörtgeninin İÇİNDE kalsın — koordinatları dikdörtgenin x/y/width/height değerlerinden hesapla, kenarlardan en az 20 birim içeride kal, tek düğüm bile dışarı taşmasın. Bir düğüm yaklaşık 220x100 birim yer kaplar; düğümleri en az 240 birim yatay / 130 birim dikey aralıkla ızgara gibi diz, bölgedeki mevcut düğümlerin üstüne bindirme. Akış diyagramlarında akış yönünde sırala.',
    '- Bölge belirtilmediyse x/y VERME (null bırakılır, düğüm bölge dışı sayılır) ya da bölgelerin dışında bir koordinat seç.',
    '- KULLANICININ YETKİSİ bölümüne uy: yazamadığı bölgelerdeki düğümlere/kenarlara DOKUNMA ve o bölgelerin içine yeni düğüm KOYMA; böyle bir istek gelirse mode "summary" ile nedenini açıkla.',
    '- Özet/analiz isteklerinde ASLA ops üretme; mode "summary" olsun.',
    '- Kullanıcı açıkça silme istemedikçe delete_node / delete_edge kullanma.',
    '- Kullanıcı bir bölgeden bahsediyorsa düğümlerin "regions" alanına bakarak o bölgedeki düğümleri esas al.',
    '- reply her zaman Türkçe, kısa ve net olsun.',
    '',
    detail === 'detailed'
      ? 'DETAY DÜZEYİ: DETAYLI. İsteği kapsamlı bir plana dök: ana adımları alt adımlara ayır (duruma göre 6-15 düğüm), her düğüme 1-2 cümlelik anlamlı bir description yaz, uygun nodeType/status seç, adımlar arasındaki bağımlılıkları dependency, ilgili kavramları relation kenarlarıyla bağla.'
      : 'DETAY DÜZEYİ: PROTOTİP. İsteğin en yalın iskeletini çiz: 3-6 düğümü geçme, description\'ları boş bırak ya da tek cümle tut, yalnızca ana akış kenarlarını ekle. Ayrıntıya girme — kullanıcı isterse sonra "detaylı" modda genişletir.',
  ].join('\n');
}

/** Aktörün yazabildiği bölgeler: sahip hepsine, diğerleri üyesi olduklarına yazar. */
function writableRegions(regions: RegionInfo[], actor: Actor): RegionInfo[] {
  if (actor.role === 'owner') return regions;
  return regions.filter((r) => r.memberIds.includes(actor.userId));
}

function buildUserText(
  canvasName: string, state: GraphState, regions: RegionInfo[], actor: Actor, prompt: string,
): string {
  const inRegion = (n: { x: number | null; y: number | null }, r: RegionInfo) =>
    n.x != null && n.y != null &&
    n.x >= r.x && n.x <= r.x + r.width &&
    n.y >= r.y && n.y <= r.y + r.height;

  const nodes = state.nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    title: n.title,
    description: n.description.slice(0, 300),
    nodeType: n.nodeType,
    status: n.status,
    x: n.x,
    y: n.y,
    regions: regions.filter((r) => inRegion(n, r)).map((r) => r.name),
  }));
  const edges = state.edges.map((e) => ({
    id: e.id, sourceId: e.sourceId, targetId: e.targetId,
    kind: e.kind, direction: e.direction, label: e.label,
  }));
  const regionInfo = regions.map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height }));

  const writable = writableRegions(regions, actor);
  const permission =
    actor.role === 'viewer'
      ? 'rol: viewer — salt okunur, HİÇBİR değişiklik yapamaz.'
      : `rol: ${actor.role}. Yazabildiği bölgeler: ${
          writable.length === regions.length
            ? 'HEPSİ'
            : writable.length === 0
              ? 'HİÇBİRİ (yalnızca bölge dışı alan)'
              : writable.map((r) => `"${r.name}"`).join(', ')
        }. Bölge dışı alan serbest.`;

  return [
    `Kanvas: ${canvasName}`,
    '',
    `KULLANICININ YETKİSİ: ${permission}`,
    '',
    `BÖLGELER: ${JSON.stringify(regionInfo)}`,
    '',
    `DÜĞÜMLER: ${JSON.stringify(nodes)}`,
    '',
    `KENARLAR: ${JSON.stringify(edges)}`,
    '',
    `KULLANICI İSTEĞİ: ${prompt}`,
  ].join('\n');
}

const ALLOWED_OPS = new Set(['add_node', 'update_node', 'delete_node', 'move_node', 'add_edge', 'delete_edge']);

/** Model çıktısını çöz: JSON değilse metni özet yanıtı say; ops yalnızca "diagram" modunda geçerli. */
function parseModelOutput(raw: string): { reply: string; message: string; ops: OpInput[] } {
  const text = raw.trim().replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  type ModelOut = { mode?: string; reply?: unknown; message?: unknown; ops?: unknown };
  let out: ModelOut | null = null;
  // Model ara sıra kapanış parantezlerini yutuyor; eksik }/] tamamlayarak da dene.
  for (const candidate of [text, text + '}', text + ']}', text + '"}']) {
    try {
      out = JSON.parse(candidate) as ModelOut;
      break;
    } catch {
      /* sıradakini dene */
    }
  }
  if (!out) {
    const replyMatch = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
    out = {
      mode: 'summary',
      reply: replyMatch ? (JSON.parse(`"${replyMatch[1]}"`) as string) : text || 'Modelden kullanılabilir bir yanıt alınamadı.',
    };
  }
  let ops = Array.isArray(out.ops)
    ? (out.ops.filter((o) => o && typeof o === 'object' && ALLOWED_OPS.has((o as { op?: string }).op ?? '')) as OpInput[])
    : [];
  if (out.mode !== 'diagram') ops = [];
  return {
    reply: String(out.reply ?? ''),
    message: String(out.message || 'ajan değişikliği'),
    ops,
  };
}

/**
 * Kanvas üstünde tek atımlık ajan turu: durumu topla → modele sor → gerekiyorsa tek commit at.
 * Actor isteği yapan kullanıcıdır: bölge ve rol kuralları normal commit'lerle birebir aynı işler.
 */
export async function runAgent(opts: {
  prisma: PrismaClient;
  service: CommitService;
  canvasId: string;
  canvasName: string;
  prompt: string;
  actor: Actor;
  detail?: AgentDetail;
  llm?: Llm;
}): Promise<AgentResult> {
  const { prisma, service, canvasId, canvasName, prompt, actor, detail = 'proto' } = opts;
  const llm: Llm = opts.llm ?? ((s, u) => geminiGenerate(s, u, modelsFor(detail)));

  const [state, regions] = await Promise.all([service.getState(), listRegions(prisma, canvasId)]);
  const raw = await llm(buildSystemPrompt(detail), buildUserText(canvasName, state, regions, actor, prompt));
  const { reply, message, ops } = parseModelOutput(raw);

  if (ops.length === 0) return { reply, committed: false };

  if (actor.role === 'viewer') {
    return {
      reply: `Bu kanvasta "viewer" rolünde olduğunuz için değişiklik yapamıyorum. İstenen değişiklik: ${reply}`,
      committed: false,
    };
  }

  try {
    const outcome = await service.commit(ops, {
      message: `ajan: ${message}`,
      baseSeq: state.headSeq,
      authorId: actor.userId,
      actor,
    });
    if (outcome.result === 'committed') {
      return { reply, committed: true, commitSeq: outcome.commit.seq, opCount: ops.length, outcome };
    }
    return {
      reply: `${reply}\n\nNot: bu sırada kanvas değişip çakışma oluştuğu için değişiklikler "${outcome.branch.name}" dalına yazıldı. Dallar panelinden birleştirebilir veya iptal edebilirsiniz.`,
      committed: false,
      branched: true,
      branch: outcome.branch.name,
      outcome,
    };
  } catch (err) {
    if (err instanceof RegionError || err instanceof ValidationError || err instanceof ConflictError) {
      return {
        reply: `Değişiklik uygulanamadı: ${err.message}\n\nPlanlanan değişiklik: ${reply}`,
        committed: false,
        error: err.message,
      };
    }
    throw err;
  }
}
