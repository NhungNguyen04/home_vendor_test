/**
 * The database constraints.
 *
 * The application validates stages in the service layer, but the database
 * enforces them too - so a bug in the application cannot leave the database
 * holding a stage that does not exist, or a history entry that says nothing
 * changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SCHEMA, migrate } from '../src/db/schema.js';
import { createStatements } from '../src/db/queries.js';
import { seed } from '../src/db/seed.js';
import { NOW } from './helpers.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

test('an invalid stage is rejected by the database', () => {
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  assert.throws(
    () =>
      statements.insertVendor.run({
        id: 99,
        name: 'Company Z',
        region: 'Hanoi',
        stage: 'Cancelled',
        stageEnteredAt: NOW,
        ownerId: 1,
        notes: null,
        version: 1,
      }),
    /CHECK constraint failed/i,
  );
});

test('a missing stage-entry timestamp is allowed', () => {
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  const vendor = statements.getVendor.get(8);
  assert.equal(vendor.stage_entered_at, null);
  assert.equal(vendor.stage, 'KYC Docs Received');
});

test('a history entry naming an unknown coordinator is rejected', () => {
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  assert.throws(
    () =>
      statements.insertHistory.run({
        vendorId: 3,
        changedBy: 9999, // no such coordinator
        previousStage: 'Contract Signed',
        newStage: 'KYC Docs Received',
        changedAt: NOW,
        reason: null,
      }),
    /FOREIGN KEY constraint failed/i,
  );
});

test('a history entry naming an unknown vendor is rejected', () => {
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  assert.throws(
    () =>
      statements.insertHistory.run({
        vendorId: 9999,
        changedBy: 1,
        previousStage: 'Contract Signed',
        newStage: 'KYC Docs Received',
        changedAt: NOW,
        reason: null,
      }),
    /FOREIGN KEY constraint failed/i,
  );
});

test('a history entry that claims nothing changed is rejected', () => {
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  assert.throws(
    () =>
      statements.insertHistory.run({
        vendorId: 3,
        changedBy: 1,
        previousStage: 'Contract Signed',
        newStage: 'Contract Signed',
        changedAt: NOW,
        reason: null,
      }),
    /CHECK constraint failed/i,
  );
});

test('a history entry with no previous stage is allowed', () => {
  // A vendor imported straight into a stage has no prior stage to record.
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  const inserted = statements.insertHistory.run({
    vendorId: 3,
    changedBy: 1,
    previousStage: null,
    newStage: 'Contract Signed',
    changedAt: NOW,
    reason: null,
  });

  assert.ok(inserted.lastInsertRowid);
});

// --------------------------------------------------------------- the reason

test('a history entry can carry a reason, and it reads back', () => {
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  statements.insertHistory.run({
    vendorId: 3,
    changedBy: 1,
    previousStage: 'Contract Signed',
    newStage: 'Contract Sent',
    changedAt: NOW,
    reason: 'Wrongly entered - the contract was never sent',
  });

  const entry = statements.listHistory.all(3)[0];
  assert.equal(entry.reason, 'Wrongly entered - the contract was never sent');
});

test('a history entry without a reason has none, rather than an empty string', () => {
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  const entry = statements.listHistory.all(3)[0];
  assert.equal(entry.reason, null);
});

// ------------------------------------------------------------- the migration

/** The schema as it was before the reason column existed. */
const PREVIOUS_SCHEMA = `
CREATE TABLE IF NOT EXISTS stage_history (
  id             INTEGER PRIMARY KEY,
  vendor_id      INTEGER NOT NULL REFERENCES vendors(id),
  changed_by     INTEGER NOT NULL REFERENCES coordinators(id),
  previous_stage TEXT,
  new_stage      TEXT    NOT NULL
                 CHECK (new_stage IN ('Contract Sent','Contract Signed',
                                      'KYC Docs Received','KYC Verified','Active')),
  changed_at     INTEGER NOT NULL,
  CHECK (previous_stage IS NULL OR previous_stage <> new_stage)
);
`;

