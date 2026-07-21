import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { PdfDocModel, PdfPrim } from '@treemapper/shared';

/**
 * Plandaki "PDF Çizim Motoru" (pdf-render-engine): shared'ın ürettiği ilkel çizim modelini
 * gerçek PDF baytlarına çevirir. Vektörel (metin seçilebilir, dosya küçük) — web'deki
 * html-to-image rasterleştiricisinden farklı, tamamlayıcı bir yol.
 *
 * Model koordinatları SOL-ÜST orijinlidir; pdf-lib SOL-ALT kullanır → y ekseni çevrilir.
 */

/** Standart Helvetica (WinAnsi) Türkçeye özgü ş/ğ/ı/İ ile birçok tipografik karakteri
 *  kodlayamaz (ç/ö/ü/â WinAnsi'de zaten var). Bilinenleri ASCII karşılığına indir; kalan
 *  kodlanamayan her karakteri '?' yap ki render motoru asla patlamasın. Font gömme (subsetting)
 *  plandaki ayrı bir perf düğümü — MVP'de bilinçli olarak sade tutuldu. */
const CHAR_FALLBACK: Record<string, string> = {
  ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I',
  '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...',
  '•': '-', '·': '-', '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≥': '>=', '≤': '<=', '×': 'x', '≡': '=', '™': '(tm)',
};
/** WinAnsi'de kod noktası ≤ 0xFF olsa da tanımsız olan yuvalar. */
const WINANSI_UNDEFINED = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
function winAnsiSafe(text: string): string {
  let out = '';
  for (const ch of text) {
    const mapped = CHAR_FALLBACK[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    out += cp <= 0xff && !WINANSI_UNDEFINED.has(cp) ? ch : '?';
  }
  return out;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function drawPrim(page: PDFPage, pageH: number, prim: PdfPrim, font: PDFFont, bold: PDFFont): void {
  if (prim.kind === 'rect') {
    page.drawRectangle({
      x: prim.x,
      y: pageH - prim.y - prim.h,
      width: prim.w,
      height: prim.h,
      color: prim.fill ? hexToRgb(prim.fill) : undefined,
      borderColor: prim.stroke ? hexToRgb(prim.stroke) : undefined,
      borderWidth: prim.strokeWidth ?? 0,
    });
  } else if (prim.kind === 'line') {
    page.drawLine({
      start: { x: prim.x1, y: pageH - prim.y1 },
      end: { x: prim.x2, y: pageH - prim.y2 },
      thickness: prim.strokeWidth,
      color: hexToRgb(prim.stroke),
    });
  } else {
    const size = Math.max(1, prim.size);
    // Model text.y metin taban çizgisi gibi kullanılmıştı (üstten LINE_H-3); pdf-lib de taban
    // çizgisi kullanır, o yüzden doğrudan çevir.
    page.drawText(winAnsiSafe(prim.text), {
      x: prim.x,
      y: pageH - prim.y,
      size,
      font: prim.bold ? bold : font,
      color: hexToRgb(prim.color),
    });
  }
}

export async function renderPdf(model: PdfDocModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(model.title);
  doc.setCreator('TreeMapper');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const p of model.pages) {
    const page = doc.addPage([p.widthPt, p.heightPt]);
    for (const prim of p.prims) drawPrim(page, p.heightPt, prim, font, bold);
  }
  return doc.save();
}
