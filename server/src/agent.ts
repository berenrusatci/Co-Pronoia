import type { PrismaClient } from '@prisma/client';
import type { GraphState, OpInput, RegionInfo } from '@treemapper/shared';
import { buildFlowLayoutOps } from '@treemapper/shared';
import {
  ConflictError, RegionError, ValidationError,
  type Actor, type CommitOutcome, type CommitService,
} from './commitService.js';
import { createRegion, listRegions } from './canvasService.js';

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
}

export const geminiConfigured = (): boolean => Boolean(process.env.GEMINI_API_KEY);

/**
 * Çizim detay düzeyi: proto = hızlı iskelet, detailed = kapsamlı döküm. Modeli bu seçer.
 * `stepwise` (parça parça) bundan bağımsız bir bayraktır: iş parçalara bölünür, her parça
 * seçili detay düzeyinde ayrı bir LLM çağrısı + ayrı bir commit olur.
 */
export type AgentDetail = 'proto' | 'detailed';

/** Parça parça modda toplam parça üst sınırı (ilk parça + kalanlar). */
const MAX_PARTS = 6;

/** Bir turda modelin oluşturabileceği en fazla yeni bölge. */
const MAX_NEW_REGIONS = 4;

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

function buildSystemPrompt(detail: AgentDetail, stepwise: boolean, canCreateRegions: boolean): string {
  return [
    'Sen TreeMapper adlı iş birlikli planlama uygulaması için çalışan bir ajansın. Sana bir kanvasın güncel durumu (düğümler, kenarlar, bölgeler), kullanıcının yetkileri ve doğal dildeki isteği verilir.',
    '',
    'YALNIZCA geçerli bir JSON nesnesi döndür (markdown, kod bloğu, ek metin YOK). Üç mod var:',
    '1) Bilgi/özet isteği ("özetle", "anlat", "listele", "durum ne"): {"mode":"summary","reply":"<Türkçe yanıt>"}',
    '2) Değişiklik/diyagram isteği ("çiz", "ekle", "oluştur", "diyagramını yap"): {"mode":"diagram","reply":"<yapılanın Türkçe özeti>","message":"<kısa commit mesajı>","ops":[...]}',
    '3) Zihin haritası hiyerarşisini akış diyagramına dökme isteği ("zihin haritasını akışa dök", "hiyerarşiyi akış diyagramına aktar", "her bölgeyi ayrı diyagram olarak diz", "bölgeleri ayrı ayrı akışa çıkar"): {"mode":"layout","reply":"<Türkçe kısa yanıt>"} — ops ÜRETME, koordinat/kenar HESAPLAMA. Sunucu yerleşimi kendisi deterministik yapar; sen yalnızca bu modu döndür.',
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
    '- AI\'YA KAPALI BÖLGELER (kesin): "aiAllowed": false olan bölgelerdeki düğümlere/kenarlara DOKUNMA ve o bölgelerin içine yeni düğüm KOYMA — bu bölgelerde AI çalışması yasaktır, kullanıcı orada bir iş istese bile. Böyle bir istek gelirse o bölge için yapamayacağını reply\'de kısaca belirt AMA istekteki AI\'ya açık/bölge dışı diğer işleri normal şekilde yapmaya devam et (mümkünse yine mode "diagram" döndür).',
    '- BÖLGE AÇIKLAMALARI: Her bölgenin "description" alanı varsa, o bölgenin içinde ya da onunla ilgili iş üretirken açıklamayı bağlam/yönerge olarak kullan (ör. o bölgeye eklediğin düğümlerin içeriği açıklamaya uygun olsun).',
    '- Özet/analiz isteklerinde ASLA ops üretme; mode "summary" olsun.',
    '- Kullanıcı açıkça silme istemedikçe delete_node / delete_edge kullanma.',
    '- Kullanıcı bir bölgeden bahsediyorsa düğümlerin "regions" alanına bakarak o bölgedeki düğümleri esas al.',
    '- SEÇİLİ DÜĞÜMLER verilmişse komutun hedefi onlardır: "detaylandır / alt adımlara böl" → her seçili düğüm için alt adımlar üret (kırılım istendiği için parentId olarak o seçili düğümün id\'sini kullanabilirsin); "değiştir / yeniden adlandır / durumunu güncelle" → update_node ile o düğümleri güncelle; "bundan sonrasını ... şekilde çiz" → akışı seçili düğümden devam ettir, ilk yeni düğümü ona bir kenarla bağla ve kullanıcı isterse seçili düğümden SONRAKİ mevcut akışı değiştir. Seçili düğümlerin konumuna yakın koordinatlar tercih et (bölge kuralı önceliklidir).',
    ...(canCreateRegions
      ? [
          `- BÖLGE OLUŞTURMA: Kullanıcı yeni bir bölge/alan oluşturmayı isterse (ya da istek belirgin biçimde ayrı bir çalışma alanı gerektiriyorsa) diagram yanıtına "newRegions" dizisi ekle: [{"name":"...","x":<sayı>,"y":<sayı>,"width":<sayı>,"height":<sayı>,"description":"<bölgenin amacını anlatan 1-2 cümle>"}] (en fazla ${MAX_NEW_REGIONS}). Mevcut bölgelerle ve düğümlerle ÇAKIŞMAYAN boş bir alan seç; dikdörtgeni içine koyacağın düğümlere yetecek kadar büyük tut (düğüm başına ~240x130, ör. 6 düğüm için en az 800x500). Bölgeler sunucuda AI izni açık olarak oluşturulur ve kanvas sahibi tarafından yönetilir. Ardından ops'taki yeni düğümleri BÖLGE KURALI'na uyarak bu dikdörtgenin içine yerleştir ve içeriği bölgenin adına/açıklamasına uygun doldur.`,
        ]
      : ['- BÖLGE OLUŞTURMA yalnızca kanvas sahibinin ajanına açıktır; bu kullanıcı sahip değil — "newRegions" alanı KULLANMA. Bölge oluşturma isteğini mode "summary" ile kibarca reddet (diğer işleri normal yap).']),
    '- reply her zaman Türkçe, kısa ve net olsun.',
    '',
    detail === 'detailed'
      ? 'DETAY DÜZEYİ: DETAYLI. İsteği kapsamlı bir plana dök: ana adımları alt adımlara ayır (duruma göre 6-15 düğüm), her düğüme 1-2 cümlelik anlamlı bir description yaz, uygun nodeType/status seç, adımlar arasındaki bağımlılıkları dependency, ilgili kavramları relation kenarlarıyla bağla.'
      : 'DETAY DÜZEYİ: PROTOTİP. İsteğin en yalın iskeletini çiz: 3-6 düğümü geçme, description\'ları boş bırak ya da tek cümle tut, yalnızca ana akış kenarlarını ekle. Ayrıntıya girme — kullanıcı isterse sonra "detaylı" modda genişletir.',
    ...(stepwise
      ? [
          '',
          `ÜRETİM BİÇİMİ: PARÇA PARÇA. İsteği en fazla ${MAX_PARTS} mantıksal parçaya böl (parçalar birlikte isteği tam kapsasın). ŞİMDİ YALNIZCA İLK PARÇANIN düğümlerini üret — parça içeriği yukarıdaki DETAY DÜZEYİ kurallarına uysun (düğüm sayısı/description yoğunluğu parça başına geçerlidir). Diagram yanıtına ek bir "parts" alanı koy: KALAN parçaların kısa Türkçe başlıklarından oluşan dizi (en fazla ${MAX_PARTS - 1} öğe; istek tek parçada bitiyorsa boş dizi). Kalan parçalar sana sonraki isteklerde tek tek sorulacak.`,
        ]
      : []),
  ].join('\n');
}

