/**
 * The write path for a stage change, and the mapping from database rows to the
 * shape the API returns.
 *
 * Everything the application knows about "a vendor moved stage" lives in
 * changeStage, and it is the only place that writes a stage_history row.
 */
import { isValidStage, isTerminal } from '../domain/stages.js';
import {
  computeDuration,
  isVendorStuck,
  formatDuration,
  formatUnknownDuration,
} from '../domain/duration.js';
import { toIso } from '../clock.js';

/**
 * Move a vendor to a new stage, recording the change.
 *
 * The vendor update and the history insert are committed in one transaction,
 * so the current status and its audit trail can never disagree.
 *
 * The preconditions are evaluated in a deliberate order:
 *
 *   1. not found        - the vendor does not exist
 *   2. invalid stage    - the requested stage is not one of the five
 *   3. stale version    - the caller's view of the vendor is out of date
 *   4. no-op            - the vendor is already in the requested stage
 *
 * The version check comes before the no-op check on purpose. It is an If-Match
 * precondition: the client says "act on *this* version". If that precondition
 * has failed, the caller's view is stale, and any answer derived from it may
 * mislead - including "you were already in this stage", which would be wrong if
 * another coordinator had just moved the vendor.
 *
 * @returns {{ kind: 'ok'|'not_found'|'invalid_stage'|'stale'|'unchanged', vendor?: object, historyId?: number }}
 */
export function changeStage(db, statements, { vendorId, newStage, actorId, expectedVersion, now }) {
  return db.transaction(() => {
    const vendor = statements.getVendor.get(vendorId);
    if (!vendor) return { kind: 'not_found' };

    if (!isValidStage(newStage)) return { kind: 'invalid_stage' };

    if (expectedVersion !== vendor.version) return { kind: 'stale', vendor };

    // A submission of the stage the vendor is already in must not create a
    // misleading duplicate history entry, and must not bump the version - the
    // caller would then be holding a version it never saw.
    if (vendor.stage === newStage) return { kind: 'unchanged', vendor };

    // The version is part of the WHERE clause, so a write built on a stale
    // view affects no rows instead of overwriting somebody else's change.
    const info = statements.updateVendorStage.run(newStage, now, vendorId, expectedVersion);
    if (info.changes === 0) return { kind: 'stale', vendor };

    const historyId = statements.insertHistory.run({
      vendorId,
      changedBy: actorId,
      previousStage: vendor.stage,
      newStage,
      changedAt: now,
    }).lastInsertRowid;

    return { kind: 'ok', vendor: statements.getVendor.get(vendorId), historyId };
  })();
}

/**
 * Map a vendor row to the object the API returns.
 *
 * The duration and stuckness computation exists here and nowhere else, so it
 * is covered by the domain tests and behaves identically everywhere.
 */
export function toVendorDto(vendor, { now, thresholdDays }) {
  const { known, reason, durationMs, daysInStage } = computeDuration(
    vendor.stage_entered_at,
    now,
  );

  return {
    id: vendor.id,
    name: vendor.name,
    region: vendor.region,
    stage: vendor.stage,
    stageEnteredAt: toIso(vendor.stage_entered_at),
    stageEnteredAtKnown: known,
    daysInStage,
    durationMs,
    durationLabel: known ? formatDuration(durationMs) : formatUnknownDuration(reason),
    isStuck: isVendorStuck(vendor.stage, durationMs, thresholdDays),
    isTerminal: isTerminal(vendor.stage),
    owner: vendor.owner_id
      ? { id: vendor.owner_id, name: vendor.owner_name }
      : null,
    notes: vendor.notes,
    version: vendor.version,
    lastChange: vendor.last_changed_at
      ? {
          previousStage: vendor.last_previous_stage,
          newStage: vendor.last_new_stage,
          changedBy: { id: vendor.last_changed_by, name: vendor.last_changed_by_name },
          changedAt: toIso(vendor.last_changed_at),
        }
      : null,
  };
}

/** Map a stage_history row to the object the API returns. */
export function toHistoryDto(entry) {
  return {
    id: entry.id,
    vendorId: entry.vendor_id,
    previousStage: entry.previous_stage,
    newStage: entry.new_stage,
    changedBy: { id: entry.changed_by, name: entry.changed_by_name },
    changedAt: toIso(entry.changed_at),
  };
}
