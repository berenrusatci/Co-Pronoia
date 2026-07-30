/**
 * Uygulama iki modda çalışır, tek kod tabanıyla:
 *
 * - `cloud` (öntanımlı, barındırılan kurulum): bugünkü davranış — kayıt, e-posta
 *   doğrulama, Google girişi, `/api/admin` paneli.
 * - `local` (Docker imajı `APP_MODE=local` verir): kullanıcının kendi makinesindeki
 *   tek kullanıcılık kurulum. Kayıt/giriş/admin uçları hiç register edilmez; kimlik
 *   bir kerelik bulut aktivasyonuyla gelir ve kalıcı olarak yerelde durur.
 */
export type AppMode = 'local' | 'cloud';

export function appMode(): AppMode {
  return process.env.APP_MODE === 'local' ? 'local' : 'cloud';
}

export function isLocal(): boolean {
  return appMode() === 'local';
}

/** Yerel kurulumun aktivasyon için konuşacağı bulut adresi (sondaki `/` atılır). */
export function cloudUrl(): string {
  const raw = process.env.CLOUD_URL ?? 'https://co-pronoia.onrender.com';
  return raw.replace(/\/+$/, '');
}
