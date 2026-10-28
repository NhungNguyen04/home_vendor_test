import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import request from 'supertest';
import { SCHEMA } from '../src/db/schema.js';
import { createStatements } from '../src/db/queries.js';
import { seed } from '../src/db/seed.js';
import { createSessionStore } from '../src/services/auth-service.js';
import { createApp } from '../src/app.js';
import { createClock } from '../src/clock.js';

/** 2026-08-10T00:00:00Z - the instant the demo dataset is positioned against. */
export const NOW = Date.UTC(2026, 7, 10);

export const DEMO_PASSWORD = 'ops1234';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Build an application backed by an in-memory database and a fixed clock.
 * Every test gets its own, so nothing leaks between them.
 */
export function createTestContext({ now = NOW } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const statements = createStatements(db);
  seed(db, statements, now);

  const clock = createClock({ frozenNow: new Date(now).toISOString() });
  const sessions = createSessionStore({ ttlMs: 60 * 60 * 1000 });
  const config = {
    stuckThresholdDays: 7,
    sessionTtlMs: 60 * 60 * 1000,
    publicDir: path.join(projectRoot, 'public'),
  };

  const app = createApp({ db, statements, sessions, clock, config });

  return { db, statements, sessions, clock, config, app, now };
}

/** A supertest agent that has signed in and carries the session cookie. */
export async function signIn(app, email = 'linh@company.vn', password = DEMO_PASSWORD) {
  const agent = request.agent(app);
  const response = await agent.post('/api/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`sign-in failed with status ${response.status}`);
  }
  return agent;
}
