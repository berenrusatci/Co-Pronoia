import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Yerel Docker imajının bundle'ı gerçekten "sade uygulama" mı?
 *
 * Yerel kurulumda giriş ekranı yoktur ve kayıt/giriş, Google OAuth, site yönetim paneli,
 * davet/üyelik yönetimi ve Gemini ajanı hiç kullanılmaz. Bunları çalışma anında `if` ile
 * kapatmak kodu imajda bırakır — gereksiz saldırı yüzeyi. `build.mjs --local` bu dalları
 * `mode.ts`teki derleme-anı kapısıyla eler.
 *
 * Bu test o elemenin GERÇEKTEN olduğunu ölçer. Kolay bozulan bir mekanizma: kapı ifadesi
 * `globalThis.__LOCAL_BUILD__` yazımından saparsa ya da `minifySyntax` kapatılırsa esbuild
 * ölü dalı sessizce bundle'da bırakır — o zaman burası düşer.
 *
 * Not: Türkçe metin aramayın; esbuild çıktısında `ı` gibi harfler `ı` olarak kaçırılır.
 * Bu yüzden ASCII sembol adları üzerinden ölçüyoruz.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');

/** Yerel bundle'da BULUNMAMASI gereken semboller (mod kapılarının arkasındaki modüller). */
const MUST_BE_GONE = [
  'registerAuthRoutes',   // kayıt / e-posta doğrulama / giriş / şifre
  'createSession',        // oturum çerezi üretimi
  'verifyPassword',       // scrypt şifre doğrulama
  'registerGoogleAuth',   // Google OAuth
  'registerAdminRoutes',  // /api/admin paneli
  'emailConfigured',      // SMTP / nodemailer yolu
  'runAgent',             // yerleşik Gemini ajanı
  'geminiConfigured',
];

/** Yerelde de çalışması gereken çekirdek: MCP, bölgeler, aktivasyon, commit motoru. */
const MUST_REMAIN = [
  'registerMcpRoutes',
  'submit_proposal',
  'registerLocalIdentityRoutes',
  'regionViolation',
  'pullCloudCanvases',
  'rotateAgentToken',
];

describe('yerel imaj bundle budaması', () => {
  let dir: string;
  let localBundle: string;
  let cloudBundle: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cop-bundle-'));
    const build = (args: string[]) =>
      execFileSync(process.execPath, [join(serverDir, 'build.mjs'), ...args], {
        cwd: serverDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    build(['--local', `--outfile=${join(dir, 'local.mjs')}`]);
    build([`--outfile=${join(dir, 'cloud.mjs')}`]);
    localBundle = readFileSync(join(dir, 'local.mjs'), 'utf8');
    cloudBundle = readFileSync(join(dir, 'cloud.mjs'), 'utf8');
  }, 120_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('kimlik/yönetim/ajan kodu yerel bundle\'da HİÇ yok', () => {
    const leaked = MUST_BE_GONE.filter((sym) => localBundle.includes(sym));
    expect(leaked).toEqual([]);
  });

  it('aynı semboller bulut bundle\'ında duruyor (test kendini kandırmıyor)', () => {
    // MUST_BE_GONE listesi yanlış yazılmış sembollerle dolsaydı ilk test bedavaya geçerdi.
    const missing = MUST_BE_GONE.filter((sym) => !cloudBundle.includes(sym));
    expect(missing).toEqual([]);
  });

  it('çekirdek (MCP, bölgeler, aktivasyon) yerel bundle\'da duruyor', () => {
    const missing = MUST_REMAIN.filter((sym) => !localBundle.includes(sym));
    expect(missing).toEqual([]);
  });

  it('yerel bundle bulut bundle\'ından belirgin biçimde küçük', () => {
    expect(localBundle.length).toBeLessThan(cloudBundle.length * 0.85);
  });
});
