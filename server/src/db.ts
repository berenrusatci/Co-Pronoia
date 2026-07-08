import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id             TEXT PRIMARY KEY,
      parent_id      TEXT REFERENCES nodes(id),
      title          TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      node_type      TEXT NOT NULL DEFAULT 'task',
      status         TEXT NOT NULL DEFAULT 'planned',
      x              REAL,
      y              REAL,
      created_commit INTEGER NOT NULL,
      updated_commit INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS edges (
      id             TEXT PRIMARY KEY,
      source_id      TEXT NOT NULL,
      target_id      TEXT NOT NULL,
      kind           TEXT NOT NULL DEFAULT 'flow',
      label          TEXT NOT NULL DEFAULT '',
      created_commit INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS commits (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ops        TEXT NOT NULL
    );
  `);
  return db;
}
