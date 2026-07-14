import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://treemapper:treemapper@localhost:5433/treemapper');
const urlWithDb = (name: string): string => {
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  return u.toString();
};

/**
 * Pushes the Prisma schema once into a template Postgres database (≈300ms), then hands out
 * cheap per-test databases created via `CREATE DATABASE ... TEMPLATE` (the Postgres analog of
 * the old SQLite file-copy trick). Call once per suite; `fresh()` per test.
 */
export function testDbFactory(): { fresh: () => Promise<string>; cleanup: () => Promise<void> } {
  const suiteId = Math.random().toString(36).slice(2, 8);
  const templateDb = `tm_template_${suiteId}`;
  const created: string[] = [];
  let n = 0;

  const admin = new pg.Pool({ connectionString: urlWithDb('postgres'), max: 8 });
  const ready = (async () => {
    await admin.query(`CREATE DATABASE "${templateDb}"`);
    execSync(`npx prisma db push --url "${urlWithDb(templateDb)}"`, {
      cwd: serverDir,
      stdio: 'pipe',
    });
  })();

  const dropDb = async (name: string) => {
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    } catch (err) {
      console.error(`testDb: failed to drop database "${name}"`, err);
    }
  };

  return {
    fresh: async () => {
      await ready;
      const dbName = `tm_test_${suiteId}_${n++}`;
      await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE "${templateDb}"`);
      created.push(dbName);
      return urlWithDb(dbName);
    },
    cleanup: async () => {
      await ready;
      await Promise.all(created.map(dropDb));
      await dropDb(templateDb);
      await admin.end();
    },
  };
}