/** Aktörün yazabildiği bölgeler: sahip hepsine, diğerleri üyesi olduklarına yazar. */
function writableRegions(regions: RegionInfo[], actor: Actor): RegionInfo[] {
  if (actor.role === 'owner') return regions;
  return regions.filter((r) => r.memberIds.includes(actor.userId));
}

/** İterative modda o an üretilen parça: follow-up isteklerin bağlamı. */
interface CurrentPart {
  title: string;
  index: number; // 1 tabanlı
  total: number;
  remaining: string[];
}

function buildUserText(
  canvasName: string, state: GraphState, regions: RegionInfo[], actor: Actor,
  prompt: string, selectedIds: string[], selectedRegionIds: string[],
  currentPart?: CurrentPart,
): string {
  const inRegion = (n: { x: number | null; y: number | null }, r: RegionInfo) =>
    n.x != null && n.y != null &&
    n.x >= r.x && n.x <= r.x + r.width &&
    n.y >= r.y && n.y <= r.y + r.height;

  // Seçili bölgeler: açıklamaları bağlam olarak gider, içlerindeki tüm düğümler de seçime katılır.
  const selectedRegions = selectedRegionIds
    .map((id) => regions.find((r) => r.id === id))
    .filter((r): r is RegionInfo => r !== undefined);
  const regionNodeIds = state.nodes
    .filter((n) => selectedRegions.some((r) => inRegion(n, r)))
    .map((n) => n.id);
  const effectiveSelectedIds = [...new Set([...selectedIds, ...regionNodeIds])];

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
  const regionInfo = regions.map((r) => ({
    id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height,
    aiAllowed: r.aiAllowed, description: r.description.slice(0, 500),
  }));

  const writable = writableRegions(regions, actor);
  const aiClosed = regions.filter((r) => !r.aiAllowed);
  const permission =
    actor.role === 'viewer'
      ? 'rol: viewer — salt okunur, HİÇBİR değişiklik yapamaz.'
      : `rol: ${actor.role}. Yazabildiği bölgeler: ${
          writable.length === regions.length
            ? 'HEPSİ'
            : writable.length === 0
              ? 'HİÇBİRİ (yalnızca bölge dışı alan)'
              : writable.map((r) => `"${r.name}"`).join(', ')
        }. Bölge dışı alan serbest.${
          aiClosed.length > 0
            ? ` AI'YA KAPALI bölgeler (dokunma, içine düğüm koyma): ${aiClosed.map((r) => `"${r.name}"`).join(', ')}.`
            : ''
        }`;

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
    ...(selectedRegions.length > 0
      ? [
          `SEÇİLİ BÖLGELER (kullanıcı bunları kanvasta işaretledi; açıklamalarını bağlam/yönerge olarak kullan, komutun hedefi bu bölgeler ve içlerindeki düğümlerdir): ${JSON.stringify(
            selectedRegions.map((r) => ({ id: r.id, name: r.name, description: r.description.slice(0, 500), aiAllowed: r.aiAllowed })),
          )}`,
          '',
        ]
      : []),
    ...(() => {
      const selected = effectiveSelectedIds
        .map((id) => state.nodes.find((n) => n.id === id))
        .filter((n): n is NonNullable<typeof n> => n !== undefined)
        .map((n) => ({ id: n.id, title: n.title }));
      return selected.length > 0
        ? [
            `SEÇİLİ DÜĞÜMLER (kullanıcı bunları kanvasta işaretledi ya da seçili bir bölgenin içindeler; istekteki "bu/şu adım(lar)", "seçili düğümler", "buradan sonrası" gibi ifadeler BUNLARA işaret eder — detaylandırma/değiştirme/devamını çizme komutlarını bu düğümler üzerinde uygula): ${JSON.stringify(selected)}`,
            '',
          ]
        : [];
    })(),
    `KULLANICI İSTEĞİ: ${prompt}`,
    ...(currentPart
      ? [
          '',
          `ŞİMDİKİ PARÇA (${currentPart.index}/${currentPart.total}): "${currentPart.title}" — isteğin önceki parçaları yukarıdaki DÜĞÜMLER listesinde zaten var. YALNIZCA bu parçanın düğümlerini DETAY DÜZEYİ kurallarına göre üret ve mevcut düğümlere (özellikle önceki parçanın düğümlerine) kenarlarla bağla. Aynı kurallara uy; "parts" alanı DÖNDÜRME.${
            currentPart.remaining.length > 0
              ? ` KALAN PARÇALAR (şimdi üretme, sonra sorulacak): ${JSON.stringify(currentPart.remaining)}`
              : ''
          }`,
        ]
      : []),
  ].join('\n');
}

const ALLOWED_OPS = new Set(['add_node', 'update_node', 'delete_node', 'move_node', 'add_edge', 'delete_edge']);

/** Modelin oluşturmak istediği bölge — sunucu aiAllowed: true ile, sahibin kanvas ayarı olarak yaratır. */
export interface NewRegionInput {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description?: string;
}

function parseNewRegions(value: unknown): NewRegionInput[] {
  if (!Array.isArray(value)) return [];
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const out: NewRegionInput[] = [];
  for (const r of value) {
    if (!r || typeof r !== 'object') continue;
    const { name, x, y, width, height, description } = r as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) continue;
    if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || width <= 0 || height <= 0) continue;
    out.push({
      name: name.trim().slice(0, 100), x, y, width, height,
      ...(typeof description === 'string' && description.trim() ? { description: description.trim().slice(0, 500) } : {}),
    });
    if (out.length >= MAX_NEW_REGIONS) break;
  }
  return out;
}

/** Model çıktısını çöz: JSON değilse metni özet yanıtı say; ops/parts/newRegions yalnızca "diagram" modunda geçerli. */
function parseModelOutput(raw: string): { mode: string; reply: string; message: string; ops: OpInput[]; parts: string[]; newRegions: NewRegionInput[] } {
  const text = raw.trim().replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  type ModelOut = { mode?: string; reply?: unknown; message?: unknown; ops?: unknown; parts?: unknown; newRegions?: unknown };
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
  let parts = Array.isArray(out.parts)
    ? out.parts.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean).slice(0, MAX_PARTS - 1)
    : [];
  let newRegions = parseNewRegions(out.newRegions);
  if (out.mode !== 'diagram') {
    ops = [];
    parts = [];
    newRegions = [];
  }
  return {
    mode: String(out.mode ?? 'summary'),
    reply: String(out.reply ?? ''),
    message: String(out.message || 'ajan değişikliği'),
    ops,
    parts,
    newRegions,
  };
}

/**
 * AI'ya kapalı ("aiAllowed": false) bölgelere dokunan intent'leri ayıklar — model kuralı
 * dinlemese bile sunucu tarafında güvence. Kapalı bölge yoksa hepsi geçer. Bir koordinatın
 * kapalı bir bölge dikdörtgeninin içinde olması "dokunma" sayılır; kenarlar uç düğümlerine bağlıdır.
 * `kept` = uygulanacak ops, `blockedRegionNames` = engellenen kapalı bölge adları (yanıt notu için).
 */
function filterAiClosedRegions(
  state: GraphState, regions: RegionInfo[], ops: OpInput[],
): { kept: OpInput[]; blockedRegionNames: string[] } {
  const closed = regions.filter((r) => !r.aiAllowed);
  if (closed.length === 0) return { kept: ops, blockedRegionNames: [] };

  // Düğüm konumları: mevcut düğümler + bu partide eklenen düğümler (kenar uçları için).
  const pos = new Map<string, { x: number | null; y: number | null }>();
  for (const n of state.nodes) pos.set(n.id, { x: n.x, y: n.y });
  for (const op of ops) if (op.op === 'add_node' && op.id) pos.set(op.id, { x: op.x ?? null, y: op.y ?? null });

  const blockingRegion = (x: number | null | undefined, y: number | null | undefined): RegionInfo | null => {
    if (x == null || y == null) return null;
    for (const r of closed) if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return r;
    return null;
  };
  const nodeRegion = (id: string): RegionInfo | null => {
    const p = pos.get(id);
    return p ? blockingRegion(p.x, p.y) : null;
  };
  const edgeRegion = (sourceId: string, targetId: string): RegionInfo | null =>
    nodeRegion(sourceId) ?? nodeRegion(targetId);

  const blocked = new Set<string>();
  const kept: OpInput[] = [];
  for (const op of ops) {
    let hit: RegionInfo | null = null;
    switch (op.op) {
      case 'add_node':
        hit = blockingRegion(op.x, op.y);
        break;
      case 'update_node':
      case 'delete_node':
      case 'move_node':
        hit = nodeRegion(op.id);
        if (!hit && op.op === 'move_node') hit = blockingRegion(op.x, op.y); // hedef de kapalı bölgede olamaz
        break;
      case 'add_edge':
        hit = edgeRegion(op.sourceId, op.targetId);
        break;
      case 'delete_edge': {
        const edge = state.edges.find((e) => e.id === op.id);
        hit = edge ? edgeRegion(edge.sourceId, edge.targetId) : null;
        break;
      }
    }
    if (hit) blocked.add(hit.name);
    else kept.push(op);
  }
  return { kept, blockedRegionNames: [...blocked] };
}

/**
 * Kanvas üstünde ajan turu: durumu topla → modele sor → gerekiyorsa commit at.
 * Actor isteği yapan kullanıcıdır: bölge ve rol kuralları normal commit'lerle birebir aynı işler.
 * Normalde her şey tek commit'tir; `stepwise` (parça parça) açıksa model işi parçalara böler ve
 * her parça seçili detay düzeyinde ayrı bir LLM çağrısı + ayrı bir commit olur (onOutcome ile
 * anında yayınlanır). Sahip ajanı ayrıca yeni bölge oluşturabilir (aiAllowed hep true) —
 * bölge kullanıcının kanvas ayarı olarak yaratılır, yönetimi normal bölgelerle aynıdır.
 */
export async function runAgent(opts: {
  prisma: PrismaClient;
  service: CommitService;
  canvasId: string;
  canvasName: string;
  prompt: string;
  actor: Actor;
  detail?: AgentDetail;
  /** Parça parça üretim: iş parçalara bölünür, her parça ayrı LLM çağrısı + ayrı commit. */
  stepwise?: boolean;
  /** Kullanıcının kanvasta işaretlediği düğümler; "şu adımları detaylandır" bunlara işaret eder. */
  selectedIds?: string[];
  /** Kullanıcının kanvasta işaretlediği bölgeler; açıklamaları + içlerindeki düğümler bağlam olur. */
  selectedRegionIds?: string[];
  llm?: Llm;
  /** Her başarılı commit/branch sonucunda çağrılır — route WS yayını için kullanır. */
  onOutcome?: (outcome: CommitOutcome) => void;
  /** Ajan bölge oluşturduğunda güncel bölge listesiyle çağrılır — route WS yayını için kullanır. */
  onRegions?: (regions: RegionInfo[]) => void;
}): Promise<AgentResult> {
  const {
    prisma, service, canvasId, canvasName, prompt, actor,
    detail = 'proto', stepwise = false, selectedIds = [], selectedRegionIds = [], onOutcome, onRegions,
  } = opts;
  const llm: Llm = opts.llm ?? ((s, u) => geminiGenerate(s, u, modelsFor(detail)));
  const canCreateRegions = actor.role === 'owner';
  const system = buildSystemPrompt(detail, stepwise, canCreateRegions);

  const [state, initialRegions] = await Promise.all([service.getState(), listRegions(prisma, canvasId)]);
  let regions = initialRegions;

  /**
   * Modelin istediği bölgeleri oluşturur (yalnızca sahip; aiAllowed zorla true) ve bölge
   * listesini tazeleyip yayınlatır. Dönen not reply'a eklenir; yetkisizse bölgeler düşer.
   */
  const applyNewRegions = async (wanted: NewRegionInput[]): Promise<string | null> => {
    if (wanted.length === 0) return null;
    if (!canCreateRegions)
      return 'Not: bölge oluşturma yalnızca kanvas sahibine açık olduğu için istenen bölge(ler) oluşturulmadı.';
    for (const r of wanted) await createRegion(prisma, canvasId, { ...r, aiAllowed: true });
    regions = await listRegions(prisma, canvasId);
    onRegions?.(regions);
    const names = wanted.map((r) => `"${r.name}"`).join(', ');
    return `Not: ${names} bölgesi/bölgeleri oluşturuldu (AI izni açık, yönetimi sizde).`;
  };
  const raw = await llm(
    system,
    buildUserText(canvasName, state, regions, actor, prompt, selectedIds, selectedRegionIds),
  );
  const parsed = parseModelOutput(raw);
  let { reply } = parsed;
  let message = parsed.message;
  let ops: OpInput[];

  if (parsed.mode === 'layout') {
    // Zihin haritası hiyerarşisini akışa dök: yerleşimi/kenarları sunucu deterministik hesaplar.
    // Yalnızca aktörün yazabildiği + AI'ya açık bölgeler dizilir; diğer bölgelerdeki düğümlere dokunulmaz.
    const layoutRegions = writableRegions(regions, actor).filter((r) => r.aiAllowed);
    const layoutIds = new Set(layoutRegions.map((r) => r.id));
    ops = buildFlowLayoutOps(state, regions, layoutIds);
    message = 'zihin haritası akışa döküldü';
    const inRect = (n: { x: number | null; y: number | null }, r: RegionInfo) =>
      n.x != null && n.y != null && n.x >= r.x && n.x <= r.x + r.width && n.y >= r.y && n.y <= r.y + r.height;
    const skipped = regions
      .filter((r) => !layoutIds.has(r.id) && state.nodes.some((n) => inRect(n, r)))
      .map((r) => `"${r.name}"`);
    if (skipped.length > 0)
      reply = `${reply}\n\nNot: ${skipped.join(', ')} bölgesi/bölgeleri (yazma izni yok ya da AI'ya kapalı) atlandı.`;
    if (ops.length === 0)
      return {
        reply: reply || 'Akışa dökülecek bir hiyerarşi bulunamadı (düğümler zaten yerleşik olabilir).',
        committed: false,
      };
  } else {
    // Önce modelin istediği yeni bölgeler: ops'taki düğümler bu dikdörtgenlerin içine yerleşecek.
    const regionNote = await applyNewRegions(parsed.newRegions);
    if (regionNote) reply = `${reply}\n\n${regionNote}`;
    // AI'ya kapalı bölgelere dokunan intent'leri sunucu tarafında ayıkla; gerisi normal işlenir.
    const { kept, blockedRegionNames } = filterAiClosedRegions(state, regions, parsed.ops);
    ops = kept;
    if (blockedRegionNames.length > 0) {
      const names = blockedRegionNames.map((n) => `"${n}"`).join(', ');
      reply = `${reply}\n\nNot: ${names} bölgesi/bölgeleri AI'ya kapalı olduğu için oradaki işlemler atlandı.`;
    }
    if (ops.length === 0) return { reply, committed: false };
  }

  if (actor.role === 'viewer') {
    return {
      reply: `Bu kanvasta "viewer" rolünde olduğunuz için değişiklik yapamıyorum. İstenen değişiklik: ${reply}`,
      committed: false,
    };
  }

  // Tek turun commit'i: outcome yayın callback'ine gider, bilinen hatalar sonuç olarak döner.
  type RoundCommit =
    | { kind: 'committed'; seq: number }
    | { kind: 'branched'; branch: string }
    | { kind: 'failed'; error: string };
  const commitRound = async (roundOps: OpInput[], roundMessage: string, baseSeq: number): Promise<RoundCommit> => {
    try {
      const outcome = await service.commit(roundOps, {
        message: `ajan: ${roundMessage}`,
        baseSeq,
        authorId: actor.userId,
        actor,
      });
      onOutcome?.(outcome);
      if (outcome.result === 'committed') return { kind: 'committed', seq: outcome.commit.seq };
      return { kind: 'branched', branch: outcome.branch.name };
    } catch (err) {
      if (err instanceof RegionError || err instanceof ValidationError || err instanceof ConflictError) {
        return { kind: 'failed', error: err.message };
      }
      throw err;
    }
  };

  // Parça listesi yalnızca parça parça (stepwise) + diagram modunda dikkate alınır; ilk parça bu turun ops'ları.
  const parts = stepwise && parsed.mode === 'diagram' ? parsed.parts : [];
  const total = 1 + parts.length;

  const first = await commitRound(ops, parts.length > 0 ? `${message} (parça 1/${total})` : message, state.headSeq);
  if (first.kind === 'failed') {
    return {
      reply: `Değişiklik uygulanamadı: ${first.error}\n\nPlanlanan değişiklik: ${reply}`,
      committed: false,
      error: first.error,
    };
  }
  if (first.kind === 'branched') {
    return {
      reply: `${reply}\n\nNot: bu sırada kanvas değişip çakışma oluştuğu için değişiklikler "${first.branch}" dalına yazıldı. Dallar panelinden birleştirebilir veya iptal edebilirsiniz.${
        parts.length > 0 ? ' Kalan parçalar üretilmedi.' : ''
      }`,
      committed: false,
      branched: true,
      branch: first.branch,
    };
  }

  let commitSeq = first.seq;
  let opCount = ops.length;
  const replies = [reply];

  // Kalan parçalar: her biri taze durum üzerinde ayrı bir LLM çağrısı + ayrı bir commit.
  for (let i = 0; i < parts.length; i++) {
    const partTitle = parts[i];
    const partNo = i + 2;
    const partState = await service.getState();
    let partRaw: string;
    try {
      partRaw = await llm(
        system,
        buildUserText(canvasName, partState, regions, actor, prompt, selectedIds, selectedRegionIds, {
          title: partTitle, index: partNo, total, remaining: parts.slice(i + 1),
        }),
      );
    } catch (err) {
      // Önceki parçalar commit'li kaldı; model hatası üretimi keser ama sonucu bozmaz.
      replies.push(`Not: "${partTitle}" parçası üretilemedi (${err instanceof Error ? err.message : String(err)}); kalan parçalar atlandı.`);
      return { reply: replies.join('\n\n'), committed: true, commitSeq, opCount };
    }
    const partParsed = parseModelOutput(partRaw);
    const partRegionNote = await applyNewRegions(partParsed.newRegions);
    if (partRegionNote) replies.push(partRegionNote);
    const partFilter = filterAiClosedRegions(partState, regions, partParsed.ops);
    if (partFilter.blockedRegionNames.length > 0) {
      const names = partFilter.blockedRegionNames.map((n) => `"${n}"`).join(', ');
      replies.push(`Not: ${names} bölgesi/bölgeleri AI'ya kapalı olduğu için oradaki işlemler atlandı.`);
    }
    if (partFilter.kept.length === 0) {
      replies.push(`Not: "${partTitle}" parçası için işlem üretilmedi, atlandı.`);
      continue;
    }
    const round = await commitRound(partFilter.kept, `${partTitle} (parça ${partNo}/${total})`, partState.headSeq);
    if (round.kind === 'failed') {
      replies.push(`Not: "${partTitle}" parçası uygulanamadı (${round.error}); kalan parçalar üretilmedi. Önceki parçalar kanvasta duruyor.`);
      return { reply: replies.join('\n\n'), committed: true, commitSeq, opCount, error: round.error };
    }
    if (round.kind === 'branched') {
      replies.push(`Not: "${partTitle}" parçası çakışma yüzünden "${round.branch}" dalına yazıldı; kalan parçalar üretilmedi. Dallar panelinden birleştirebilir veya iptal edebilirsiniz.`);
      return { reply: replies.join('\n\n'), committed: true, commitSeq, opCount, branched: true, branch: round.branch };
    }
    commitSeq = round.seq;
    opCount += partFilter.kept.length;
    replies.push(partParsed.reply || `"${partTitle}" parçası eklendi.`);
  }

  return { reply: replies.join('\n\n'), committed: true, commitSeq, opCount };
}
