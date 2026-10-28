---
id: sprint-1_feature-vendor-onboarding-tracker-plan
title: "Vendor Onboarding Tracker — Implementation Plan"
branch: "feature/vendor-onboarding-tracker"
---

> **Design source:** [./feature-vendor-onboarding-tracker-design.md](feature-vendor-onboarding-tracker-design.md)
> **Do not duplicate file paths/actions here. Track deliverables & status only.**

## Status Legend

- **[Completed]** ✅
- **[In Progress]** ⏳
- **[Blocked]** ⛔
- **[Not Started]** ⬜

## Time box and cut line

The assignment is time-boxed to **3 hours**. The build order below is sequenced so that
each checkpoint leaves something submittable behind it, and the cut line is explicit so
that falling behind is a decision rather than a panic.

**Cut line — drop in this order if the clock wins:**

1. Styling polish → plain, legible CSS only.
2. The "last change" column in the board table (the history panel still shows it).
3. The migration-free `PRAGMA user_version` guard → plain `CREATE TABLE IF NOT EXISTS`.
4. The "stuck first" default sort (keep the filter toggle).
5. The service-level rollback test (keep every HTTP-level test).
6. The frozen-clock badge in the UI — but then disclose it in the README instead.
7. **If the API tests are not green by the end of step 7, cut the UI down to a single
   table with an inline stage selector per row and no dialog.** The history requirement
   is still met by an expandable row. Never cut tests to buy UI time.

**Never cut:** the domain layer and its tests, the single write transaction, the version
check, the no-op behaviour, the unknown-duration handling, `PRAGMA foreign_keys = ON`,
or the strict `>` boundary.

# Plan & Steps (authoritative checklist)

## 1. Scaffold and de-risk the environment

**Status:** **[Not Started]** ⬜
**Dependencies:** None
**Description:** Create the project skeleton, install the three dependencies, and prove
that SQLite can actually be written on the target filesystem before any application
code exists. The working directory sits on a 9p/DrvFs mount where SQLite is roughly 65×
slower than on local disk and may behave differently from a native filesystem, so this
is measured rather than assumed. The install is started first, in the background, because
a native module build is the one step that can eat the budget silently.

**Deliverables:**

- [Not Started] `package.json` created with ESM mode, the `start` / `test` / `seed` scripts, and the pinned dependency set
- [Not Started] Dependencies installed successfully (`express`, `better-sqlite3`, `supertest`)
- [Not Started] A 30-second SQLite smoke test on the working directory passes — create, insert, select, reopen
- [Not Started] Source and test folder skeleton created and `.gitignore` in place
- [Not Started] Decision recorded: if the smoke test fails or is unacceptably slow, `DB_PATH` is pointed at a local ext4 path

**Estimated Effort:** ≈ 15 min

## 2. Pure domain core — stages, duration, threshold, clock

**Status:** **[Not Started]** ⬜
**Dependencies:** Step 1
**Description:** Build the layer with no dependencies and no I/O. It holds the subtlest
logic in the system — the exact threshold comparison, the tri-state unknown, and the
duration formatting — and building it first means the hardest part is finished,
verified, and isolated within the first thirty minutes. The clock is defined here as the
single point in the codebase that reads the wall clock, so every other module can be
given an exact instant.

**Deliverables:**

- [Not Started] The five stages defined in workflow order, with validation and a terminal-stage predicate
- [Not Started] Duration computed from an exact millisecond difference, with a null stage-entry time represented as unknown rather than as zero
- [Not Started] The stuck rule implemented as an exact integer comparison against the threshold, with floored days kept for display only
- [Not Started] Duration formatting for the known, unknown, and invalid-future cases
- [Not Started] A single clock module that reads the wall clock, honours the frozen-clock override, and converts between epoch milliseconds and ISO-8601
- [Not Started] Configuration read once from the environment with working defaults

**Estimated Effort:** ≈ 20 min

## 3. Data layer — schema, connection, seed data

**Status:** **[Not Started]** ⬜
**Dependencies:** Step 2
**Description:** Define the schema with its constraints — the stage `CHECK`, the
history `CHECK` that makes a duplicate entry impossible, nullable `previous_stage` for
imported rows, the nullable `stage_entered_at`, and the version column. Turn foreign-key
enforcement on explicitly, because SQLite leaves it off by default and a schema that
looks correct while enforcing nothing is worse than no schema at all. Then build the
seed: eleven vendors and three coordinators, positioned relative to the injected clock
so that the dataset is identical on every machine, in every timezone, and at any hour.

