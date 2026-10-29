/**
 * The demo dataset.
 *
 * Every vendor's position in the workflow is expressed as an offset from the
 * injected clock rather than as an absolute date, so the dataset is identical
 * on every machine, in every timezone, and at any hour - and so a vendor
 * seeded at exactly the threshold stays exactly at the threshold.
 *
 * Each vendor's stage_entered_at is derived from its last history entry, and
 * its version is derived from the number of history entries. The dataset is
 * therefore self-consistent by construction rather than by hand.
 */
import { hashPassword } from '../passwords.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const days = (n) => n * DAY_MS;

/** The shared demo password. Public by design - see the README. */
export const DEMO_PASSWORD = 'ops1234';

export const SEED_COORDINATORS = [
  { id: 1, name: 'Linh', email: 'linh@company.vn' },
  { id: 2, name: 'Huy', email: 'huy@company.vn' },
  { id: 3, name: 'Mai', email: 'mai@company.vn' },
];

/**
 * `history` lists the transitions that produced the vendor's current stage,
 * oldest first. The last entry's `offsetMs` is how long ago the vendor
 * entered its current stage. A null `from` marks an imported spreadsheet row
 * that had no prior stage.
 */
export const SEED_VENDORS = [
  {
    id: 1,
    name: 'Company A',
    region: 'HCMC',
    ownerId: 1,
    notes: null,
    history: [{ from: 'KYC Verified', to: 'Active', offsetMs: days(90) }],
  },
  {
    id: 2,
    name: 'Company B',
    region: 'Can Tho',
    ownerId: 2,
    notes: 'Waiting on business license re-upload',
    history: [
      { from: 'Contract Sent', to: 'Contract Signed', offsetMs: days(31) },
      { from: 'Contract Signed', to: 'KYC Docs Received', offsetMs: days(24) },
    ],
  },
  {
    id: 3,
    name: 'Company C',
    region: 'Hanoi',
    ownerId: 1,
    notes: null,
    history: [{ from: 'Contract Sent', to: 'Contract Signed', offsetMs: days(3) }],
  },
  {
    // A rework loop: the licence was rejected, so the vendor was sent back to
    // re-sign. The backward hop carries the reason it was sent back.
    id: 4,
    name: 'Company D',
    region: 'HCMC',
    ownerId: 3,
    notes: null,
    history: [
      {
        from: 'KYC Docs Received',
        to: 'Contract Signed',
        offsetMs: days(9),
        reason: 'Business licence rejected - sent back to re-sign',
      },
      { from: 'Contract Signed', to: 'KYC Docs Received', offsetMs: days(7) },
      { from: 'KYC Docs Received', to: 'KYC Verified', offsetMs: days(6) },
    ],
  },
  {
    // Exactly at the threshold - not stuck.
    id: 5,
    name: 'Company E',
    region: 'Da Nang',
    ownerId: 2,
    notes: null,
    history: [{ from: 'Contract Signed', to: 'KYC Docs Received', offsetMs: days(7) }],
  },
  {
    // Imported straight into "Contract Sent" - the first entry has no prior stage.
    id: 6,
    name: 'Company F',
    region: 'HCMC',
    ownerId: 3,
    notes: null,
    history: [{ from: null, to: 'Contract Sent', offsetMs: days(12) }],
  },
  {
    id: 7,
    name: 'Company G',
    region: 'Hanoi',
    ownerId: 1,
    notes: null,
    history: [{ from: 'KYC Verified', to: 'Active', offsetMs: days(45) }],
  },
  {
    // Imported from the spreadsheet with a blank date, so there is no
    // stage-entry time and no history to derive one from. Its stage is stated
    // directly because there is no transition to derive it from.
    id: 8,
    name: 'Company H',
    region: 'Hanoi',
    ownerId: 1,
    notes: 'Stage-entry date was blank in the spreadsheet',
    stage: 'KYC Docs Received',
    history: [],
  },
  {
    id: 9,
    name: 'Company I',
    region: 'Da Nang',
    ownerId: 2,
    notes: null,
    history: [{ from: 'Contract Sent', to: 'Contract Signed', offsetMs: days(8) }],
  },
  {
    // One millisecond past the threshold - stuck.
    id: 10,
    name: 'Company J',
    region: 'Hanoi',
    ownerId: 3,
    notes: null,
    history: [{ from: 'Contract Sent', to: 'Contract Signed', offsetMs: days(7) + 1 }],
  },
  {
    // Floors to 7 days but is more than 7 days - the case a days-based rule
    // gets wrong.
    id: 11,
    name: 'Company K',
    region: 'Can Tho',
    ownerId: 2,
    notes: null,
    history: [
      {
        from: 'Contract Signed',
        to: 'KYC Docs Received',
        offsetMs: days(7) + 23 * HOUR_MS + 59 * MINUTE_MS + 59_999,
      },
    ],
  },
  {
    // A hair under seven days - floors to 6 days and is not stuck.
    id: 12,
    name: 'Company L',
    region: 'Hanoi',
    ownerId: 1,
    notes: null,
    history: [
      {
        from: 'Contract Sent',
        to: 'Contract Signed',
        offsetMs: days(6) + 23 * HOUR_MS + 59 * MINUTE_MS + 59_999,
      },
    ],
  },
];

/**
 * Insert the coordinators and the vendors.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {ReturnType<import('./queries.js').createStatements>} statements
 * @param {number} now epoch milliseconds to position the dataset against
 */
export function seed(db, statements, now) {
  const insertAll = db.transaction(() => {
    for (const coordinator of SEED_COORDINATORS) {
      const { hash, salt } = hashPassword(DEMO_PASSWORD);
      statements.insertCoordinator.run({
        id: coordinator.id,
        name: coordinator.name,
        email: coordinator.email,
        passwordHash: hash,
        passwordSalt: salt,
      });
    }

    for (const vendor of SEED_VENDORS) {
      const lastEntry = vendor.history.at(-1);
      const stageEnteredAt = lastEntry ? now - lastEntry.offsetMs : null;

      statements.insertVendor.run({
        id: vendor.id,
        name: vendor.name,
        region: vendor.region,
        stage: vendor.stage ?? (lastEntry ? lastEntry.to : 'Contract Sent'),
        stageEnteredAt,
        ownerId: vendor.ownerId,
        notes: vendor.notes,
        version: vendor.history.length + 1,
      });

      for (const entry of vendor.history) {
        statements.insertHistory.run({
          vendorId: vendor.id,
          changedBy: vendor.ownerId,
          previousStage: entry.from,
          newStage: entry.to,
          changedAt: now - entry.offsetMs,
          reason: entry.reason ?? null,
        });
      }
    }
  });

  insertAll();
}

/** Remove every row, so a reseed starts from a clean slate. */
export function clear(db, statements) {
  const clearAll = db.transaction(() => {
    statements.deleteVendors.run();
    statements.deleteVendorsOnly.run();
    statements.deleteCoordinators.run();
  });
  clearAll();
}
