import { useState } from 'react';
import { Panel, getNodesBounds, useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '../store/canvasStore';
import { useGraphStore } from '../store/graphStore';

/** Dosya adına girmeyecek karakterleri temizler (Türkçe karakterler sadeleştirilir). */
function slugify(name: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  return (
    name
      .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => map[ch] ?? ch)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'kanvas'
  );
}

const ZOOM = 1.5; // sabit görüntüleme ölçeği: kanvas ne kadar büyürse büyüsün metinler net kalır
const TILE = 3000; // karo başına en fazla piksel; taşan içerik ek PDF sayfalarına bölünür
const PADDING = 40; // içerik çevresi boşluğu (flow birimi)

/**
 * Görünümü PDF olarak indirir. Kalite için ölçek sabittir: içerik TILE sınırını aşarsa görüntü
 * karolara bölünür ve her karo, kendi boyutunda (karo yataysa yatay) bir PDF sayfası olur —
 * küçültme/bulanıklaşma yok. İndirme sırasında `exporting` bayrağı açılır: kartlar ve bölgeler
 * açıklamalarını gösterir, zihin haritası ferah dizilir; ekran görünümü sonra eski haline döner.
 */
export function ExportButton({ suffix }: { suffix: string }) {
  const { getNodes } = useReactFlow();
  const canvasName = useCanvasStore((s) => s.active?.name ?? 'kanvas');
  const setExporting = useGraphStore((s) => s.setExporting);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (busy || getNodes().length === 0) return;
    setBusy(true);
    // PDF/görüntü kitaplıkları büyük: ana pakete girmesin, ilk indirmede yüklensin.
    const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
    setExporting(true);
    document.body.classList.add('exporting');
    // Açıklamalar açılıp React Flow düğüm boyutlarını yeniden ölçene kadar bekle.
    await new Promise((r) => setTimeout(r, 400));
    try {
      const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
      if (!viewport) return;
      const bounds = getNodesBounds(getNodes());
      bounds.x -= PADDING;
      bounds.y -= PADDING;
      bounds.width += 2 * PADDING;
      bounds.height += 2 * PADDING;

      const totalW = Math.ceil(bounds.width * ZOOM);
      const totalH = Math.ceil(bounds.height * ZOOM);
      const cols = Math.max(1, Math.ceil(totalW / TILE));
      const rows = Math.max(1, Math.ceil(totalH / TILE));
      const tileW = Math.ceil(totalW / cols);
      const tileH = Math.ceil(totalH / rows);
      // Sayfa boyutu karoyla birebir aynı: yatay içerik yatay sayfa alır, sığdırma/dönme derdi yok.
      const orientation = tileW >= tileH ? 'landscape' : 'portrait';
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#faf9f5';

      const pdf = new jsPDF({ orientation, unit: 'px', format: [tileW, tileH], hotfixes: ['px_scaling'] });
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const dataUrl = await toPng(viewport, {
            backgroundColor: bg,
            width: tileW,
            height: tileH,
            pixelRatio: 1,
            style: {
              width: `${tileW}px`,
              height: `${tileH}px`,
              transform: `translate(${-bounds.x * ZOOM - col * tileW}px, ${-bounds.y * ZOOM - row * tileH}px) scale(${ZOOM})`,
            },
          });
          if (row > 0 || col > 0) pdf.addPage([tileW, tileH], orientation);
          pdf.addImage(dataUrl, 'PNG', 0, 0, tileW, tileH);
        }
      }

      const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
      pdf.save(`${slugify(canvasName)}-${suffix}-${stamp}.pdf`);
    } finally {
      document.body.classList.remove('exporting');
      setExporting(false);
      setBusy(false);
    }
  };

  return (
    <Panel position="top-right">
      <button
        className="export-btn"
        onClick={() => void download()}
        disabled={busy}
        title="Bu görünümü açıklamalar dahil PDF olarak indir (büyük kanvaslar sayfalara bölünür)"
      >
        {busy ? 'Hazırlanıyor…' : '⬇ PDF indir'}
      </button>
    </Panel>
  );
}
