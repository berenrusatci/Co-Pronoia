import type { GraphState, NodeStatus, PlanNode } from './types.js';

/**
 * Zihin haritası (parentId hiyerarşisi) → PDF çizim modeli üreten saf, bağımlılıksız katman.
 * `shared/` runtime bağımlılığı taşımaz: burada yalnızca deterministik yerleşim + ilkel çizim
 * komutları üretilir; gerçek PDF baytlarını server'daki render motoru (pdf-lib) yazar. Bu ayrım
 * plandaki "JSON Şema/Veri Hazırlama" (pdf-core-schema) ile "Çizim Motoru" (pdf-render-engine)
 * düğümlerini karşılar; şablonlar (pdf-templates) sayfa boyutunu belirler.
 *
 * Koordinatlar PDF punto (1/72 inç) cinsindendir ve SOL-ÜST köşe orijinlidir; render motoru
 * pdf-lib'in sol-alt orijinine çevirir.
 */

/** Çıktı şablonu: sayfa boyutu + insanca ad. */
export type PdfTemplateId = 'a4-portrait' | 'a3-landscape' | 'presentation';

export interface PdfTemplate {
  id: PdfTemplateId;
  label: string;
  /** Sayfa genişliği/yüksekliği (punto). */
  widthPt: number;
  heightPt: number;
}

export const PDF_TEMPLATES: Record<PdfTemplateId, PdfTemplate> = {
  'a4-portrait': { id: 'a4-portrait', label: 'A4 Dikey', widthPt: 595, heightPt: 842 },
  'a3-landscape': { id: 'a3-landscape', label: 'A3 Yatay', widthPt: 1191, heightPt: 842 },
  presentation: { id: 'presentation', label: 'Sunum (16:9)', widthPt: 1280, heightPt: 720 },
};

export function resolveTemplate(id: string | undefined): PdfTemplate {
  return (id && PDF_TEMPLATES[id as PdfTemplateId]) || PDF_TEMPLATES['a4-portrait'];
}

// ---------- Çizim ilkelleri ----------

export interface PdfRect {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}
export interface PdfLine {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
}
export interface PdfText {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  bold?: boolean;
}
export type PdfPrim = PdfRect | PdfLine | PdfText;

export interface PdfPage {
  widthPt: number;
  heightPt: number;
  prims: PdfPrim[];
}

export interface PdfDocModel {
  title: string;
  template: PdfTemplateId;
  generatedAt: string;
  pages: PdfPage[];
  /** Bilgilendirme: kaç düğüm çizildi (başlıkta gösterilir, testte doğrulanır). */
  nodeCount: number;
  doneCount: number;
}

export interface BuildPdfOptions {
  title?: string;
  template?: string;
  generatedAt?: string;
}

// ---------- Yerleşim sabitleri ----------

const NODE_W = 150;
const LINE_H = 12;
const NODE_PAD_Y = 8;
const COL_GAP = 60; // sütunlar (derinlik) arası yatay boşluk
const ROW_GAP = 10; // kardeş düğümler arası dikey boşluk
const FONT = 9; // düğüm başlığı punto
const HEADER_H = 46; // sayfa başlığı alanı
const MARGIN = 32;

/** Helvetica için kaba ortalama karakter genişliği (em oranı); metin sarma yeterince iyi olur. */
const CHAR_W = 0.52;

const STATUS_FILL: Record<NodeStatus, string> = {
  planned: '#e8e6df',
  in_progress: '#fde8c8',
  done: '#d6efd6',
};
const STATUS_STROKE: Record<NodeStatus, string> = {
  planned: '#b8b4a8',
  in_progress: '#e0a955',
  done: '#6cae6c',
};

function wrapText(text: string, maxWidth: number, size: number): string[] {
  const maxChars = Math.max(6, Math.floor(maxWidth / (size * CHAR_W)));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      // Tek kelime satırdan uzunsa sertçe böl.
      if (w.length > maxChars) {
        let rest = w;
        while (rest.length > maxChars) {
          lines.push(rest.slice(0, maxChars - 1) + '-');
          rest = rest.slice(maxChars - 1);
        }
        line = rest;
      } else {
        line = w;
      }
    }
  }
  if (line) lines.push(line);
  if (lines.length === 0) lines.push('');
  // En fazla 4 satır; taşan kısmı kısalt.
  if (lines.length > 4) {
    const kept = lines.slice(0, 4);
    kept[3] = kept[3].slice(0, Math.max(0, maxChars - 1)) + '…';
    return kept;
  }
  return lines;
}

interface LaidNode {
  node: PlanNode;
  lines: string[];
  x: number; // sol
  y: number; // üst
  w: number;
  h: number;
}

/**
 * parentId hiyerarşisini soldan sağa düzenli bir ağaç olarak yerleştirir (klasik zihin haritası).
 * Her düğüm bir sütuna (derinlik) düşer; yaprak düğümler ardışık dikey yuvalar alır; iç düğümler
 * çocuklarının dikey orta noktasına hizalanır. Birden çok kök alt alta istiflenir. Konumlar
 * "içerik birimi" (punto, ölçek 1) cinsindendir; sonra tek sayfaya sığacak şekilde ölçeklenir.
 */
