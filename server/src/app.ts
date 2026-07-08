import Fastify from 'fastify';
import { openDb } from './db.js';
import { CommitService } from './commitService.js';
import { registerRoutes } from './routes.js';

export function buildApp(dbPath: string) {
  const db = openDb(dbPath);
  const service = new CommitService(db);
  const app = Fastify({ logger: false });
  registerRoutes(app, service);
  return { app, service, db };
}
