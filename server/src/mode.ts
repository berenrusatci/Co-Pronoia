/**
 * Uygulama iki modda çalışır, tek kod tabanıyla:
 *
 * - `cloud` (öntanımlı, barındırılan kurulum): bugünkü davranış — kayıt, e-posta
 *   doğrulama, Google girişi, `/api/admin` paneli.
 * - `local` (Docker imajı `APP_MODE=local` verir): kullanıcının kendi makinesindeki
 *   tek kullanıcılık kurulum. Kayıt/giriş/admin/davet/üyelik uçları hiç register
 *   edilmez; kimlik bir kerelik bulut aktivasyonuyla gelir ve kalıcı olarak yerelde
 *   durur.
 *
 * ## İki katmanlı mod bayrağı (runtime + derleme anı)
 *
 * `isLocal()` **runtime** kararıdır ve testler için şarttır: activation.test.ts tek
 * süreçte hem bulut hem yerel app ayağa kaldırır, `buildApp` modu kurulum anında bir
 * kez okur. Bu katman aynen korunur.
 *
 * `LOCAL_BUILD` ise **derleme anı** sabitidir. Yerel Docker imajı sunucuyu esbuild ile
 * bundle ederken `--define:__LOCAL_BUILD__=true` verir; aşağıdaki ifade `true`ya katlanır
 * ve `if (!LOCAL_BUILD && !localMode) …` biçimindeki kapılar ölü koda dönüşerek bundle'dan
 * TAMAMEN düşer — yani yerel imajın içinde admin route'ları, kayıt/giriş akışı, Google
 * OAuth ve Gemini ajanı diye bir kod hiç bulunmaz (yalnız kapatılmış olmaz). Güvenlik
 * gerekçesi: yerel kurulumda giriş ekranı yoktur, o yüzden orada asla çalışmayacak
 * kimlik/yönetim kodunu imajda taşımak gereksiz saldırı yüzeyidir.
 *
 * define verilmediğinde (vitest, `npm run dev`, bulut imajı) `__LOCAL_BUILD__` tanımsızdır,
 * `LOCAL_BUILD` false kalır ve karar tümüyle runtime `localMode`a düşer. Yani bu sabit
 * davranışı ASLA değiştirmez, yalnızca yerel bundle'da kodu siler.
 */
export type AppMode = 'local' | 'cloud';

declare global {
  // eslint-disable-next-line no-var
  var __LOCAL_BUILD__: boolean | undefined;
}

/**
 * Kapıları **bilerek** şu biçimde yazın:
 *
 *     if (!globalThis.__LOCAL_BUILD__ && !localMode) …
 *
 * Neden `LOCAL_BUILD` gibi bir sabit değil: esbuild `define` değerini yalnız yerine
 * yazdığı ifadede katlar; `export const LOCAL_BUILD = …` biçiminde bir sabiti modüller
 * arasında kullanım yerine GÖMMEZ, dolayısıyla `if (!LOCAL_BUILD && …)` ölü koda dönmez
 * ve eleme yapılmaz (bu bir kez denendi ve elenmediği ölçüldü). `globalThis.__LOCAL_BUILD__`
 * bir dot-chain olduğu için `define` doğrudan kapının içine `true` yazar, ifade `!true && …`
 * → `false`a katlanır ve dal + yalnız orada kullanılan import'lar bundle'dan düşer.
 *
 * Çalışma zamanı güvenliği: define verilmeyen her ortamda (vitest, `npm run dev`, bulut
 * bundle'ı) bu okuma `undefined` döner — bare identifier olmadığı için ReferenceError
 * atmaz — ve karar tümüyle runtime `localMode`a düşer. Bir env değişkeniyle yanlışlıkla
 * tetiklenemez.
 */
export const LOCAL_BUILD: boolean = globalThis.__LOCAL_BUILD__ === true;

export function appMode(): AppMode {
  return process.env.APP_MODE === 'local' ? 'local' : 'cloud';
}

export function isLocal(): boolean {
  return LOCAL_BUILD || appMode() === 'local';
}

/** Yerel kurulumun aktivasyon için konuşacağı bulut adresi (sondaki `/` atılır). */
export function cloudUrl(): string {
  const raw = process.env.CLOUD_URL ?? 'https://co-pronoia.onrender.com';
  return raw.replace(/\/+$/, '');
}