function layoutTree(nodes: PlanNode[]): { laid: LaidNode[]; width: number; height: number } {
  const idSet = new Set(nodes.map((n) => n.id));
  const childrenOf = new Map<string | null, PlanNode[]>();
  for (const n of nodes) {
    const parent = n.parentId != null && idSet.has(n.parentId) ? n.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(n);
    childrenOf.set(parent, list);
  }

  const laidById = new Map<string, LaidNode>();
  let cursorY = 0; // sonraki yaprağın üst y'si
  let maxRight = 0;

  const place = (node: PlanNode, depth: number): LaidNode => {
    const lines = wrapText(node.title, NODE_W - 14, FONT);
    const h = lines.length * LINE_H + 2 * NODE_PAD_Y;
    const x = depth * (NODE_W + COL_GAP);
    const kids = childrenOf.get(node.id) ?? [];
    let y: number;
    if (kids.length === 0) {
      y = cursorY;
      cursorY += h + ROW_GAP;
    } else {
      const laidKids = kids.map((k) => place(k, depth + 1));
      const first = laidKids[0];
      const last = laidKids[laidKids.length - 1];
      y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - h / 2;
    }
    const laid: LaidNode = { node, lines, x, y, w: NODE_W, h };
    laidById.set(node.id, laid);
    maxRight = Math.max(maxRight, x + NODE_W);
    return laid;
  };

  for (const root of childrenOf.get(null) ?? []) {
    const before = cursorY;
    place(root, 0);
    // Kökler arası ek boşluk.
    if (cursorY > before) cursorY += ROW_GAP * 2;
  }

  const laid = [...laidById.values()];
  // Negatif y (iç düğüm çocuk ortalaması) olmasın diye tümünü kaydır.
  const minY = laid.reduce((m, l) => Math.min(m, l.y), 0);
  for (const l of laid) l.y -= minY;
  const height = laid.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  return { laid, width: maxRight, height };
}

/** GraphState → tek sayfalık, sığdırılmış PDF çizim modeli. */
export function buildPdfModel(state: GraphState, opts: BuildPdfOptions = {}): PdfDocModel {
  const template = resolveTemplate(opts.template);
  const title = (opts.title ?? 'Kanvas').trim() || 'Kanvas';
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const nodes = state.nodes;
  const doneCount = nodes.filter((n) => n.status === 'done').length;

  const prims: PdfPrim[] = [];
  // Başlık bandı.
  prims.push({ kind: 'text', x: MARGIN, y: MARGIN, text: title, size: 18, color: '#1a1a1a', bold: true });
  const stamp = generatedAt.slice(0, 16).replace('T', ' ');
  prims.push({
    kind: 'text',
    x: MARGIN,
    y: MARGIN + 22,
    text: `${nodes.length} düğüm · ${doneCount} tamamlandı · ${stamp}`,
    size: 9,
    color: '#6b6b6b',
  });

  const drawTop = MARGIN + HEADER_H;
  const printW = template.widthPt - 2 * MARGIN;
  const printH = template.heightPt - drawTop - MARGIN;

  if (nodes.length > 0 && printW > 0 && printH > 0) {
    const { laid, width, height } = layoutTree(nodes);
    // Aspect koruyarak sığdır (asla büyütme).
    const scale = Math.min(printW / Math.max(width, 1), printH / Math.max(height, 1), 1);
    const offsetX = MARGIN + (printW - width * scale) / 2;
    const offsetY = drawTop + (printH - height * scale) / 2;
    const tx = (x: number) => offsetX + x * scale;
    const ty = (y: number) => offsetY + y * scale;
    const byId = new Map(laid.map((l) => [l.node.id, l]));

    // Önce bağlayıcı çizgiler (kutuların altında kalsın).
    for (const l of laid) {
      const pid = l.node.parentId;
      if (pid == null) continue;
      const parent = byId.get(pid);
      if (!parent) continue;
      prims.push({
        kind: 'line',
        x1: tx(parent.x + parent.w),
        y1: ty(parent.y + parent.h / 2),
        x2: tx(l.x),
        y2: ty(l.y + l.h / 2),
        stroke: '#b0aca0',
        strokeWidth: Math.max(0.5, scale),
      });
    }
    // Sonra kutular + metin.
    for (const l of laid) {
      const st = l.node.status;
      prims.push({
        kind: 'rect',
        x: tx(l.x),
        y: ty(l.y),
        w: l.w * scale,
        h: l.h * scale,
        fill: STATUS_FILL[st],
        stroke: STATUS_STROKE[st],
        strokeWidth: Math.max(0.5, scale),
        radius: 4 * scale,
      });
      l.lines.forEach((line, i) => {
        prims.push({
          kind: 'text',
          x: tx(l.x) + 7 * scale,
          y: ty(l.y) + (NODE_PAD_Y + i * LINE_H + LINE_H - 3) * scale,
          text: line,
          size: FONT * scale,
          color: '#1f1f1f',
        });
      });
    }
  } else if (nodes.length === 0) {
    prims.push({ kind: 'text', x: MARGIN, y: drawTop + 20, text: '(boş kanvas)', size: 12, color: '#9a9a9a' });
  }

  return {
    title,
    template: template.id,
    generatedAt,
    nodeCount: nodes.length,
    doneCount,
    pages: [{ widthPt: template.widthPt, heightPt: template.heightPt, prims }],
  };
}
