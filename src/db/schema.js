/**
 * The database schema.
 *
 * Kept as a JS string rather than a .sql file so the server and the tests
 * import exactly the same DDL without any path resolution between them.
 *
 * Two constraints carry weight:
 *   - the CHECK on stage keeps the five workflow stages authoritative even if
 *     application-level validation is bypassed;
 *   - the CHECK on previous_stage <> new_stage makes a duplicate history entry
 *     impossible at the database level, not merely unlikely.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS coordinators (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  region           TEXT    NOT NULL,
  stage            TEXT    NOT NULL
                   CHECK (stage IN ('Contract Sent','Contract Signed',
                                    'KYC Docs Received','KYC Verified','Active')),
  stage_entered_at INTEGER,
  owner_id         INTEGER REFERENCES coordinators(id),
  notes            TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stage_history (
  id             INTEGER PRIMARY KEY,
  vendor_id      INTEGER NOT NULL REFERENCES vendors(id),
  changed_by     INTEGER NOT NULL REFERENCES coordinators(id),
  previous_stage TEXT,
  new_stage      TEXT    NOT NULL
                 CHECK (new_stage IN ('Contract Sent','Contract Signed',
                                      'KYC Docs Received','KYC Verified','Active')),
  changed_at     INTEGER NOT NULL,
  reason         TEXT,
  CHECK (previous_stage IS NULL OR previous_stage <> new_stage)
);

CREATE INDEX IF NOT EXISTS idx_vendors_stage  ON vendors(stage);
CREATE INDEX IF NOT EXISTS idx_history_vendor ON stage_history(vendor_id, changed_at DESC);
`;

/**
 * Bring a database created by an earlier version up to the current schema.
 *
 * `CREATE TABLE IF NOT EXISTS` creates a missing table but cannot add a column
 * to one that already exists, so a database written by the previous version
 * would otherwise fail on the first stage change. This is one guarded ALTER,
 * not a migration framework: the database is still disposable, but a stale one
 * keeps working instead of breaking.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(stage_history)').all();

  if (!columns.some((column) => column.name === 'reason')) {
    db.exec('ALTER TABLE stage_history ADD COLUMN reason TEXT');
  }
}
