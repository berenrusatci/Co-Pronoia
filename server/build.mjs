/**
 * Sunucuyu tek bir ESM bundle'a derler (`dist/server.mjs`).
 *
 * Neden bundle? Yerel Docker imajı `APP_MODE=local` ile çalışır ve orada kayıt/giriş,
 * Google OAuth, `/api/admin` paneli, davet/üyelik uçları ve Gemini ajanı hiç kullanılmaz.
 * Bunları çalışma anında `if` ile kapatmak kodu imajda bırakır — gereksiz saldırı yüzeyi.
 * Bunun yerine `--define:__LOCAL_BUILD__=true` ile `mode.ts`teki `LOCAL_BUILD` sabiti
 * derleme anında `true`ya katlanır, `if (!LOCAL_BUILD && !localMode)` dalları ölü koda
 * dönüşür ve esbuild o modülleri bundle'a HİÇ almaz.
 *
 * Kullanım:
 *   node build.mjs            → bulut bundle'ı (her şey içinde)
 *   node build.mjs --local    → yerel bundle'ı (kimlik/yönetim kodu elenmiş)
 *
 * npm bağımlılıkları external bırakılır (Prisma client'ın üretilmiş dosyaları ve motor
 * ikilisi bundle edilemez); yalnız kendi kodumuz ve `@treemapper/shared` içeri alınır.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

const local = process.argv.includes('--local');
// Testler bundle'ı geçici bir yola derleyip içeriğini denetler (localBundle.test.ts).
const outArg = process.argv.find((a) => a.startsWith('--outfile='));
const outfile = outArg ? outArg.slice('--outfile='.length) : join(here, 'dist/server.mjs');

// @treemapper/shared bir workspace paketi ve `main` alanı TypeScript kaynağını gösteriyor;
// çalışma anında çözülemez, o yüzden bundle'a dahil edilir. Gerisi node_modules'ta kalır.
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== '@treemapper/shared');

const result = await esbuild.build({
  entryPoints: [join(here, 'src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external,
  // Anahtar, kaynaktaki kapı ifadesiyle BİREBİR aynı olmalı (`mode.ts`e bak): esbuild
  // yalnız tam eşleşen identifier/dot-chain'i değiştirir.
  define: { 'globalThis.__LOCAL_BUILD__': local ? 'true' : 'false' },
  treeShaking: true,
  // Ölü kod elemesi için ŞART: esbuild `if (false) …` dallarını yalnız sözdizimi budaması
  // açıkken siler; silinmezse dal dursa da modül bundle'da kalır (bu bir kez ölçüldü).
  // İsim/boşluk minify'ı bilerek kapalı — imajdaki bundle denetlenebilir kalsın.
  minifySyntax: true,
  minifyIdentifiers: false,
  minifyWhitespace: false,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
});

const inputs = Object.keys(result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].inputs);
const ownFiles = inputs.filter((f) => !f.includes('node_modules'));
console.log(`[build] mod: ${local ? 'local' : 'cloud'} — ${ownFiles.length} kaynak dosya bundle edildi`);
