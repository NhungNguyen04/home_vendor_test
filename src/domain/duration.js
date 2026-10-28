/**
 * Pure duration and stuckness rules. No I/O, no clock reads — every function
 * takes the instant to measure against.
 */
import { isTerminal } from './stages.js';

export const DAY_MS = 86_400_000;

/**
 * How long a vendor has been in its current stage.
 *
 * The result distinguishes three cases, because "we do not know" and "we know
 * it is fine" are different facts and collapsing them would silently mark a
 * vendor with a missing date as healthy forever.
 *
 * @param {number | null} stageEnteredAt epoch milliseconds, or null when unknown
 * @param {number} now epoch milliseconds
 * @returns {{ known: boolean, reason: 'missing' | 'future' | null, durationMs: number | null, daysInStage: number | null }}
 */
export function computeDuration(stageEnteredAt, now) {
  if (stageEnteredAt == null) {
    return { known: false, reason: 'missing', durationMs: null, daysInStage: null };
  }

  const durationMs = now - stageEnteredAt;

  // A stage-entry timestamp in the future is not a valid measurement - it is
  // clock skew or bad data, so it is reported as unknown rather than as zero.
  if (durationMs < 0) {
    return { known: false, reason: 'future', durationMs: null, daysInStage: null };
  }

  return {
    known: true,
    reason: null,
    durationMs,
    // Floored for display only. The stuck rule below uses durationMs.
    daysInStage: Math.floor(durationMs / DAY_MS),
  };
}

/**
 * Is a vendor stuck?
 *
 * Strictly greater than the threshold: the brief says "remained in the current
 * stage for *more than* a defined number of days", so a vendor sitting at
 * exactly seven days is not yet stuck.
 *
 * @param {number | null} durationMs elapsed milliseconds, or null when unknown
 * @param {number} thresholdDays the configured threshold
 * @returns {boolean | null} null when the duration is unknown
 */
export function isStuck(durationMs, thresholdDays) {
  if (durationMs == null) return null;
  return durationMs > thresholdDays * DAY_MS;
}

/**
 * Should this vendor be flagged as stuck?
 *
 * This wraps the threshold rule with one business judgment: a vendor in the
 * terminal stage has finished onboarding, so waiting there is the intended
 * outcome rather than a stall. The threshold rule itself stays pure and is
 * applied to every stage; the exemption lives here, in one place, and is
 * documented as an assumption in main-design.md.
 *
 * @param {string} stage the vendor's current stage
 * @param {number | null} durationMs elapsed milliseconds, or null when unknown
 * @param {number} thresholdDays the configured threshold
 * @returns {boolean | null} null when the duration is unknown
 */
export function isVendorStuck(stage, durationMs, thresholdDays) {
  if (durationMs == null) return null;
  if (isTerminal(stage)) return false;
  return isStuck(durationMs, thresholdDays);
}

/** Human-readable duration, e.g. "7d 4h". */
export function formatDuration(durationMs) {
  if (durationMs == null) return 'Unknown';
  if (durationMs < 0) return 'Invalid date';
  const days = Math.floor(durationMs / DAY_MS);
  const hours = Math.floor((durationMs % DAY_MS) / 3_600_000);
  return `${days}d ${hours}h`;
}

/**
 * The label for a vendor whose duration could not be measured.
 * @param {'missing' | 'future' | null} reason
 */
export function formatUnknownDuration(reason) {
  return reason === 'future' ? 'Invalid date' : 'Unknown';
}
