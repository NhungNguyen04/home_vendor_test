/**
 * The demo dataset.
 *
 * The seed is the first thing a reviewer sees, so it has to cover the
 * interesting cases: the threshold boundary from both sides, a missing
 * stage-entry date, a terminal stage, and a vendor with no history at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SCHEMA } from '../src/db/schema.js';
import { createStatements } from '../src/db/queries.js';
import { seed, clear, SEED_COORDINATORS, SEED_VENDORS } from '../src/db/seed.js';
import { DAY_MS } from '../src/domain/duration.js';
import { isVendorStuck } from '../src/domain/duration.js';
import { NOW } from './helpers.js';

const THRESHOLD = 7;

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function seededDb() {
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);
  return { db, statements };
}

/** Elapsed time in the current stage, or null when the stage-entry time is unknown. */
function elapsed(vendor, now = NOW) {
  if (vendor.stage_entered_at === null) return null;
  return now - vendor.stage_entered_at;
}

test('the dataset has three coordinators', () => {
  const { db, statements } = seededDb();
  assert.equal(statements.countCoordinators.get().count, SEED_COORDINATORS.length);
  assert.deepEqual(
    statements.listCoordinators.all().map((c) => c.email),
    ['huy@company.vn', 'linh@company.vn', 'mai@company.vn'],
  );
  db.close();
});

test('the dataset has twelve vendors', () => {
  const { db, statements } = seededDb();
  assert.equal(statements.countVendors.get().count, SEED_VENDORS.length);
  assert.equal(statements.countVendors.get().count, 12);
  db.close();
});

test('every seeded vendor has a stage and a region', () => {
  const { db, statements } = seededDb();
  for (const vendor of statements.listVendors.all()) {
    assert.ok(vendor.stage, `${vendor.name} has no stage`);
    assert.ok(vendor.region, `${vendor.name} has no region`);
  }
  db.close();
});

test('the dataset contains both stuck and healthy vendors', () => {
  const { db, statements } = seededDb();

  const stuck = statements.listVendors
    .all()
    .filter((v) => isVendorStuck(v.stage, elapsed(v), THRESHOLD) === true);
  const healthy = statements.listVendors
    .all()
    .filter((v) => isVendorStuck(v.stage, elapsed(v), THRESHOLD) === false);

  assert.ok(stuck.length >= 1, 'the demo needs at least one stuck vendor');
  assert.ok(healthy.length >= 1, 'the demo needs at least one healthy vendor');
  db.close();
});

test('the vendor sitting exactly on the threshold is not stuck', () => {
  const { db, statements } = seededDb();
  const vendor = statements.getVendor.get(5); // Company E, exactly 7 days

  assert.equal(vendor.stage_entered_at, NOW - 7 * DAY_MS);
  assert.equal(isVendorStuck(vendor.stage, NOW - vendor.stage_entered_at, THRESHOLD), false);
  db.close();
});

test('the vendor one millisecond past the threshold is stuck', () => {
  const { db, statements } = seededDb();
  const vendor = statements.getVendor.get(10); // Company J, 7 days + 1 ms

  assert.equal(vendor.stage_entered_at, NOW - 7 * DAY_MS - 1);
  assert.equal(isVendorStuck(vendor.stage, NOW - vendor.stage_entered_at, THRESHOLD), true);
  db.close();
});

test('exactly one vendor has no stage-entry time', () => {
  const { db, statements } = seededDb();

  const unknown = statements.listVendors.all().filter((v) => v.stage_entered_at === null);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].name, 'Company H');
  db.close();
});

test('a vendor with no stage-entry time is not counted as stuck', () => {
  const { db, statements } = seededDb();
  const vendor = statements.getVendor.get(8);

  assert.equal(elapsed(vendor), null);
  assert.equal(isVendorStuck(vendor.stage, elapsed(vendor), THRESHOLD), null);
  db.close();
});

test('a vendor in the terminal stage is not flagged even after 90 days', () => {
  const { db, statements } = seededDb();
  const vendor = statements.getVendor.get(1); // Company A, Active, 90 days

  assert.equal(vendor.stage, 'Active');
  assert.equal(isVendorStuck(vendor.stage, NOW - vendor.stage_entered_at, THRESHOLD), false);
  db.close();
});

test('no history entry is dated in the future', () => {
  const { db, statements } = seededDb();
  for (const entry of db.prepare('SELECT * FROM stage_history').all()) {
    assert.ok(entry.changed_at <= NOW, `history row ${entry.id} is in the future`);
  }
  db.close();
});

test('no seeded history entry is a no-op', () => {
  const { db, statements } = seededDb();
  for (const entry of db.prepare('SELECT * FROM stage_history').all()) {
    assert.ok(
      entry.previous_stage === null || entry.previous_stage !== entry.new_stage,
      `history row ${entry.id} claims nothing changed`,
    );
  }
  db.close();
});

test('every seeded vendor has at least one history entry, except the imported one', () => {
  const { db, statements } = seededDb();

  const withHistory = statements.listVendors.all().filter(
    (v) => statements.listHistory.all(v.id).length > 0,
  );
  const withoutHistory = statements.listVendors.all().filter(
    (v) => statements.listHistory.all(v.id).length === 0,
  );

  assert.equal(withHistory.length, 11);
  assert.equal(withoutHistory.length, 1);
  assert.equal(withoutHistory[0].name, 'Company H');
  db.close();
});

test('clearing and reseeding produces the same dataset', () => {
  const { db, statements } = seededDb();

  const before = statements.listVendors.all();
  const historyBefore = db.prepare('SELECT * FROM stage_history ORDER BY id').all();

  clear(db, statements);
  assert.equal(statements.countVendors.get().count, 0);
  assert.equal(statements.countHistory.get().count, 0);

  seed(db, statements, NOW);

  const after = statements.listVendors.all();
  const historyAfter = db.prepare('SELECT * FROM stage_history ORDER BY id').all();

  assert.deepEqual(after, before);
  assert.deepEqual(historyAfter, historyBefore);
  db.close();
});

test('the seed is positioned relative to the clock it is given', () => {
  // The same dataset, one day later, has every vendor one day further along -
  // which is what keeps the demo honest when the clock is not frozen.
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  const vendor = statements.getVendor.get(3); // Company C, 3 days in stage
  assert.equal(vendor.stage_entered_at, NOW - 3 * DAY_MS);

  const later = NOW + DAY_MS;
  assert.equal(later - vendor.stage_entered_at, 4 * DAY_MS);
  db.close();
});
