import type { PrismaClient } from '@prisma/client';

/** Şu an tek görsel ayar var; anahtar sabit tutulur ki ileride başkaları eklenebilsin. */
export const LOGIN_PREVIEW = 'login_preview';

/** Yüklenebilecek tipler. SVG bilerek yok: aynı origin'den servis edilen SVG script çalıştırabilir. */
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Ham bayt sınırı (base64 hali ~1.34x büyür; app.ts'deki bodyLimit buna göre ayarlı). */
export const MAX_BYTES = 2 * 1024 * 1024;

export interface SiteAssetValue {
  mimeType: string | null;
  /** Prisma `Bytes` alanı Uint8Array olarak gidip gelir; Buffer'a çeviren yer route'tur. */
  data: Uint8Array | null;
  url: string | null;
  updatedAt: Date;
}

export type SetResult = { error: string } | { ok: true };

const dataUrlRe = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i;

/**
 * `data:image/png;base64,...` çözer ve doğrular. Hata mesajları Türkçe döner çünkü
 * doğrudan admin panelinde gösteriliyor.
 */
export function parseDataUrl(
  dataUrl: string,
): { error: string } | { mimeType: string; data: Uint8Array<ArrayBuffer> } {
  const m = dataUrlRe.exec(dataUrl.trim());
  if (!m) return { error: 'Geçersiz görsel verisi (data URL bekleniyor).' };
  const mimeType = m[1].toLowerCase();
  if (!(ALLOWED_MIME as readonly string[]).includes(mimeType))
    return { error: `Desteklenmeyen tür: ${mimeType}. PNG, JPEG, WebP veya GIF yükleyin.` };
  let data: Uint8Array<ArrayBuffer>;
  try {
    const buf = Buffer.from(m[2], 'base64');
    data = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  } catch {
    return { error: 'Görsel çözümlenemedi.' };
  }
  if (data.length === 0) return { error: 'Görsel boş.' };
  if (data.length > MAX_BYTES)
    return { error: `Görsel çok büyük (${Math.round(data.length / 1024)} KB). En fazla 2 MB olabilir.` };
  return { mimeType, data };
}

/** Dış adresler yalnızca http(s) olabilir — `javascript:`/`data:` şemaları engellenir. */
export function validateUrl(url: string): { error: string } | { ok: true } {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { error: 'Geçersiz adres.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return { error: 'Adres http:// veya https:// ile başlamalı.' };
  if (url.length > 2000) return { error: 'Adres çok uzun.' };
  return { ok: true };
}

export async function getSiteAsset(prisma: PrismaClient, key: string): Promise<SiteAssetValue | null> {
  const row = await prisma.siteAsset.findUnique({ where: { key } });
  if (!row) return null;
  return { mimeType: row.mimeType, data: row.data ?? null, url: row.url, updatedAt: row.updatedAt };
}

/** Yüklenen dosyayı kaydeder; varsa önceki dış adresi temizler (ikisi aynı anda tutulmaz). */
export async function setSiteAssetUpload(
  prisma: PrismaClient,
  key: string,
  dataUrl: string,
): Promise<SetResult> {
  const parsed = parseDataUrl(dataUrl);
  if ('error' in parsed) return parsed;
  const value = { mimeType: parsed.mimeType, data: parsed.data, url: null };
  await prisma.siteAsset.upsert({ where: { key }, create: { key, ...value }, update: value });
  return { ok: true };
}

/** Dış adresi kaydeder; varsa önceki yüklenen baytları temizler. */
export async function setSiteAssetUrl(prisma: PrismaClient, key: string, url: string): Promise<SetResult> {
  const check = validateUrl(url);
  if ('error' in check) return check;
  const value = { url: url.trim(), data: null, mimeType: null };
  await prisma.siteAsset.upsert({ where: { key }, create: { key, ...value }, update: value });
  return { ok: true };
}

/** Ayarı siler → giriş ekranı paketle gelen örnek görsele döner. */
export async function clearSiteAsset(prisma: PrismaClient, key: string): Promise<void> {
  await prisma.siteAsset.deleteMany({ where: { key } });
}
