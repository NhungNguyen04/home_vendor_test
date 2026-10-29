/**
 * The write path for a stage change, and the mapping from database rows to the
 * shape the API returns.
 *
 * Everything the application knows about "a vendor moved stage" lives in
 * changeStage, and it is the only place that writes a stage_history row.
 */
import { stageStateFor, isTerminal } from '../domain/stages.js';
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
 *   1. not found          - the vendor does not exist
 *   2. invalid stage      - the requested stage is not one of the five
 *   3. stale version      - the caller's view of the vendor is out of date
 *   4. unchanged          - the vendor is already in the requested stage
 *   5. invalid transition - the current stage does not allow this move
 *   6. reason required    - a backward move has to come with a reason
 *
 * The version check comes before the no-op check on purpose. It is an If-Match
 * precondition: the client says "act on *this* version". If that precondition
 * has failed, the caller's view is stale, and any answer derived from it may
 * mislead - including "you were already in this stage", which would be wrong if
 * another coordinator had just moved the vendor.
 *
 * The last two checks are derived from the vendor's current stage, so they sit
 * behind the version check for the same reason. And the reason check sits
 * behind the no-op check, so a submission that changes nothing never demands a
 * reason it has no use for.
 *
 * @returns {{ kind: 'ok'|'not_found'|'invalid_stage'|'stale'|'unchanged'|'invalid_transition'|'reason_required', vendor?: object, historyId?: number }}
 */
export function changeStage(
  db,
  statements,
  { vendorId, newStage, actorId, expectedVersion, reason, now },
) {
  return db.transaction(() => {
    const vendor = statements.getVendor.get(vendorId);
    if (!vendor) return { kind: 'not_found' };

    const to = stageStateFor(newStage);
    if (!to) return { kind: 'invalid_stage' };

    // The version check comes before the same-stage check on purpose. It is an
    // If-Match precondition: the client says "act on *this* version". If that
    // precondition has failed, the caller's view is stale, and any answer
    // derived from it may mislead - including "you were already in this stage",
    // which would be wrong if another coordinator had just moved the vendor.
    if (expectedVersion !== vendor.version) return { kind: 'stale', vendor };

    const from = stageStateFor(vendor.stage);

    // A submission of the stage the vendor is already in must not create a
    // misleading duplicate history entry, and must not bump the version - the
    // caller would then be holding a version it never saw.
    if (from.name === to.name) return { kind: 'unchanged', vendor };

    // The current stage decides whether the move is allowed, and what it costs.
    const move = from.judgeMove(to);

    if (!move.allowed) {
      return {
        kind: 'invalid_transition',
        vendor,
        from: from.name,
        to: to.name,
        allowed: from.allowedTargets,
      };
    }

    // Moving a vendor back is rework. The coordinator has to say why, and the
    // reason is recorded with the change.
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (move.requiresReason && trimmedReason === '') {
      return { kind: 'reason_required', vendor, from: from.name, to: to.name };
    }

    // The version is part of the WHERE clause, so a write built on a stale
    // view affects no rows instead of overwriting somebody else's change.
    const info = statements.updateVendorStage.run(newStage, now, vendorId, expectedVersion);
    if (info.changes === 0) return { kind: 'stale', vendor };

    const historyId = statements.insertHistory.run({
      vendorId,
      changedBy: actorId,
      previousStage: vendor.stage,
      newStage,
      reason: trimmedReason === '' ? null : trimmedReason,
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
          reason: vendor.last_reason ?? null,
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
    reason: entry.reason ?? null,
  };
}
