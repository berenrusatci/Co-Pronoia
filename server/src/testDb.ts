import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pushes the Prisma schema once into a template SQLite file (≈300ms), then hands out
 * cheap per-test copies. Call once per suite; `fresh()` per test.
 */
export function testDbFactory(): { fresh: () => string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'treemapper-test-'));
  const template = join(dir, 'template.db');
  execSync(`npx prisma db push --url "file:${template}"`, {
    cwd: serverDir,
    stdio: 'pipe',
  });
  let n = 0;
  return {
    fresh: () => {
      const file = join(dir, `t${n++}.db`);
      cpSync(template, file);
      return `file:${file}`;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