**Deliverables:**

- [Not Started] Schema defined with the stage and no-op constraints and the indexes
- [Not Started] Connection helper that enables foreign-key enforcement and applies the schema idempotently
- [Not Started] Prepared statements created once per connection
- [Not Started] Seed covering all five stages, three coordinators, and every named edge case — including a vendor at exactly the threshold, one a millisecond over it, one that floors to the threshold but exceeds it, one below it, and one with no stage-entry time
- [Not Started] Seed history written so the history panel is never empty, including an imported row with no prior stage
- [Not Started] Seeding is idempotent and derives its timestamps from the injected clock

**Estimated Effort:** ≈ 25 min

## 4. Service layer — the atomic stage change and session lifecycle

**Status:** **[Not Started]** ⬜
**Dependencies:** Step 3
**Description:** Implement the write path, which is the heart of the design. The stage
update and the history insert happen inside one transaction, and the version check runs
as a precondition before anything else — so a coordinator working from a stale screen is
told the current stage rather than being told they were already there. The precondition
order is deliberate and is explained in the design document. The same layer maps raw
rows to the wire format, so the duration and stuckness computation exists in exactly one
place.

**Deliverables:**

- [Not Started] Stage change evaluated in order — not found, invalid stage, version conflict, no-op, then write
- [Not Started] The vendor update and the history insert committed in one transaction, with the version-guarded update as the authoritative check
- [Not Started] A no-op submission returning "unchanged" without writing history, without bumping the version, and without touching the stage-entry timestamp
- [Not Started] A version conflict returning the current stage and version without writing anything
- [Not Started] A single mapper producing the wire shape, including the tri-state stuckness and the last-change summary
- [Not Started] Session lifecycle — password verification against a salted hash, session creation, lookup, expiry, and destruction

**Estimated Effort:** ≈ 25 min

## 5. HTTP layer — routes, authentication gate, error envelope

**Status:** **[Not Started]** ⬜
**Dependencies:** Step 4
**Description:** Expose the service layer over HTTP. Every route except login passes
through a single authentication gate, and the acting coordinator is taken from the
session rather than from the request body. All failures leave through one error handler
so that the client always receives the same JSON shape. The SPA fallback is registered
so that it cannot swallow an unknown API route.

**Deliverables:**

- [Not Started] Login, logout, and current-user endpoints
- [Not Started] The vendor list, single vendor, and vendor history endpoints
- [Not Started] The stage update endpoint returning the vendor, the changed flag, and the new history entry
- [Not Started] Authentication middleware applied once to the API surface, with the session cookie attached as `HttpOnly` and `SameSite=Lax`
- [Not Started] A single error envelope with distinct codes for invalid requests, invalid credentials, unauthenticated access, not found, and version conflicts
- [Not Started] Malformed request bodies rejected as a client error rather than a server error
- [Not Started] The SPA fallback restricted so that unknown API routes still return a JSON not-found

**Estimated Effort:** ≈ 25 min

## 6. Test suite — domain rules and data integrity

**Status:** **[Not Started]** ⬜
**Dependencies:** Steps 2, 3
**Description:** Test the parts that are pure, and the parts that guard the data. The
threshold boundary is tested from all three sides — exactly at the threshold, a
millisecond under, and a millisecond over — because that is the single most likely
place for an off-by-one to hide. The schema tests prove the database constraints are
actually enforced, which doubles as proof that foreign keys are on. The invariant tests
assert the whole seeded dataset at once, which is far better value than one test per
row.

**Deliverables:**

- [Not Started] Duration and threshold tests covering the boundary from below, at, and above, plus the floored-days trap
- [Not Started] Tests for the unknown-duration and invalid-future-timestamp cases
- [Not Started] Stage validation tests across all five stages and a rejected value
- [Not Started] Schema tests proving the stage constraint, the no-op constraint, and foreign-key enforcement are live
- [Not Started] Invariant tests over the whole dataset: the stage-entry timestamp matches the newest matching history entry, the newest history entry matches the current stage, the version matches the history count, every stage is valid, and no history row is a no-op
- [Not Started] Seed tests proving the dataset's shape, its idempotence, and its boundary coverage

**Estimated Effort:** ≈ 30 min

## 7. Test suite — API behaviour, concurrency, and atomicity

