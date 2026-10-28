#!/usr/bin/env node
/**
 * Reseed the database and print what it contains.
 *
 *   npm run seed          reset and reseed
 *   npm run seed -- --keep   reseed only when the database is empty
 */
import { config } from '../src/config.js';
import { clock } from '../src/clock.js';
import { openDb } from '../src/db/connection.js';
import { createStatements } from '../src/db/queries.js';
import { seed, clear } from '../src/db/seed.js';
import { computeDuration, isVendorStuck, formatDuration } from '../src/domain/duration.js';

const reset = !process.argv.includes('--keep');
const db = openDb(config.dbPath);
const statements = createStatements(db);

if (reset) {
  clear(db, statements);
}

if (statements.countVendors.get().count === 0) {
  seed(db, statements, clock.now());
}

const now = clock.now();
const vendors = statements.listVendors.all();

console.log(`\nDatabase: ${config.dbPath}`);
console.log(`Now:      ${new Date(now).toISOString()}${clock.isFrozen() ? '  (frozen demo clock)' : ''}`);
console.log(`Stuck threshold: ${config.stuckThresholdDays} days\n`);

const pad = (value, width) => String(value).padEnd(width);

console.log(
  pad('Vendor', 12) + pad('Region', 10) + pad('Stage', 18) + pad('In stage', 12) + 'Status',
);
console.log('-'.repeat(70));

let stuckCount = 0;
for (const vendor of vendors) {
  const { known, durationMs } = computeDuration(vendor.stage_entered_at, now);
  const stuck = isVendorStuck(vendor.stage, durationMs, config.stuckThresholdDays);
  if (stuck === true) stuckCount += 1;

  const status = stuck === null ? 'unknown duration' : stuck ? 'STUCK' : 'on track';
  console.log(
    pad(vendor.name, 12) +
      pad(vendor.region, 10) +
      pad(vendor.stage, 18) +
      pad(known ? formatDuration(durationMs) : 'Unknown', 12) +
      status,
  );
}

console.log(`\n${vendors.length} vendors, ${stuckCount} stuck.\n`);
db.close();
