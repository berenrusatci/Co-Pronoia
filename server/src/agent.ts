import type { PrismaClient } from '@prisma/client';
import type { CanvasType, GraphState, OpInput, RegionInfo } from '@treemapper/shared';
import { buildFlowLayoutOps } from '@treemapper/shared';
import {
  ConflictError, RegionError, ValidationError,
  type Actor, type CommitOutcome, type CommitService,
} from './commitService.js';
import { createCanvas, createRegion, updateRegion, listRegions, memberRole, type ServiceFor } from './canvasService.js';
import { memberPermissions } from './groupService.js';
import { getBrief } from './briefService.js';

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

/** Bir turda modelin düzenleyebileceği en fazla mevcut bölge (renk/açıklama/ad/konum/AI izni). */
const MAX_UPDATE_REGIONS = 20;

/** Bir turda modelin oluşturabileceği en fazla yeni alt kanvas. */
const MAX_NEW_SUBCANVASES = 3;

/** Bir turda modelin detaylandırma isteyebileceği en fazla mevcut alt kanvas. */
const MAX_FILL_SUBCANVASES = 3;

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

function buildSystemPrompt(
  detail: AgentDetail, stepwise: boolean, canCreateRegions: boolean, canCreateSubCanvases: boolean,
  canFillSubCanvases: boolean,
): string {
  return [
    'Sen TreeMapper adlı iş birlikli planlama uygulaması için çalışan bir ajansın. Sana bir kanvasın güncel durumu (düğümler, kenarlar, bölgeler), kullanıcının yetkileri ve doğal dildeki isteği verilir.',
    '',
    'YALNIZCA geçerli bir JSON nesnesi döndür (markdown, kod bloğu, ek metin YOK). Üç mod var:',
    '1) Bilgi/özet isteği ("özetle", "anlat", "listele", "durum ne"): {"mode":"summary","reply":"<Türkçe yanıt>"}',
    '2) Değişiklik/diyagram isteği ("çiz", "ekle", "oluştur", "diyagramını yap"): {"mode":"diagram","reply":"<yapılanın Türkçe özeti>","message":"<kısa commit mesajı>","ops":[...]}',
    '3) Zihin haritası hiyerarşisini akış diyagramına dökme isteği ("zihin haritasını akışa dök", "hiyerarşiyi akış diyagramına aktar", "her bölgeyi ayrı diyagram olarak diz", "bölgeleri ayrı ayrı akışa çıkar"): {"mode":"layout","reply":"<Türkçe kısa yanıt>"} — ops ÜRETME, koordinat/kenar HESAPLAMA. Sunucu yerleşimi kendisi deterministik yapar; sen yalnızca bu modu döndür.',
    '',
    'ops dizisindeki geçerli işlemler (intent şemaları — alanlara birebir uy):',
    '- {"op":"add_node","id":"<benzersiz kısa id>","title":"...","parentId":"<mevcut düğüm id, isteğe bağlı>","description":"...","nodeType":"task|idea|feature|milestone","status":"planned|in_progress|done","x":<sayı>,"y":<sayı>,"notes":"<uzun serbest metin/markdown, isteğe bağlı>","data":{"<alan adı>":"<değer>"}}',
    '- {"op":"add_edge","sourceId":"...","targetId":"...","kind":"flow|loop|dependency|relation","label":"...","direction":"directed|bidirectional"}',
    '- {"op":"update_node","id":"...","fields":{"title"?,"description"?,"nodeType"?,"status"?,"parentId"?,"notes"?,"data"?}}',
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
    '- NOTES/DATA: title kısa bir başlıktır, description 1-2 cümlelik özettir — daha uzun ayrıntı, gerekçe, kabul kriteri, kod/komut örneği gibi içerikleri düğümün "notes" alanına (markdown serbest metin) yaz. Yapılandırılmış ek bilgiyi (ör. {"tahmin":"3g","sahip":"ayşe","öncelik":"yüksek"}) "data" alanına anahtar-değer olarak koy. Dar alanlara uzun metin TIKIŞTIRMA; kullanıcı ayrıntı istedikçe notes/data kullan.',
    '- Özet/analiz isteklerinde ASLA ops üretme; mode "summary" olsun.',
    '- Kullanıcı açıkça silme istemedikçe delete_node / delete_edge kullanma.',
    '- Kullanıcı bir bölgeden bahsediyorsa düğümlerin "regions" alanına bakarak o bölgedeki düğümleri esas al.',
    `- SEÇİLİ DÜĞÜMLER verilmişse komutun hedefi onlardır: ${
      canFillSubCanvases
        ? '"bu kanvasta alt adımlara böl / buraya alt adım ekle" gibi AÇIKÇA kanvas içi kırılım istenirse her seçili düğüm için alt adımlar üret (parentId olarak o seçili düğümün id\'sini kullanabilirsin); yalın "detaylandır / ayrıntılandır" için DETAYLANDIRMA kuralına bak;'
        : '"detaylandır / alt adımlara böl" → her seçili düğüm için alt adımlar üret (kırılım istendiği için parentId olarak o seçili düğümün id\'sini kullanabilirsin);'
    } "değiştir / yeniden adlandır / durumunu güncelle" → update_node ile o düğümleri güncelle; "bundan sonrasını ... şekilde çiz" → akışı seçili düğümden devam ettir, ilk yeni düğümü ona bir kenarla bağla ve kullanıcı isterse seçili düğümden SONRAKİ mevcut akışı değiştir. Seçili düğümlerin konumuna yakın koordinatlar tercih et (bölge kuralı önceliklidir).`,
    ...(canFillSubCanvases
      ? [
          `- DETAYLANDIRMA (kesin): Seçili düğüm(ler) için yalın "detaylandır / ayrıntılandır / derinleştir" isteği ALT KANVAS işidir — ayrıntı BU kanvasa değil düğümün alt kanvasına çizilir; bu düğümler için BU kanvasa içerik ops ÜRETME ("ops" boş dizi olabilir). "linkedCanvasId" değeri dolu (zaten bağlı) her seçili düğüm için diagram yanıtına "fillSubCanvases" dizisinde bir kayıt ekle: [{"nodeId":"<düğüm id>","prompt":"<alt kanvasta neyin detaylandırılacağını anlatan 1-2 cümle>"}] (en fazla ${MAX_FILL_SUBCANVASES}). ${
            canCreateSubCanvases
              ? 'linkedCanvasId boş (bağsız) seçili düğümler için ise "newSubCanvases" kullan — sunucu alt kanvası oluşturur, bağlar ve planı içine çizer.'
              : 'linkedCanvasId boş (bağsız) düğümlerde alt kanvas oluşturma kapalı olduğu için detayı bu kanvasta alt adımlara bölerek üret (parentId = seçili düğüm).'
          } Kanvas içi kırılım yalnızca kullanıcı "bu kanvasta" gibi açık bir ifade kullanırsa yapılır.`,
        ]
      : []),
    ...(canCreateRegions
      ? [
          `- BÖLGE OLUŞTURMA: Kullanıcı yeni bir bölge/alan oluşturmayı isterse (ya da istek belirgin biçimde ayrı bir çalışma alanı gerektiriyorsa) diagram yanıtına "newRegions" dizisi ekle: [{"name":"...","x":<sayı>,"y":<sayı>,"width":<sayı>,"height":<sayı>,"description":"<bölgenin amacını anlatan 1-2 cümle>"}] (en fazla ${MAX_NEW_REGIONS}). Mevcut bölgelerle ve düğümlerle ÇAKIŞMAYAN boş bir alan seç; dikdörtgeni içine koyacağın düğümlere yetecek kadar büyük tut (düğüm başına ~240x130, ör. 6 düğüm için en az 800x500). Bölgeler sunucuda AI izni açık olarak oluşturulur ve kanvas sahibi tarafından yönetilir. Ardından ops'taki yeni düğümleri BÖLGE KURALI'na uyarak bu dikdörtgenin içine yerleştir ve içeriği bölgenin adına/açıklamasına uygun doldur.`,
          `- BÖLGE DÜZENLEME: Kullanıcı mevcut bir bölgeyi renklendirmeyi/ayırt etmeyi ya da düzenlemeyi isterse ("bölgeleri renklendir", "her alanı farklı renk yap", "şu bölgenin adını/açıklamasını değiştir" gibi) diagram yanıtına "updateRegions" dizisi ekle: [{"id":"<mevcut bölgenin id'si>","color":"#RRGGBB","name":"...","description":"...","aiAllowed":<bool>,"x":<sayı>,"y":<sayı>,"width":<sayı>,"height":<sayı>}] (yalnız id zorunlu; yalnızca değiştireceğin alanları koy, en fazla ${MAX_UPDATE_REGIONS}). id'yi durumdaki "regions" listesinden al. RENK yalnızca #RGB ya da #RRGGBB hex olmalı; bölgeleri ayırt etmek için okunur, birbirinden belirgin FARKLI renkler seç. Bölge düzenleme tek başına geçerlidir (ops boş olabilir).`,
        ]
      : ['- BÖLGE OLUŞTURMA/DÜZENLEME yalnızca kanvas sahibinin ajanına açıktır; bu kullanıcı sahip değil — "newRegions" ve "updateRegions" alanlarını KULLANMA. Bölge isteğini mode "summary" ile kibarca reddet (diğer işleri normal yap).']),
    ...(canCreateSubCanvases
      ? [
          `- ALT KANVAS OLUŞTURMA: Kullanıcı bir düğümün/adımın kendi kanvasında ayrıntılı planlanmasını isterse ("bu adımı kendi kanvasında planla", "X için alt kanvas aç" gibi — seçili bağsız düğümler için yalın "detaylandır" da buna dahildir, DETAYLANDIRMA kuralına bak) diagram yanıtına "newSubCanvases" dizisi ekle: [{"nodeId":"<mevcut ya da bu yanıtta eklediğin bir düğümün id'si>","name":"<alt kanvasın adı>","description":"<alt kanvasın amacını anlatan 1-2 cümle>"}] (en fazla ${MAX_NEW_SUBCANVASES}). Sunucu alt kanvası aynı grupta oluşturur, düğüme bağlar ve içine bu amaca uygun bir plan çizilir. "linkedCanvasId" değeri null olmayan (zaten alt kanvası olan) düğümlere yenisini bağlama. ops içinde linkedCanvasId alanını ASLA kendin yazma — bağlama işini yalnızca "newSubCanvases" yapar.`,
        ]
      : ['- ALT KANVAS OLUŞTURMA bu kanvasta/bu kullanıcı için kapalı — "newSubCanvases" alanı KULLANMA ve ops içinde linkedCanvasId alanını ASLA yazma. Alt kanvas isteğini mode "summary" ile kibarca reddet (diğer işleri normal yap).']),
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
  currentPart?: CurrentPart, brief?: string,
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
    linkedCanvasId: n.linkedCanvasId,
    notes: n.notes.slice(0, 500),
    data: n.data,
    regions: regions.filter((r) => inRegion(n, r)).map((r) => r.name),
  }));
  const edges = state.edges.map((e) => ({
    id: e.id, sourceId: e.sourceId, targetId: e.targetId,
    kind: e.kind, direction: e.direction, label: e.label,
  }));
  const regionInfo = regions.map((r) => ({
    id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height,
    color: r.color, aiAllowed: r.aiAllowed, description: r.description.slice(0, 500),
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
    ...(brief
      ? [`KANVAS NOTU (kanvasın ortak çalışma brifingi; ürettiğin işleri buna uygun kur): ${brief.slice(0, 4000)}`, '']
      : []),
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

/**
 * Modelin düzenlemek istediği mevcut bölge. id zorunlu; verilen alanlar üzerine yazılır.
 * Bölgeler owner config'idir (olay-kaynaklı graf değil) — düzenleme yalnızca sahibin ajanına açıktır.
 */
export interface UpdateRegionInput {
  id: string;
  name?: string;
  color?: string;
  description?: string;
  aiAllowed?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** #RGB / #RRGGBB hex rengi doğrula (geçersizse renk alanı düşer, diğer alanlar korunur). */
const isHexColor = (v: unknown): v is string =>
  typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());

function parseUpdateRegions(value: unknown): UpdateRegionInput[] {
  if (!Array.isArray(value)) return [];
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const out: UpdateRegionInput[] = [];
  for (const r of value) {
    if (!r || typeof r !== 'object') continue;
    const { id, name, color, description, aiAllowed, x, y, width, height } = r as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim()) continue;
    const upd: UpdateRegionInput = { id: id.trim() };
    if (typeof name === 'string' && name.trim()) upd.name = name.trim().slice(0, 100);
    if (isHexColor(color)) upd.color = color.trim();
    if (typeof description === 'string') upd.description = description.trim().slice(0, 500);
    if (typeof aiAllowed === 'boolean') upd.aiAllowed = aiAllowed;
    if (finite(x)) upd.x = x;
    if (finite(y)) upd.y = y;
    if (finite(width) && width > 0) upd.width = width;
    if (finite(height) && height > 0) upd.height = height;
    // id dışında düzenlenecek en az bir alan yoksa atla.
    if (Object.keys(upd).length === 1) continue;
    out.push(upd);
    if (out.length >= MAX_UPDATE_REGIONS) break;
  }
  return out;
}

/** Modelin oluşturmak istediği alt kanvas: nodeId'deki düğüme bağlanacak yeni bir grup kanvası. */
export interface NewSubCanvasInput {
  nodeId: string;
  name: string;
  description?: string;
}

function parseNewSubCanvases(value: unknown): NewSubCanvasInput[] {
  if (!Array.isArray(value)) return [];
  const out: NewSubCanvasInput[] = [];
  for (const c of value) {
    if (!c || typeof c !== 'object') continue;
    const { nodeId, name, description } = c as Record<string, unknown>;
    if (typeof nodeId !== 'string' || !nodeId.trim()) continue;
    if (typeof name !== 'string' || !name.trim()) continue;
    out.push({
      nodeId: nodeId.trim(),
      name: name.trim().slice(0, 80), // kanvas adı üst sınırıyla aynı
      ...(typeof description === 'string' && description.trim() ? { description: description.trim().slice(0, 500) } : {}),
    });
    if (out.length >= MAX_NEW_SUBCANVASES) break;
  }
  return out;
}

/** Modelin detaylandırılmasını istediği, zaten bağlı bir alt kanvas: detay oraya çizilir. */
export interface FillSubCanvasInput {
  nodeId: string;
  prompt?: string;
}

function parseFillSubCanvases(value: unknown): FillSubCanvasInput[] {
  if (!Array.isArray(value)) return [];
  const out: FillSubCanvasInput[] = [];
  for (const f of value) {
    if (!f || typeof f !== 'object') continue;
    const { nodeId, prompt } = f as Record<string, unknown>;
    if (typeof nodeId !== 'string' || !nodeId.trim()) continue;
    out.push({
      nodeId: nodeId.trim(),
      ...(typeof prompt === 'string' && prompt.trim() ? { prompt: prompt.trim().slice(0, 500) } : {}),
    });
    if (out.length >= MAX_FILL_SUBCANVASES) break;
  }
  return out;
}

/**
 * Modelin ops'larından linkedCanvasId'yi soyar: bağlama yalnızca sunucunun newSubCanvases
 * yolundan yapılır — model keyfî kanvas id'lerine bağ kuramaz.
 */
function stripLinkedCanvasId(ops: OpInput[]): OpInput[] {
  const out: OpInput[] = [];
  for (const op of ops) {
    if (op.op === 'add_node' && 'linkedCanvasId' in op) {
      const { linkedCanvasId: _drop, ...rest } = op;
      out.push(rest);
    } else if (op.op === 'update_node' && op.fields && 'linkedCanvasId' in op.fields) {
      const { linkedCanvasId: _drop, ...fields } = op.fields;
      if (Object.keys(fields).length === 0) continue; // geriye alan kalmadıysa op tümüyle düşer
      out.push({ ...op, fields });
    } else {
      out.push(op);
    }
  }
  return out;
}

/** Model çıktısını çöz: JSON değilse metni özet yanıtı say; ops/parts/newRegions/newSubCanvases/fillSubCanvases yalnızca "diagram" modunda geçerli. */
function parseModelOutput(raw: string): { mode: string; reply: string; message: string; ops: OpInput[]; parts: string[]; newRegions: NewRegionInput[]; updateRegions: UpdateRegionInput[]; newSubCanvases: NewSubCanvasInput[]; fillSubCanvases: FillSubCanvasInput[] } {
  const text = raw.trim().replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  type ModelOut = { mode?: string; reply?: unknown; message?: unknown; ops?: unknown; parts?: unknown; newRegions?: unknown; updateRegions?: unknown; newSubCanvases?: unknown; fillSubCanvases?: unknown };
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
    ? stripLinkedCanvasId(
        out.ops.filter((o) => o && typeof o === 'object' && ALLOWED_OPS.has((o as { op?: string }).op ?? '')) as OpInput[],
      )
    : [];
  let parts = Array.isArray(out.parts)
    ? out.parts.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean).slice(0, MAX_PARTS - 1)
    : [];
  let newRegions = parseNewRegions(out.newRegions);
  let updateRegions = parseUpdateRegions(out.updateRegions);
  let newSubCanvases = parseNewSubCanvases(out.newSubCanvases);
  let fillSubCanvases = parseFillSubCanvases(out.fillSubCanvases);
  if (out.mode !== 'diagram') {
    ops = [];
    parts = [];
    newRegions = [];
    updateRegions = [];
    newSubCanvases = [];
    fillSubCanvases = [];
  }
  return {
    mode: String(out.mode ?? 'summary'),
    reply: String(out.reply ?? ''),
    message: String(out.message || 'ajan değişikliği'),
    ops,
    parts,
    newRegions,
    updateRegions,
    newSubCanvases,
    fillSubCanvases,
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
  /** Alt kanvas oluşturma/doldurma için gerekli (app.ts'deki paylaşılan map); verilmezse özellik kapalı. */
  serviceFor?: ServiceFor;
  llm?: Llm;
  /** Her başarılı commit/branch sonucunda çağrılır — route WS yayını için kullanır. */
  onOutcome?: (outcome: CommitOutcome) => void;
  /** Bir alt kanvasa commit indiğinde çağrılır — route o kanvasın izleyicilerine WS yayını yapar. */
  onSubCommit?: (subCanvasId: string, outcome: CommitOutcome) => void;
  /** Ajan bölge oluşturduğunda güncel bölge listesiyle çağrılır — route WS yayını için kullanır. */
  onRegions?: (regions: RegionInfo[]) => void;
}): Promise<AgentResult> {
  const {
    prisma, service, canvasId, canvasName, prompt, actor,
    detail = 'proto', stepwise = false, selectedIds = [], selectedRegionIds = [], onOutcome, onRegions,
  } = opts;
  const llm: Llm = opts.llm ?? ((s, u) => geminiGenerate(s, u, modelsFor(detail)));
  const canCreateRegions = actor.role === 'owner';

  // Alt kanvas oluşturma: kanvas bir gruba bağlı olmalı ve aktörün o grupta kanvas oluşturma
  // yetkisi olmalı (admin ya da rolünün canCreateCanvas'ı). Viewer'a kapalı — bağ commit'i zaten reddedilirdi.
  const canvasRow = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { groupId: true, type: true } });
  const groupId = canvasRow?.groupId ?? null;
  // Alt kanvas parent'ın türünü miras alır — co-pronoia kanvasta oluşturulan alt kanvas da
  // co-pronoia olmalı, yoksa MCP ajan token'ları ona bağlanamaz.
  const canvasType = (canvasRow?.type ?? 'plan') as CanvasType;
  const perms = groupId ? await memberPermissions(prisma, groupId, actor.userId) : null;
  const canCreateSubCanvases = Boolean(
    opts.serviceFor && groupId && actor.role !== 'viewer' && perms?.canCreateCanvas,
  );
  // Mevcut bir alt kanvası detaylandırmak yeni bir şey OLUŞTURMAZ; grup/kanvas-oluşturma yetkisi
  // gerekmez. Hedef kanvastaki gerçek yetki, yürütme anında memberRole ile ayrıca çözülür.
  const canFillSubCanvases = Boolean(opts.serviceFor) && actor.role !== 'viewer';
  const system = buildSystemPrompt(detail, stepwise, canCreateRegions, canCreateSubCanvases, canFillSubCanvases);

  const [state, initialRegions, canvasBrief] = await Promise.all([
    service.getState(), listRegions(prisma, canvasId), getBrief(prisma, canvasId),
  ]);
  let regions = initialRegions;
  const briefText = canvasBrief.content || undefined;

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

  /**
   * Modelin istediği mevcut bölge düzenlemelerini (renk/ad/açıklama/AI izni/konum-boyut) uygular.
   * Yalnızca sahip; olay-kaynaklı graf değil, doğrudan config yazımı. Bilinmeyen id sessizce atlanır.
   * Dönen not reply'a eklenir; yetkisizse tüm düzenlemeler düşer.
   */
  const applyUpdateRegions = async (wanted: UpdateRegionInput[]): Promise<string | null> => {
    if (wanted.length === 0) return null;
    if (!canCreateRegions)
      return 'Not: bölge düzenleme yalnızca kanvas sahibine açık olduğu için istenen değişiklik(ler) uygulanmadı.';
    const done: string[] = [];
    for (const { id, ...data } of wanted) {
      if (!regions.some((r) => r.id === id)) continue; // yalnız bu kanvasın mevcut bölgeleri
      const updated = await updateRegion(prisma, canvasId, id, data);
      if (updated) done.push(`"${updated.name}"`);
    }
    if (done.length === 0) return null;
    regions = await listRegions(prisma, canvasId);
    onRegions?.(regions);
    return `Not: ${done.join(', ')} bölgesi/bölgeleri güncellendi.`;
  };

  /** applyNewSubCanvases'in oluşturduğu, bağ commit'i sonrası doldurulacak alt kanvaslar. */
  interface CreatedSubCanvas {
    canvasId: string;
    name: string;
    description?: string;
    nodeTitle: string;
  }

  /**
   * Modelin istediği alt kanvasları oluşturur (aynı grupta, sahibi istek atan kullanıcı) ve
   * her biri için turun ops'larına eklenecek bir update_node bağ intent'i döndürür — bağ,
   * normal service.commit yolundan geçer (bölge + aynı-grup doğrulaması dahil). Bilinmeyen,
   * zaten bağlı ya da AI'ya kapalı bölgedeki düğümler notla düşer (orphan kanvas yaratılmaz).
   */
  const applyNewSubCanvases = async (
    wanted: NewSubCanvasInput[], roundState: GraphState, roundOps: OpInput[],
  ): Promise<{ linkOps: OpInput[]; notes: string[]; created: CreatedSubCanvas[] }> => {
    if (wanted.length === 0) return { linkOps: [], notes: [], created: [] };
    if (!canCreateSubCanvases)
      return {
        linkOps: [],
        notes: ['Not: alt kanvas oluşturma bu kanvasta size kapalı olduğu için (kanvas bir gruba bağlı değil ya da grupta kanvas oluşturma yetkiniz yok) istenen alt kanvas(lar) oluşturulmadı.'],
        created: [],
      };
    // Bağlanabilir düğümler: mevcut durum + bu turda eklenenler (bağ aynı commit'te kurulur).
    const known = new Map<string, { title: string; linked: boolean; x: number | null; y: number | null }>();
    for (const n of roundState.nodes) known.set(n.id, { title: n.title, linked: n.linkedCanvasId != null, x: n.x, y: n.y });
    for (const op of roundOps)
      if (op.op === 'add_node' && op.id) known.set(op.id, { title: op.title, linked: false, x: op.x ?? null, y: op.y ?? null });
    const closed = regions.filter((r) => !r.aiAllowed);
    const inClosed = (x: number | null, y: number | null) =>
      x != null && y != null && closed.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);

    const linkOps: OpInput[] = [];
    const notes: string[] = [];
    const created: CreatedSubCanvas[] = [];
    const seen = new Set<string>();
    for (const w of wanted) {
      if (seen.has(w.nodeId)) continue;
      seen.add(w.nodeId);
      const node = known.get(w.nodeId);
      if (!node) {
        notes.push(`Not: "${w.name}" alt kanvası oluşturulmadı — "${w.nodeId}" id'li düğüm bulunamadı.`);
        continue;
      }
      if (node.linked) {
        notes.push(`Not: "${node.title}" düğümünün zaten bağlı bir alt kanvası olduğu için "${w.name}" oluşturulmadı.`);
        continue;
      }
      if (inClosed(node.x, node.y)) {
        notes.push(`Not: "${node.title}" düğümü AI'ya kapalı bir bölgede olduğu için "${w.name}" alt kanvası oluşturulmadı.`);
        continue;
      }
      const canvas = await createCanvas(prisma, opts.serviceFor!, w.name, actor.userId, { groupId: groupId!, type: canvasType });
      linkOps.push({ op: 'update_node', id: w.nodeId, fields: { linkedCanvasId: canvas.id } });
      created.push({ canvasId: canvas.id, name: w.name, description: w.description, nodeTitle: node.title });
    }
    return { linkOps, notes, created };
  };

  /**
   * Ortak çekirdek: bir alt kanvasa tek LLM çağrısıyla plan çizip commit'ler. Hem yeni oluşturulan
   * hem mevcut alt kanvaslar için kullanılır; bölge kuralları hedef kanvasın kendi bölgeleri ve
   * verilen aktörle işler. `false` döner = model işlem üretmedi (commit yok).
   */
  const drawIntoSubCanvas = async (
    subCanvasId: string, subName: string, fillPrompt: string, subActor: Actor, message: string,
  ): Promise<boolean> => {
    const subService = opts.serviceFor!(subCanvasId);
    const [subState, subRegions, subBrief] = await Promise.all([
      subService.getState(), listRegions(prisma, subCanvasId), getBrief(prisma, subCanvasId),
    ]);
    // Recursion yok: parça/bölge/alt-kanvas kapalı bir sistem prompt'u; parts vb. zaten işlenmez.
    const fillSystem = buildSystemPrompt(detail, false, false, false, false);
    const fillRaw = await llm(
      fillSystem,
      buildUserText(subName, subState, subRegions, subActor, fillPrompt, [], [], undefined, subBrief.content || undefined),
    );
    const fillParsed = parseModelOutput(fillRaw);
    // AI'ya kapalı bölgeler hedef kanvasta da geçerlidir.
    const { kept } = filterAiClosedRegions(subState, subRegions, fillParsed.ops);
    if (kept.length === 0) return false;
    const outcome = await subService.commit(kept, {
      message,
      baseSeq: subState.headSeq,
      authorId: actor.userId,
      actor: subActor,
    });
    opts.onSubCommit?.(subCanvasId, outcome);
    return true;
  };

  /**
   * Yeni alt kanvasın içine tek LLM çağrısıyla bir plan çizer ve alt kanvasa commit'ler.
   * Her hata tolere edilir: üst kanvasın commit'i çoktan durduğu için sonuç yalnızca nota döner.
   */
  const fillSubCanvas = async (c: CreatedSubCanvas): Promise<string> => {
    try {
      const fillPrompt = `Bu kanvas, "${canvasName}" kanvasındaki "${c.nodeTitle}" düğümünün alt kanvasıdır. Amacı: ${c.description ?? c.name}. Bu iş için adım adım bir plan çiz; mevcut kök düğümü başlangıç kabul et ve ilk yeni düğümü ona bir kenarla bağla.`;
      const drew = await drawIntoSubCanvas(
        c.canvasId, c.name, fillPrompt,
        { userId: actor.userId, role: 'owner' }, // yeni alt kanvasın sahibi istek atan kullanıcıdır
        'ajan: alt kanvas planı',
      );
      if (!drew)
        return `Not: "${c.name}" alt kanvası oluşturuldu ve "${c.nodeTitle}" düğümüne bağlandı ama planı doldurulamadı (model işlem üretmedi).`;
      return `Not: "${c.name}" alt kanvası oluşturuldu, "${c.nodeTitle}" düğümüne bağlandı ve içine bir plan çizildi.`;
    } catch (err) {
      return `Not: "${c.name}" alt kanvası oluşturuldu ama planı doldurulamadı (${err instanceof Error ? err.message : String(err)}).`;
    }
  };

  /**
   * "Detaylandır": zaten bağlı bir alt kanvasın içine plan çizer. Hedefteki gerçek rol
   * memberRole ile çözülür ve commit o rolle atılır — hedef kanvasın bölge/rol kuralları
   * aynen işler, asla 'owner'a yükseltilmez. Her sorun Türkçe nota döner, turu düşürmez.
   */
  const elaborateSubCanvas = async (f: FillSubCanvasInput, roundState: GraphState): Promise<string> => {
    const node = roundState.nodes.find((n) => n.id === f.nodeId);
    if (!node) return `Not: "${f.nodeId}" id'li düğüm bulunamadığı için detaylandırılamadı.`;
    if (!node.linkedCanvasId)
      return `Not: "${node.title}" düğümünün bağlı bir alt kanvası olmadığı için oraya detaylandırma yapılamadı.`;
    const closed = regions.filter((r) => !r.aiAllowed);
    if (node.x != null && node.y != null &&
        closed.some((r) => node.x! >= r.x && node.x! <= r.x + r.width && node.y! >= r.y && node.y! <= r.y + r.height))
      return `Not: "${node.title}" düğümü AI'ya kapalı bir bölgede olduğu için detaylandırılmadı.`;
    const subRole = await memberRole(prisma, node.linkedCanvasId, actor.userId);
    if (!subRole)
      return `Not: "${node.title}" düğümünün alt kanvasına erişiminiz olmadığı için (ya da kanvas silinmiş) detaylandırılamadı.`;
    if (subRole === 'viewer')
      return `Not: "${node.title}" düğümünün alt kanvasında rolünüz "viewer" (salt okunur) olduğu için detaylandırılamadı.`;
    const subCanvas = await prisma.canvas.findUnique({ where: { id: node.linkedCanvasId }, select: { name: true } });
    if (!subCanvas) return `Not: "${node.title}" düğümünün bağlı kanvası bulunamadı (silinmiş olabilir).`;
    try {
      const fillPrompt = `Bu kanvas, "${canvasName}" kanvasındaki "${node.title}" düğümünün alt kanvasıdır. Kullanıcı bu düğümün detaylandırılmasını istedi${f.prompt ? `: ${f.prompt}` : '.'} Mevcut planı koru ve derinleştir: eksik adımları ekle, gerekiyorsa mevcut düğümleri update_node ile zenginleştir (description/notes), yeni düğümleri mevcut akışa kenarlarla bağla.`;
      const drew = await drawIntoSubCanvas(
        node.linkedCanvasId, subCanvas.name, fillPrompt,
        { userId: actor.userId, role: subRole },
        `ajan: "${node.title}" detaylandırması`,
      );
      if (!drew) return `Not: "${node.title}" düğümünün alt kanvası için model işlem üretmedi.`;
      return `Not: "${node.title}" düğümünün detayı "${subCanvas.name}" alt kanvasına çizildi.`;
    } catch (err) {
      return `Not: "${node.title}" düğümünün alt kanvası detaylandırılamadı (${err instanceof Error ? err.message : String(err)}).`;
    }
  };
  const raw = await llm(
    system,
    buildUserText(canvasName, state, regions, actor, prompt, selectedIds, selectedRegionIds, undefined, briefText),
  );
  const parsed = parseModelOutput(raw);
  let { reply } = parsed;
  let message = parsed.message;
  let ops: OpInput[];
  let createdSubs: CreatedSubCanvas[] = [];
  let pendingFills: FillSubCanvasInput[] = [];

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
    // Mevcut bölge düzenlemeleri (renk/ad/açıklama/AI izni/konum): config yazımı, commit üretmez.
    const updateNote = await applyUpdateRegions(parsed.updateRegions);
    if (updateNote) reply = `${reply}\n\n${updateNote}`;
    // AI'ya kapalı bölgelere dokunan intent'leri sunucu tarafında ayıkla; gerisi normal işlenir.
    const { kept, blockedRegionNames } = filterAiClosedRegions(state, regions, parsed.ops);
    if (blockedRegionNames.length > 0) {
      const names = blockedRegionNames.map((n) => `"${n}"`).join(', ');
      reply = `${reply}\n\nNot: ${names} bölgesi/bölgeleri AI'ya kapalı olduğu için oradaki işlemler atlandı.`;
    }
    // Alt kanvaslar: kapalı-bölge filtresinden SONRA — bağ intent'leri gerçekten uygulanacak
    // ops'lara eklenir, filtrelenecek bir düğüm için orphan kanvas yaratılmaz.
    const sub = await applyNewSubCanvases(parsed.newSubCanvases, state, kept);
    ops = [...kept, ...sub.linkOps];
    createdSubs = sub.created;
    for (const note of sub.notes) reply = `${reply}\n\n${note}`;
    // Mevcut alt kanvas detaylandırmaları: üst kanvasa commit gerektirmez, tur sonrası işlenir.
    if (parsed.fillSubCanvases.length > 0) {
      if (canFillSubCanvases) pendingFills = parsed.fillSubCanvases;
      else reply = `${reply}\n\nNot: alt kanvas detaylandırma bu istekte kullanılamadı (yetki yok).`;
    }
    // "Detaylandır" turu üst kanvasa hiçbir şey yazmadan meşru olabilir (yalnızca fill).
    if (ops.length === 0 && pendingFills.length === 0) return { reply, committed: false };
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

  // Tur commit'lenemezse oluşturulan alt kanvaslar bağsız kalır; kullanıcı panodan ulaşabilsin.
  const unlinkedNote = (subs: CreatedSubCanvas[]): string =>
    subs.length > 0
      ? `\n\nNot: ${subs.map((c) => `"${c.name}"`).join(', ')} alt kanvası/kanvasları oluşturuldu ama düğüme bağlanamadı; panodan ulaşabilirsiniz.`
      : '';

  // "Yalnızca detaylandırma" turunda üst kanvasa commit yoktur; ops varsa normal tur işler.
  let commitSeq: number | undefined;
  let opCount = 0;
  const replies = [reply];
  if (ops.length > 0) {
    const first = await commitRound(ops, parts.length > 0 ? `${message} (parça 1/${total})` : message, state.headSeq);
    if (first.kind === 'failed') {
      return {
        reply: `Değişiklik uygulanamadı: ${first.error}\n\nPlanlanan değişiklik: ${reply}${unlinkedNote(createdSubs)}`,
        committed: false,
        error: first.error,
      };
    }
    if (first.kind === 'branched') {
      return {
        reply: `${reply}\n\nNot: bu sırada kanvas değişip çakışma oluştuğu için değişiklikler "${first.branch}" dalına yazıldı. Dallar panelinden birleştirebilir veya iptal edebilirsiniz.${
          parts.length > 0 ? ' Kalan parçalar üretilmedi.' : ''
        }${unlinkedNote(createdSubs)}`,
        committed: false,
        branched: true,
        branch: first.branch,
      };
    }
    commitSeq = first.seq;
    opCount = ops.length;
  }

  // Bağ commit'i durduğuna göre yeni alt kanvasların içi doldurulabilir (hatalar nota döner).
  for (const c of createdSubs) replies.push(await fillSubCanvas(c));
  // Mevcut alt kanvas detaylandırmaları: her biri kendi kanvasına ayrı bir commit (hatalar nota döner).
  for (const f of pendingFills) replies.push(await elaborateSubCanvas(f, state));

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
        }, briefText),
      );
    } catch (err) {
      // Önceki parçalar commit'li kaldı; model hatası üretimi keser ama sonucu bozmaz.
      replies.push(`Not: "${partTitle}" parçası üretilemedi (${err instanceof Error ? err.message : String(err)}); kalan parçalar atlandı.`);
      return { reply: replies.join('\n\n'), committed: commitSeq !== undefined, commitSeq, opCount };
    }
    const partParsed = parseModelOutput(partRaw);
    const partRegionNote = await applyNewRegions(partParsed.newRegions);
    if (partRegionNote) replies.push(partRegionNote);
    const partFilter = filterAiClosedRegions(partState, regions, partParsed.ops);
    if (partFilter.blockedRegionNames.length > 0) {
      const names = partFilter.blockedRegionNames.map((n) => `"${n}"`).join(', ');
      replies.push(`Not: ${names} bölgesi/bölgeleri AI'ya kapalı olduğu için oradaki işlemler atlandı.`);
    }
    const partSub = await applyNewSubCanvases(partParsed.newSubCanvases, partState, partFilter.kept);
    for (const note of partSub.notes) replies.push(note);
    const partOps = [...partFilter.kept, ...partSub.linkOps];
    const partFills = canFillSubCanvases ? partParsed.fillSubCanvases : [];
    if (partOps.length === 0 && partFills.length === 0) {
      replies.push(`Not: "${partTitle}" parçası için işlem üretilmedi, atlandı.`);
      continue;
    }
    if (partOps.length > 0) {
      const round = await commitRound(partOps, `${partTitle} (parça ${partNo}/${total})`, partState.headSeq);
      if (round.kind === 'failed') {
        replies.push(`Not: "${partTitle}" parçası uygulanamadı (${round.error}); kalan parçalar üretilmedi. Önceki parçalar kanvasta duruyor.${unlinkedNote(partSub.created)}`);
        return { reply: replies.join('\n\n'), committed: commitSeq !== undefined, commitSeq, opCount, error: round.error };
      }
      if (round.kind === 'branched') {
        replies.push(`Not: "${partTitle}" parçası çakışma yüzünden "${round.branch}" dalına yazıldı; kalan parçalar üretilmedi. Dallar panelinden birleştirebilir veya iptal edebilirsiniz.${unlinkedNote(partSub.created)}`);
        return { reply: replies.join('\n\n'), committed: commitSeq !== undefined, commitSeq, opCount, branched: true, branch: round.branch };
      }
      commitSeq = round.seq;
      opCount += partOps.length;
      replies.push(partParsed.reply || `"${partTitle}" parçası eklendi.`);
    }
    for (const c of partSub.created) replies.push(await fillSubCanvas(c));
    for (const f of partFills) replies.push(await elaborateSubCanvas(f, partState));
  }

  return { reply: replies.join('\n\n'), committed: commitSeq !== undefined, commitSeq, opCount };
}
