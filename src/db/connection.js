import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA } from './schema.js';

/**
 * Open the database and make sure the schema exists.
 *
 * `foreign_keys` is OFF by default in SQLite, so it is switched on here
 * explicitly - the schema's REFERENCES clauses are decorative without it.
 *
 * @param {string} dbPath a file path, or ':memory:' for tests
 */
export function openDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
