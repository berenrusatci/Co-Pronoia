import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? `file:${join(here, '../data/treemapper.db')}`;
const port = Number(process.env.PORT ?? 3001);

const { app, service } = await buildApp(dbUrl);

// Seed a root node on first boot so the mind map always has an anchor.
if ((await service.headSeq()) === 0) {
  await service.commit(
    [{ op: 'add_node', title: 'Proje', description: 'Kök düğüm — planınızı buradan dallandırın.', nodeType: 'milestone', x: 0, y: 0 }],
    { message: 'İlk kurulum: kök düğüm' },
  );
}

// Prod mode: serve the built web app if present.
const webDist = join(here, '../../web/dist');
if (existsSync(webDist)) {
  app.register(fastifyStatic, { root: webDist });
}

await app.listen({ port, host: '127.0.0.1' });
console.log(`treemapper server on http://localhost:${port} (db: ${dbUrl})`);
