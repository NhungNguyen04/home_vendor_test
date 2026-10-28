/**
 * The only place in the codebase that reads the wall clock.
 *
 * Everything time-dependent takes `now` as an argument, so tests can pass an
 * exact instant and the seed can be positioned relative to the same clock the
 * application uses.
 */
import { config } from './config.js';

/**
 * Build a clock.
 * @param {{ frozenNow?: string | null }} options - 'live' or an ISO-8601 instant.
 */
export function createClock({ frozenNow } = {}) {
  const frozen =
    frozenNow === 'live' || frozenNow === undefined || frozenNow === null
      ? null
      : Date.parse(frozenNow);

  return {
    /** @returns {number} epoch milliseconds */
    now() {
      return frozen ?? Date.now();
    },
    /** @returns {boolean} true when the clock is pinned to a fixed instant */
    isFrozen() {
      return frozen !== null && !Number.isNaN(frozen);
    },
    /** The pinned instant as an ISO string, or null when live. */
    frozenAt() {
      return frozen === null ? null : new Date(frozen).toISOString();
    },
  };
}

export const clock = createClock({ frozenNow: config.frozenNow });

/** Epoch milliseconds -> ISO-8601 UTC string. */
export function toIso(epochMs) {
  return epochMs == null ? null : new Date(epochMs).toISOString();
}

/** ISO-8601 string -> epoch milliseconds, or null when unparseable. */
export function fromIso(iso) {
  if (iso == null) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}
