import { useState } from 'react';
import { PDF_TEMPLATES, type PdfTemplateId } from '@treemapper/shared';
import { api, ApiError } from '../api/client';
import { useCanvasStore } from '../store/canvasStore';

/** Dosya adına girmeyecek karakterleri temizler (Türkçe sadeleştirilir). */
function slugify(name: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  return name.replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => map[ch] ?? ch).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'kanvas';
}

/**
 * Sunucu tarafı vektörel PDF indirme (plandaki pdf-ui-panel + pdf-templates). Zihin haritasının
 * hiyerarşisini sunucuda çizer — mevcut html-to-image rasterleştiricisinden (ExportButton) farklı,
 * tamamlayıcı bir yol: metin seçilebilir, dosya küçük, görünümden bağımsız.
 */
export function ServerPdfButton() {
  const canvasName = useCanvasStore((s) => s.active?.name ?? 'kanvas');
  const [template, setTemplate] = useState<PdfTemplateId>('a4-portrait');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      saveBlob(await api.pdfBlob(template), `${slugify(canvasName)}-plan.pdf`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'PDF oluşturulamadı');
    } finally {
      setBusy(false);
    }
  };

  const exportJson = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      saveBlob(await api.exportBlob(), `${slugify(canvasName)}-paket.json`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Dışa aktarılamadı');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="server-pdf">
      <select
        value={template}
        onChange={(e) => setTemplate(e.target.value as PdfTemplateId)}
        disabled={busy}
        title="PDF sayfa şablonu"
      >
        {Object.values(PDF_TEMPLATES).map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      <button onClick={() => void download()} disabled={busy} title={err ?? 'Zihin haritasını sunucuda vektörel PDF olarak indir'}>
        {busy ? 'Hazırlanıyor…' : err ? '⚠ Tekrar dene' : '📄 PDF'}
      </button>
      <button onClick={() => void exportJson()} disabled={busy} title="Kanvası taşınabilir JSON paketi olarak indir (panodan içe aktarılabilir)">
        ⬇ JSON
      </button>
    </span>
  );
}
