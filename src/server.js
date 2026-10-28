import { config } from './config.js';
import { clock } from './clock.js';
import { openDb } from './db/connection.js';
import { createStatements } from './db/queries.js';
import { seed } from './db/seed.js';
import { createSessionStore } from './services/auth-service.js';
import { createApp } from './app.js';

const db = openDb(config.dbPath);
const statements = createStatements(db);

// A fresh clone should just run, so seed an empty database on first boot.
if (statements.countVendors.get().count === 0) {
  console.log('Empty database - seeding the demo dataset.');
  seed(db, statements, clock.now());
}

const sessions = createSessionStore({ ttlMs: config.sessionTtlMs });
const app = createApp({ db, statements, sessions, clock, config });

app.listen(config.port, () => {
  console.log(`Vendor Onboarding Tracker  ->  http://localhost:${config.port}`);
  console.log(`Database: ${config.dbPath}`);
  console.log(
    `Now: ${new Date(clock.now()).toISOString()}${clock.isFrozen() ? '  (frozen demo clock)' : ''}`,
  );
  console.log(`Stuck threshold: ${config.stuckThresholdDays} days`);
  console.log('Sign in as linh@company.vn / huy@company.vn / mai@company.vn');
});
