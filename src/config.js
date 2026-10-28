import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Configuration is read once at startup. Every value has a working default so a
 * fresh clone runs with `npm start` and no setup.
 */

// The demo clock. The assignment explicitly allows hardcoding the current date
// and time; freezing it is what keeps the "exactly at the threshold" vendor
// sitting exactly at the threshold instead of drifting into "stuck" a second
// after the seed runs. Set VENDOR_TRACKER_NOW=live for the real clock.
const DEFAULT_FROZEN_NOW = '2026-08-10T00:00:00.000Z';

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export const config = {
  port: intFromEnv('PORT', 3000),

  dbPath: process.env.DB_PATH || path.join(projectRoot, 'data', 'tracker.db'),

  publicDir: path.join(projectRoot, 'public'),

  // Days in a stage after which a vendor is considered stuck.
  stuckThresholdDays: intFromEnv('STUCK_THRESHOLD_DAYS', 7),

  // The instant the clock is pinned to, or 'live' for the wall clock.
  frozenNow: process.env.VENDOR_TRACKER_NOW ?? DEFAULT_FROZEN_NOW,

  // Sessions are dropped after this long without activity.
  sessionTtlMs: intFromEnv('SESSION_TTL_MS', 8 * 60 * 60 * 1000),
};