**Status:** **[Not Started]** ⬜
**Dependencies:** Steps 5, 6
**Description:** Test the wiring end to end against a real database and the real
middleware. This is where the business rules become sentences a reviewer can read and
believe: the stage change records the actor, the timestamp, and both stages; the
no-op records nothing; the stale write is rejected and leaves the history untouched.
The rollback guarantee is proved at the service level, where an invalid actor can be
injected to force the transaction to fail mid-flight — something the HTTP path cannot
produce, because the actor always comes from a valid session.

**Deliverables:**

- [Not Started] Authentication tests covering the unauthenticated gate, invalid credentials, unknown accounts, the absence of user enumeration, session independence between coordinators, and logout invalidating the session
- [Not Started] Read-path tests covering the response shape, the tri-state stuckness at the wire level, empty history, and unknown and malformed vendor identifiers
- [Not Started] Stage-change tests covering the happy path, the recorded actor and both stages, the reset stage-entry timestamp, the version increment, the no-op, an invalid stage, a missing or malformed expected version, an unknown vendor, and an unauthenticated attempt
- [Not Started] A two-coordinator test in which the second write is rejected, exactly one history row is added, and the final stage and the history agree
- [Not Started] A service-level rollback test proving that a failed transaction leaves both the vendor and the history table untouched
- [Not Started] A test proving the read path never mutates a vendor — the structural expression of the failed-KYC rule

**Estimated Effort:** ≈ 35 min

## 8. SPA — login and the vendor board

**Status:** **[Not Started]** ⬜
**Dependencies:** Step 5
**Description:** Build the two screens in a single page with no framework and no build
step. The login view lists the seeded coordinators; the board shows every vendor with
its stage, region, owner, time in stage, and status. A vendor with no stage-entry time
gets a distinct badge rather than a fabricated number, and the threshold and the current
time are displayed so the rule is never a hidden rule.

**Deliverables:**

- [Not Started] Login screen listing the seeded coordinators, with the demo credentials visible so a reviewer can get in
- [Not Started] Session persistence across a page refresh, and a graceful return to login on an expired session
- [Not Started] Board table showing vendor, region, stage, owner, time in stage, and status
- [Not Started] Distinct visual states for stuck, healthy, and unknown-duration vendors
- [Not Started] Search, a stage filter, and a stuck-only filter, with a count summary above the table
- [Not Started] The threshold and the current time displayed in the header, with a badge whenever the clock is frozen

**Estimated Effort:** ≈ 30 min

## 9. SPA — stage changes, history, and conflict handling

**Status:** **[Not Started]** ⬜
**Dependencies:** Step 8
**Description:** Complete the interaction model. Changing a stage posts the version the
coordinator was looking at, so the server can reject a stale write. A rejection is
surfaced as a readable message naming the current stage, and the board refreshes that
row — the history is never rewritten to force a match. The history panel gives each
vendor's full change log, and the failed-KYC hint appears where it is relevant.

**Deliverables:**

- [Not Started] A stage change from the board, carrying the version the coordinator was looking at
- [Not Started] A readable conflict banner naming the current stage and the coordinator who made the change, with the affected row refreshed
- [Not Started] An expanded history panel per vendor showing previous stage, new stage, the coordinator, and the timestamp, newest first
- [Not Started] A visible "already in this stage, nothing recorded" outcome for a no-op submission
- [Not Started] The failed-KYC hint shown on rows awaiting document re-upload
- [Not Started] The board refreshed from the server after a change, with time in stage reset to zero

**Estimated Effort:** ≈ 30 min

## 10. Testing & Validation (Mandatory)

**Status:** **[Not Started]** ⬜
**Dependencies:** Steps 1 - 9
**Description:** Perform manual tests; capture evidence (links).

Automated coverage proves the rules; the walkthrough proves the application is usable
by a person. Both are needed, and the evidence is captured as screenshots and a
short transcript of the two-coordinator conflict, which is the hardest scenario to
demonstrate and the easiest to get wrong.

**Deliverables:**

- [Not Started] Full automated suite passes from a clean checkout with a single command
- [Not Started] Performed manual tests
- [Not Started] Evidence attached (side-by-side links/screenshots) of the login screen, the board with stuck vendors highlighted, the stage change and the resulting history entry, the unknown-duration vendor, the vendor sitting exactly at the threshold and correctly *not* flagged, and the two-coordinator conflict banner
- [Not Started] The frozen-clock demo run, showing a stable stuck set that matches the documented dataset
- [Not Started] A final pass for dead code, stale comments, and an accurate README

**Estimated Effort:** ≈ 25 min