test('the migration adds the reason column to a database from the previous version', () => {
  const db = new Database(':memory:');
  db.exec(PREVIOUS_SCHEMA);

  assert.equal(
    db.prepare('PRAGMA table_info(stage_history)').all().some((c) => c.name === 'reason'),
    false,
  );

  migrate(db);

  assert.equal(
    db.prepare('PRAGMA table_info(stage_history)').all().some((c) => c.name === 'reason'),
    true,
  );
  db.close();
});

test('the migration is a no-op on a database that is already current', () => {
  const db = freshDb();

  migrate(db);

  const columns = db.prepare('PRAGMA table_info(stage_history)').all();
  assert.equal(columns.filter((c) => c.name === 'reason').length, 1);
  db.close();
});

test('the migration leaves the rows already in the table alone', () => {
  const db = new Database(':memory:');
  db.exec(PREVIOUS_SCHEMA);
  db.exec(`
    CREATE TABLE IF NOT EXISTS coordinators (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL,
      stage TEXT NOT NULL, stage_entered_at INTEGER,
      owner_id INTEGER REFERENCES coordinators(id), notes TEXT,
      version INTEGER NOT NULL DEFAULT 1);
  `);
  db.prepare(
    `INSERT INTO coordinators (id, name, email, password_hash, password_salt)
     VALUES (1, 'Linh', 'linh@company.vn', 'hash', 'salt')`,
  ).run();
  db.prepare(
    `INSERT INTO vendors (id, name, region, stage, stage_entered_at, owner_id, notes, version)
     VALUES (1, 'Company C', 'Hanoi', 'Contract Signed', ?, 1, NULL, 2)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO stage_history
       (id, vendor_id, changed_by, previous_stage, new_stage, changed_at)
     VALUES (1, 1, 1, 'Contract Sent', 'Contract Signed', ?)`,
  ).run(NOW);

  migrate(db);

  const row = db.prepare('SELECT * FROM stage_history WHERE id = 1').get();
  assert.equal(row.new_stage, 'Contract Signed');
  assert.equal(row.reason, null);
  db.close();
});

/**
 * The five invariants the seeded dataset is supposed to hold. They are checked
 * here as a whole, because they are properties of the data rather than of one
 * row.
 */
test('the seeded dataset holds its invariants', () => {
  const db = freshDb();
  const statements = createStatements(db);
  seed(db, statements, NOW);

  const vendors = statements.listVendors.all();
  const history = db.prepare('SELECT * FROM stage_history').all();

  // I1: no history entry claims the stage did not change.
  for (const entry of history) {
    assert.ok(
      entry.previous_stage === null || entry.previous_stage !== entry.new_stage,
      `history row ${entry.id} is a no-op`,
    );
  }

  // I2: every history entry points at a real vendor and a real coordinator.
  for (const entry of history) {
    assert.ok(statements.getVendor.get(entry.vendor_id), 'dangling vendor');
    assert.ok(statements.getCoordinator.get(entry.changed_by), 'dangling coordinator');
  }

  // I3: no history entry is dated in the future.
  for (const entry of history) {
    assert.ok(entry.changed_at <= NOW, `history row ${entry.id} is in the future`);
  }

  // I4: a vendor's current stage is the stage its last history entry moved it
  // into, and its stage-entry time is that entry's timestamp.
  for (const vendor of vendors) {
    const entries = statements.listHistory.all(vendor.id);
    if (entries.length === 0) {
      assert.equal(vendor.stage_entered_at, null, `${vendor.name} has no history`);
      continue;
    }
    const latest = entries[0];
    assert.equal(vendor.stage, latest.new_stage, `${vendor.name} stage disagrees with history`);
    assert.equal(
      vendor.stage_entered_at,
      latest.changed_at,
      `${vendor.name} stage-entry time disagrees with history`,
    );
  }

  // I5: the version counts the changes, so a client always submits a version
  // that is one behind the number of recorded transitions.
  for (const vendor of vendors) {
    const entries = statements.listHistory.all(vendor.id);
    assert.equal(
      vendor.version,
      entries.length + 1,
      `${vendor.name} version does not match its history`,
    );
  }

  db.close();
});
