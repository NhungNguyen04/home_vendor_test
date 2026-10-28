/**
 * The duration and stuckness rules.
 *
 * These are the rules the whole feature rests on, so they are tested without a
 * database: if the arithmetic is right here, it is right everywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  computeDuration,
  isStuck,
  isVendorStuck,
  formatDuration,
  formatUnknownDuration,
} from '../src/domain/duration.js';

const NOW = Date.UTC(2026, 7, 10);
const THRESHOLD = 7;

test('a known stage-entry time produces the elapsed time', () => {
  const result = computeDuration(NOW - 3 * DAY_MS, NOW);

  assert.equal(result.known, true);
  assert.equal(result.reason, null);
  assert.equal(result.durationMs, 3 * DAY_MS);
  assert.equal(result.daysInStage, 3);
});

test('a missing stage-entry time is unknown, not zero', () => {
  const result = computeDuration(null, NOW);

  assert.equal(result.known, false);
  assert.equal(result.reason, 'missing');
  assert.equal(result.durationMs, null);
  assert.equal(result.daysInStage, null);
});

test('a stage-entry time in the future is a data problem, not a negative duration', () => {
  const result = computeDuration(NOW + DAY_MS, NOW);

  assert.equal(result.known, false);
  assert.equal(result.reason, 'future');
  assert.equal(result.durationMs, null);
});

test('exactly at the threshold is not stuck', () => {
  // The brief says "more than" the threshold, so the comparison is strict.
  assert.equal(isStuck(THRESHOLD * DAY_MS, THRESHOLD), false);
});

test('one millisecond past the threshold is stuck', () => {
  assert.equal(isStuck(THRESHOLD * DAY_MS + 1, THRESHOLD), true);
});

test('one millisecond short of the threshold is not stuck', () => {
  assert.equal(isStuck(THRESHOLD * DAY_MS - 1, THRESHOLD), false);
});

test('the floored day count does not decide stuckness', () => {
  // 7d 23h 59m 59.999s floors to 7 days. A rule that compared the floored
  // day count would call this "7 days" and not stuck; the real elapsed time is
  // more than seven days, so it is stuck.
  const durationMs = 7 * DAY_MS + 23 * 3_600_000 + 59 * 60_000 + 59_999;
  const result = computeDuration(NOW - durationMs, NOW);

  assert.equal(result.daysInStage, 7);
  assert.equal(isStuck(durationMs, THRESHOLD), true);
});

test('an unknown duration is neither stuck nor not stuck', () => {
  assert.equal(isStuck(null, THRESHOLD), null);
});

test('a terminal-stage vendor is not flagged even after a long wait', () => {
  // A vendor that reached "Active" has finished onboarding, so sitting there
  // for 90 days is the intended outcome, not a stall.
  assert.equal(isVendorStuck('Active', 90 * DAY_MS, THRESHOLD), false);
  assert.equal(isVendorStuck('Contract Sent', 90 * DAY_MS, THRESHOLD), true);
});

test('a terminal-stage vendor with an unknown duration is still unknown', () => {
  assert.equal(isVendorStuck('Active', null, THRESHOLD), null);
});

test('formatDuration renders days and hours', () => {
  assert.equal(formatDuration(7 * DAY_MS + 4 * 3_600_000), '7d 4h');
  assert.equal(formatDuration(0), '0d 0h');
});

test('formatDuration never renders a negative duration', () => {
  assert.equal(formatDuration(-1), 'Invalid date');
});

test('formatDuration renders an unknown duration as Unknown', () => {
  assert.equal(formatDuration(null), 'Unknown');
});

test('formatUnknownDuration distinguishes a missing date from a future one', () => {
  assert.equal(formatUnknownDuration('missing'), 'Unknown');
  assert.equal(formatUnknownDuration('future'), 'Invalid date');
});
