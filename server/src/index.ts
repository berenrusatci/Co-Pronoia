import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? 'postgresql://treemapper:treemapper@localhost:5433/treemapper?schema=public';
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';

const { app } = await buildApp(dbUrl);

// Prod mode: serve the built web app if present.
const webDist = join(here, '../../web/dist');
if (existsSync(webDist)) {
  app.register(fastifyStatic, { root: webDist });
}

await app.listen({ port, host });
console.log(`treemapper server on http://${host}:${port} (db: ${dbUrl})`);
