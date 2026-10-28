---
id: sprint-1_feature-vendor-onboarding-tracker-design
title: "Vendor Onboarding Tracker — Design"
branch: "feature/vendor-onboarding-tracker"
---

> **Note:** This document defines the *why/what* and the canonical file changes.
> Status, schedules, and testing live in the implementation plan.
> Implementation plan: [./feature-vendor-onboarding-tracker-plan.md](feature-vendor-onboarding-tracker-plan.md)

---

## 1) Overview

### Context

The Operations team onboards new vendors before they may operate in a region. Today the
process runs on a shared spreadsheet (`Home Assignment_ Vendor Onboarding Tracker.pdf`).
A vendor moves through five stages — **Contract Sent → Contract Signed → KYC Docs
Received → KYC Verified → Active** — and three coordinators (Linh, Huy, Mai) edit the
sheet during the day.

The spreadsheet fails in three specific ways, and each one maps to a requirement:

1. **Stuck vendors go unnoticed.** Nothing surfaces a vendor that has sat in one stage
   for weeks. The spreadsheet has a hand-maintained "Last Updated" date, which is
   updated *if someone remembers*, and the two problems compound: a stale row and a
   vendor nobody is chasing look identical.
2. **Poor auditability.** When a cell looks wrong there is no way to tell who changed
   it, when, or from what. The sheet is edited in place, so the previous state is gone.
3. **Manual status maintenance.** Every stage change requires a human to also type a
   date. That is busywork, and it is exactly the busywork that gets skipped.

This design replaces the spreadsheet with a small web application that makes the
status **derived** rather than maintained, and the history **recorded** rather than
remembered.

### Goals

- A coordinator logs in, and the application always knows who is acting (BR-01).
- A coordinator sees every vendor's current stage, how long it has been there, and
  whether it is stuck — with no manually entered dates anywhere (BR-04, BR-05).
- A coordinator moves a vendor to another stage, and the application *automatically*
  records who, when, the previous stage and the new stage (BR-02, BR-03).
- A coordinator can read the full change history for any vendor.
- The vendor's current stage and its audit trail can never disagree — they are written
  together, atomically (BR-06).
- The whole thing is understandable, runnable, and explainable inside a 3-hour build.

### Non-Goals

Explicitly out of scope, per the assignment:

- Vendor creation and deletion.
- User registration, password reset, and user administration.
- Production-grade authentication, SSO, or session persistence across restarts.
- Email integration, notifications, and reminders.
- The Compliance review system and the vendor activation system — this app *tracks*
  the workflow, it does not perform the review or the activation.
- Real-time updates (polling or WebSockets).
- Production deployment infrastructure, CI/CD, and containerisation.
- Visual polish. The brief is explicit that visual design is not the focus.

---

## 2) Requirements & Constraints

### Functional

| ID | Requirement | Where it is satisfied |
| --- | --- | --- |
| FR-01 | Coordinator login; the app identifies the acting coordinator | `POST /api/login`, session cookie, `requireAuth` middleware |
| FR-02 | View a list of vendors with enough status information | `GET /api/vendors`; board table in the SPA |
| FR-03 | Update a vendor's stage, recording actor/time/previous/new; view history | `PATCH /api/vendors/:id/stage`, `GET /api/vendors/:id/history` |
| FR-04 | Highlight vendors exceeding a time-in-stage threshold, computed automatically | `computeDuration()` in the domain layer, `isStuck` flag in the API |
| BR-01 | Only authenticated coordinators may use the tracker | `requireAuth` on every `/api` route |
| BR-02 | A stage update records the acting coordinator and the timestamp automatically | `stage_history.changed_by` / `changed_at`, written by the server |
| BR-03 | History preserves both the old and the new stage | `previous_stage` / `new_stage` columns |
| BR-04 | Duration is computed from `stage_entered_at`, never a manually maintained date | `stage_entered_at` is write-only-by-the-server; there is no "Last Updated" column |
| BR-05 | A vendor is stuck when time in the current stage exceeds the threshold | `durationMs > thresholdMs`, strict `>` |
| BR-06 | `stage_entered_at` resets to the time of the change | Set inside the same transaction as the stage update |
| BR-07 | A failed KYC verification does not advance the vendor | No automatic transition exists anywhere in the code — see §3 |

### Non-Functional (Perf/SLA/Cost)

- **Correctness over features.** Status and history consistency is the central claim of
  the design and is enforced by a single transaction plus database constraints, not by
  convention.
- **Determinism.** The same seed and the same injected clock produce the same output on
  every machine, so the demo (and the tests) are reproducible.
- **Read latency.** A board of ~11 vendors is a single indexed query plus an in-process
  computation. No pagination, no server-side filtering, no caching — none is needed at
  this scale, and each would cost build time.
- **Write latency.** One stage change is two statements inside one transaction
  (~35 ms on the 9p-mounted working directory, see §8).
- **Cost.** Two runtime dependencies (`express`, `better-sqlite3`) and one dev dependency
  (`supertest`). No database server, no container, no cloud account, no paid service.
- **Boot.** `npm install && npm start` on a fresh clone, with the database created and
  seeded automatically.

### Constraints / Assumptions

1. **Timestamps are stored as integer epoch milliseconds.** The business rule is a
   duration comparison, so integer arithmetic keeps the threshold exact — no float
   rounding, no timezone parsing, and a "day" is exactly 86,400,000 ms. The API still
   exposes ISO-8601 UTC strings for humans.
2. **The stuck threshold defaults to 7 days** and is configurable via
   `STUCK_THRESHOLD_DAYS`. It is a config value, not a UI setting — the brief asks for
   *a* defined threshold, not a per-user preference.
3. **The threshold comparison is strict `>`.** The brief says "remained in the current
   stage for *more than* a defined number of days", so a vendor at exactly 7 days is
   **not** stuck. This is pinned by a test at exactly 7 days, 7 days − 1 ms, and 7 days
   + 1 ms.
4. **The clock is frozen by default.** `VENDOR_TRACKER_NOW` defaults to a fixed instant;
   `VENDOR_TRACKER_NOW=live` uses the real clock. The brief explicitly permits
   hardcoding the current date/time. This is not a convenience — it is required for the
   boundary case to be demonstrable: a vendor seeded at exactly 7 days would drift into
   "stuck" within a second under a live clock. The UI displays a badge when the clock is
   frozen, so the demo is disclosed rather than misleading.
5. **Stage transitions are not constrained to be sequential.** The brief requires
   coordinators to move vendors and does not require enforcing order, so any stage may
   move to any other. This is documented as an assumption, and the constraint is enforced
   only where it matters: there is no automatic transition, so BR-07 holds structurally.
6. **`stage_entered_at` may be null.** The brief asks for the missing-timestamp case to
   be handled explicitly. A null means *unknown*, and is represented and displayed as
   unknown — never as zero, never as today.
7. **The spreadsheet's "Last Updated" column is deliberately not imported.** "Last
   Updated" means "the row was edited", which includes note edits; BR-04 requires the
   duration to come from stage-entry time. Importing it would reintroduce the exact bug
   this project exists to remove. Instead, one seeded vendor represents an imported row
   with no stage-entry time, and the app shows it honestly.
8. **Authentication is mock, but not careless.** Seeded accounts with a documented demo
   password, `scrypt` hashing with a per-user salt (from `node:crypto`, no extra
   dependency), and a server-side session token in an `HttpOnly` cookie. Explicitly *not*
   a production identity system — stated plainly in the write-up.
9. **Sessions are in-memory.** A server restart logs everyone out. The SPA handles the
   resulting `401` by returning to the login screen. Acceptable for a mock; a persistent
   store is listed as the first next step.
10. **The working directory is on a 9p/DrvFs mount** (`/mnt/c/...`), where SQLite writes
    are roughly 65× slower than on a local ext4 filesystem (measured: 50 inserts in
    848 ms vs 13 ms). This is acceptable for the demo but is called out in §8 with a
    one-line escape hatch (`DB_PATH`).

---

## 3) Architecture & Components

### High-level flow

```
 Browser (SPA)
    │  fetch + JSON, session cookie
    ▼
 ┌──────────────────────────────────────────────┐
 │ HTTP layer  (express)                       │
 │  auth-middleware · routes · error envelope  │
 └───────────────┬──────────────────────────────┘
                 │  domain objects in, domain objects out
 ┌───────────────▼──────────────────────────────┐
 │ Service layer                                │
 │  stage-service · auth-service               │
 │  ← owns the single write transaction        │
 └───────────────┬──────────────────────────────┘
                 │  prepared statements
 ┌───────────────▼──────────────────────────────┐
 │ Domain layer (pure, no I/O)                 │
 │  stages · duration · threshold rules        │
 └───────────────┬──────────────────────────────┘
                 │
 ┌───────────────▼──────────────────────────────┐
 │ Data layer  (better-sqlite3)                │
 │  schema · queries · seed                    │
 └──────────────────────────────────────────────┘
```

**Dependency direction is strictly downward.** The domain layer imports nothing, so the
duration and threshold rules — the subtlest logic in the system — are testable without a
database and are obvious on review. The service layer owns the only write path, so
"stage changed" and "history written" are structurally one operation.

### Components

| Module | Responsibility | Key exports |
| --- | --- | --- |
| `src/config.js` | Reads env vars once at startup | `config` |
| `src/clock.js` | The **only** place that reads the wall clock; ISO ⇄ epoch conversion | `now()`, `toIso()`, `fromIso()` |
| `src/domain/stages.js` | The five stages as an ordered list; validation | `STAGES`, `isValidStage()`, `isTerminal()` |
| `src/domain/duration.js` | Pure duration + stuck computation | `computeDuration()`, `isStuck()`, `formatDuration()` |
| `src/db/schema.js` | DDL as an exported string | `SCHEMA` |
| `src/db/connection.js` | Opens the database, applies pragmas and schema | `openDb()` |
| `src/db/queries.js` | Prepares every statement once | `createStatements()` |
| `src/db/seed.js` | Deterministic demo dataset | `seed()`, `SEED_VENDORS` |
| `src/services/stage-service.js` | The atomic stage-change transaction + row→JSON mapping | `changeStage()`, `toVendorDto()` |
| `src/services/auth-service.js` | Password verification and session lifecycle | `login()`, `logout()`, `getSession()` |
| `src/http/errors.js` | The single error envelope | `AppError`, `errorHandler` |
| `src/http/auth-middleware.js` | BR-01 gate | `requireAuth` |
| `src/http/routes.js` | The REST surface | `router` |
| `src/server.js` | Composition root and listener | — |
| `public/` | The single-page UI | `index.html`, `app.js`, `styles.css` |

### How BR-07 (failed KYC verification) is structurally enforced

The app performs no compliance review, so "KYC verification failed" is expressed by the
*absence* of a stage change: the vendor remains at `KYC Docs Received` until the
documents are corrected and a coordinator moves it forward.

The guarantee comes from what the code does **not** contain:

- There is no automatic transition, no scheduled job, no time-based rule, and no
  background worker anywhere in the codebase. A vendor's stage changes only when a
  coordinator explicitly asks for it.
- The seeded vendor "Company B" sits at `KYC Docs Received` with the note *"Waiting on
  business license re-upload"*, 24 days in stage — a live demonstration of a failed KYC
  check that has correctly not advanced the vendor, and which the board flags as stuck.
- The UI shows a contextual hint on rows at `KYC Docs Received`: *"If KYC verification
  failed, leave the vendor in this stage and update the note."*
- A test asserts that reading the vendor list never mutates a vendor.

### Concurrency: optimistic locking

The spreadsheet failure mode is three people editing one sheet; the app failure mode is
two coordinators looking at one stale screen. Optimistic locking converts a silent lost
update into an explicit conflict:

```
PATCH /api/vendors/3/stage
{ "stage": "KYC Docs Received", "expectedVersion": 1 }

→ 200 { "changed": true,  "vendor": { …, "version": 2 } }
→ 409 { "error": { "code": "version_conflict",
                   "details": { "currentStage": "KYC Docs Received",
                                "currentVersion": 2 } } }
```

`vendors.version` increments on every accepted change. The client sends back the
version it was looking at. If the row has moved on, the write is rejected — the second
coordinator is told the current stage and must re-submit deliberately.

The `WHERE id = ? AND version = ?` clause on the `UPDATE` is what makes the check
authoritative rather than advisory. The pre-check on the read only produces a friendly
error message.

**Ordering of the preconditions matters.** The version check runs *before* the
same-stage check, following `If-Match` semantics (RFC 9110 §13.1.1): the client says
"act on *this* version". If the precondition has failed, the client's view is stale, and
any answer derived from it may mislead — including "you were already at this stage",
which would be a lie if another coordinator had just moved the vendor.

---

## 4) Data Model Changes

New database, new tables. SQLite file at `DB_PATH` (default `./data/tracker.db`).

```sql
PRAGMA foreign_keys = ON;          -- OFF by default in SQLite; must be set explicitly

CREATE TABLE coordinators (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,     -- scrypt: N$r$p$salt$hash
  password_salt TEXT    NOT NULL
);

CREATE TABLE vendors (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  region           TEXT    NOT NULL,
  stage            TEXT    NOT NULL
                   CHECK (stage IN ('Contract Sent','Contract Signed',
                                    'KYC Docs Received','KYC Verified','Active')),
  stage_entered_at INTEGER,            -- epoch ms; NULL = unknown entry time
  owner_id         INTEGER REFERENCES coordinators(id),   -- who is responsible
  notes            TEXT,
  version          INTEGER NOT NULL DEFAULT 1             -- optimistic-lock token
);

CREATE TABLE stage_history (
  id             INTEGER PRIMARY KEY,
  vendor_id      INTEGER NOT NULL REFERENCES vendors(id),
  changed_by     INTEGER NOT NULL REFERENCES coordinators(id),
  previous_stage TEXT,                 -- NULL only for an imported row's first entry
  new_stage      TEXT    NOT NULL
                 CHECK (new_stage IN ('Contract Sent','Contract Signed',
                                      'KYC Docs Received','KYC Verified','Active')),
  changed_at     INTEGER NOT NULL,
  CHECK (previous_stage IS NULL OR previous_stage <> new_stage)  -- no-op guard
);

CREATE INDEX idx_vendors_stage      ON vendors(stage);
CREATE INDEX idx_history_vendor     ON stage_history(vendor_id, changed_at DESC);
CREATE INDEX idx_history_changed_by ON stage_history(changed_by);
```

### Notes on the schema

- **`stage_entered_at` is nullable on purpose.** The brief requires the
  missing-timestamp case to be handled explicitly. `NULL` is stored and reported as
  unknown; the app never substitutes "today" or "0 days".
- **`previous_stage <> new_stage` is a database constraint**, not just application logic.
  A duplicate history row cannot exist even if a future code path tries to create one.
- **`previous_stage` is nullable** so a vendor imported from the spreadsheet can have a
  first history entry meaning "there was no prior stage". Every subsequent entry has a
  non-null `previous_stage`.
- **`owner_id` and `changed_by` are different facts.** `owner_id` is who is responsible
  for the vendor (static, from the spreadsheet). `changed_by` is who performed a
  transition (the audit trail, BR-02). Auto-updating the owner on a stage change would
  conflate responsibility with activity and destroy the audit trail.
- **`version`** starts at 1 and increments by 1 per accepted change. It is a token, not a
  counter of anything meaningful.
- **No migration framework.** One `CREATE TABLE IF NOT EXISTS` schema applied at boot.
  The database is disposable; "migration" is deleting the file and re-seeding.

### Seed data

Three coordinators (Linh, Huy, Mai) with the shared demo password documented in the
README and shown as a hint on the login screen. Twelve vendors covering all five stages
and every edge case the brief names. All offsets are relative to the injected clock, so
the dataset is identical on every machine and in every timezone.

| Vendor | Region | Stage | Offset from `now` | Demonstrates |
| --- | --- | --- | --- | --- |
| Company A | HCMC | Active | 90 days | healthy, terminal stage |
| Company B | Can Tho | KYC Docs Received | 24 days | **failed KYC** — stuck, with the re-upload note |
| Company C | Hanoi | Contract Signed | 3 days | healthy |
| Company D | HCMC | KYC Verified | 6 days | healthy, approaching the threshold |
| Company E | Da Nang | KYC Docs Received | 7 days **exactly** | the boundary — **not** stuck |
| Company F | HCMC | Contract Sent | 12 days | stuck |
| Company G | Hanoi | Active | 45 days | healthy |
| Company H | Hanoi | KYC Docs Received | **NULL** | unknown stage-entry time |
| Company I | Da Nang | Contract Signed | 8 days | stuck |
| Company J | Hanoi | Contract Signed | 7 days + 1 ms | just over the threshold — stuck |
| Company K | Can Tho | KYC Docs Received | 7 days 23 h 59 m 59.999 s | the trap: floors to 7 days but **is** stuck |
| Company L | Hanoi | Contract Signed | 6 days 23 h 59 m 59.999 s | floors to 6 days, not stuck |

Company E, J, K and L exist together on purpose: they pin the boundary from both sides
and prove that the rule is applied to the exact elapsed milliseconds rather than to a
floored day count.

Each seeded vendor except Company H gets one or two `stage_history` rows, so the history
panel is never empty for a vendor that has actually moved. Company F's single entry has a
null `previous_stage`, because it was imported straight into "Contract Sent" with no prior
stage. Company H has no history at all: it was imported with a blank date and no
transitions, which is exactly the case the unknown-duration badge exists for.

### Invariants the data must satisfy

These are asserted by tests rather than assumed. They are what make "status and history
never disagree" a checkable property instead of a promise.

| # | Invariant |
| --- | --- |
| I1 | For every vendor with a non-null `stage_entered_at` and at least one history row, `stage_entered_at` equals the `changed_at` of the newest history row whose `new_stage` equals the vendor's current stage |
| I2 | For every vendor with at least one history row, the newest history row's `new_stage` equals `vendors.stage` |
| I3 | For every vendor, `version = 1 + COUNT(history rows)` |
| I4 | Every `vendors.stage` is one of the five valid stages |
| I5 | Every history row has `previous_stage IS NULL OR previous_stage <> new_stage` |

---

## 5) APIs & Interfaces

All endpoints are JSON. Errors use one envelope everywhere:

```json
{ "error": { "code": "version_conflict", "message": "…", "details": { } } }
```

| Method & path | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /api/login` | no | `{ "email", "password" }` | `200 { coordinator }` + `Set-Cookie` | `400 invalid_request`, `401 invalid_credentials` |
| `POST /api/logout` | yes | — | `204` | `401` |
| `GET /api/me` | yes | — | `200 { coordinator }` | `401` |
| `GET /api/vendors` | yes | — | `200 { vendors[], stages[], stuckThresholdDays, asOf }` | `401` |
| `GET /api/vendors/:id` | yes | — | `200 { vendor }` | `401`, `404 not_found` |
| `GET /api/vendors/:id/history` | yes | — | `200 { vendorId, history[] }` | `401`, `404 not_found` |
| `PATCH /api/vendors/:id/stage` | yes | `{ "stage", "expectedVersion" }` | `200 { vendor, changed, historyEntry }` | `401`, `400 invalid_request`, `404 not_found`, `409 version_conflict` |

### Vendor resource

```json
{
  "id": 2,
  "name": "Company B",
  "region": "Can Tho",
  "stage": "KYC Docs Received",
  "stageEnteredAt": "2026-07-17T00:00:00.000Z",
  "stageEnteredAtKnown": true,
  "daysInStage": 24,
  "durationMs": 2073600000,
  "durationLabel": "24d 0h",
  "isStuck": true,
  "isTerminal": false,
  "owner": { "id": 2, "name": "Huy" },
  "notes": "Waiting on business license re-upload",
  "version": 1,
  "lastChange": {
    "previousStage": "Contract Signed",
    "newStage": "KYC Docs Received",
    "changedBy": { "id": 2, "name": "Huy" },
    "changedAt": "2026-07-17T00:00:00.000Z"
  }
}
```

### Three-valued stuckness

`isStuck` is `true`, `false`, or `null`, and the distinction is load-bearing:

- `false` is a **claim** — "we know it has been at or below the threshold".
- `null` means **unknown** — there is no stage-entry timestamp, so we do not know.

Collapsing them would mark a vendor with a missing date as healthy forever: a silent
wrong answer, which is precisely what the brief warns against. The same reasoning
applies to a timestamp in the future — it is not a valid measurement, so it is unknown
rather than zero.

### Days versus milliseconds

The API returns `daysInStage` **and** `durationMs` so the exact comparison is auditable
from the response alone. `daysInStage` is floored for display only.

This distinction is a trap worth stating explicitly: `floor(7 days 23 h) = 7`, and
`7 > 7` is false — so a rule written against floored days would report a vendor that has
been in the stage for **more than** seven days as *not* stuck. The rule is therefore
`durationMs > thresholdMs`, on exact integers. Company K in the seed data is exactly
that case.

### Stage-change semantics

| Situation | Behaviour |
| --- | --- |
| New stage differs from current | `200 { changed: true }`; vendor updated, history row written, `stage_entered_at` reset, `version` incremented — all in one transaction |
| New stage equals current | `200 { changed: false }`; **no** history row, **no** version bump, `stage_entered_at` untouched. A duplicate submission must not create a misleading history entry |
| `expectedVersion` stale | `409 version_conflict`; nothing is written; the body names the current stage and version |
| `expectedVersion` missing or non-integer | `400 invalid_request` with `details.field`; nothing is written |
| `stage` not one of the five | `400 invalid_request` with `details.field`; nothing is written |
| Vendor not found | `404 not_found` |
| Not authenticated | `401 unauthenticated`; nothing is written |

**On the no-op path, `version` is deliberately not incremented.** If it were, the client's
next update would fail with a spurious `409` against a version it never saw. This is
asserted by a test.

### Error codes

`invalid_request`, `invalid_credentials`, `unauthenticated`, `not_found`,
`version_conflict`, `internal_error`.

---

## 6) Security & Compliance

### Authentication (mock, but deliberate)

- **Seeded accounts only.** Three coordinators with a shared, documented demo password.
  Registration and account administration are out of scope.
- **Passwords are hashed, not stored.** `scrypt` from `node:crypto`, with a 16-byte
  random per-user salt and a timing-safe comparison. No plaintext in the database, and
  no bcrypt/argon2 dependency to install.
- **No user enumeration.** An unknown email and a wrong password return the *same*
  `401 invalid_credentials` response with the same message. The login response never
  contains `password_hash` or `password_salt`.
- **Sessions are server-side.** A 32-byte token from `crypto.randomBytes()` is stored in
  an in-memory map and delivered as a cookie with `HttpOnly` and `SameSite=Lax`.
  `HttpOnly` keeps the token away from JavaScript; `SameSite=Lax` prevents the cookie
  riding along on cross-site POSTs.
- **Sessions expire** after 8 hours of inactivity, and `POST /api/logout` destroys the
  session server-side. The token is not a self-contained signed cookie, so logout is
  genuinely effective.

### Authorization

- Every `/api` route except `POST /api/login` passes through `requireAuth`. There is one
  gate, applied once, in middleware — not a per-handler check that someone can forget.
- The acting coordinator's id comes from the **session**, never from the request body.
  A client cannot change who it is by editing a payload.
- There are no per-vendor or per-region permissions: every coordinator can move any
  vendor. That matches the spreadsheet, where all three coordinators edit all rows.

### Injection

- **Every** query is a prepared statement with bound parameters. No SQL is built by
  string concatenation anywhere, including the stage value, which is additionally
  constrained by a `CHECK` constraint at the database level.
- The five valid stage names are a `CHECK` constraint in the schema, so an invalid stage
  cannot be persisted even if a validation call is removed.

### Data handling

- **PII is minimal.** Coordinators have a name and an email. Vendors have a business
  name, a region, and a free-text note that may contain commercial context.
- **Notes are never logged.** Only coordinator ids, vendor ids, stage names, and
  timestamps appear in log lines.
- No secrets are committed. The demo password is public by design and documented as
  such; there are no API keys, tokens, or connection strings in the repository.

### Known limitations, stated plainly

| Limitation | Why it is acceptable here | What production would need |
| --- | --- | --- |
| Mock login with a shared password | The brief explicitly allows mocked or seeded users | Real identity provider, per-user credentials, MFA |
| In-memory sessions | Nothing to provision; a restart logging everyone out is acceptable for a demo | A session store (Redis, or a DB table), and sliding expiry |
| No CSRF tokens | `SameSite=Lax` plus a JSON-only API that refuses cross-site form posts | Explicit CSRF tokens once cookies are used for state-changing requests |
| No rate limiting on login | Mock auth, no credential guessing surface worth protecting | Rate limiting and lockout |
| No transport security | The app runs on `localhost` over HTTP | TLS, `Secure` cookie flag, HSTS |
| No audit trail of *reads* | The brief asks for change history, not access logging | Access logging if the data is sensitive |

---

## 7) Planned File Changes (canonical list)

All paths are relative to the repository root.

| File Path | Action | Rationale / Notes |
|---|---|---|
| `package.json` | Add | ESM (`"type": "module"`), scripts `start` / `test` / `seed`, and the three dependencies. `"test"` uses the glob form `node --test "test/**/*.test.js"` — on Node 22 a positional directory path is treated as a module and fails. |
| `.gitignore` | Add | Ignores `node_modules/`, `data/`, `*.db`, `.env`. |
| `README.md` | Add | Run instructions, demo credentials, and the write-up. |
| `src/config.js` | Add | Env-var configuration read once: `PORT`, `DB_PATH`, `STUCK_THRESHOLD_DAYS`, `VENDOR_TRACKER_NOW`. |
| `src/clock.js` | Add | The only reader of the wall clock. Provides `now()`, `toIso()`, `fromIso()`. Honours the frozen-clock override. |
| `src/domain/stages.js` | Add | The five stages in order, `isValidStage()`, `isTerminal()`. |
| `src/domain/duration.js` | Add | Pure duration and threshold logic: `computeDuration()`, `isStuck()`, `formatDuration()`. No I/O. |
| `src/db/schema.js` | Add | DDL as an exported string, including the `CHECK` constraints and indexes. A JS string rather than a `.sql` file — no path resolution to get wrong between the server and the tests. |
| `src/db/connection.js` | Add | Opens the database, applies `PRAGMA foreign_keys = ON` and the schema. |
| `src/db/queries.js` | Add | Prepares every statement once against a connection. |
| `src/db/seed.js` | Add | The deterministic twelve-vendor dataset and three coordinators, relative to the injected clock. |
| `src/services/stage-service.js` | Add | `changeStage()` — the single write transaction — plus `toVendorDto()`. |
| `src/services/auth-service.js` | Add | `login()`, `logout()`, `getSession()`, scrypt verification. |
| `src/http/errors.js` | Add | `AppError` and the single JSON error handler, so every failure has the same shape. |
| `src/http/auth-middleware.js` | Add | The BR-01 gate. Reads the session cookie, attaches the coordinator, rejects with 401. |
| `src/http/routes.js` | Add | The REST surface described in §5. |
| `src/server.js` | Add | Composition root: builds the database, seeds if empty, mounts routes, serves `public/`, listens. |
| `public/index.html` | Add | The single page: login view and board view. |
| `public/app.js` | Add | The SPA: one `state` object, one `render()`, `fetch` calls, the conflict banner, the history panel. |
| `public/styles.css` | Add | ~40 lines of plain, legible styling. No framework, no build step. |
| `test/helpers.js` | Add | Builds an in-memory database with the schema, the seed, and a logged-in request helper. |
| `test/duration.test.js` | Add | The pure duration and threshold rules, including the exact boundary. |
| `test/stages.test.js` | Add | Stage validation and ordering. |
| `test/schema.test.js` | Add | The database constraints and the five invariants I1–I5. |
| `test/seed.test.js` | Add | Seed shape, idempotence, and the boundary cases in the seeded data. |
| `test/auth.test.js` | Add | BR-01: authentication, session lifecycle, no user enumeration, independent sessions. |
| `test/vendors.test.js` | Add | The read path, and the tri-state `isStuck` at the wire level. |
| `test/stage-change.test.js` | Add | BR-02, BR-03, BR-06, the no-op rule, the two-coordinator conflict, and the transaction's rollback. |
| `feature-vendor-onboarding-tracker-design.md` | Add | This document. |
| `feature-vendor-onboarding-tracker-plan.md` | Add | The implementation plan: steps, deliverables, and status. |

---

## 8) Risks & Rollback

### Risks

| # | Risk | Impact | Likelihood |
| --- | --- | --- | --- |
| R1 | **SQLite on the 9p-mounted working directory** (`/mnt/c/...`) is slow — measured at 848 ms for 50 inserts vs 13 ms on local ext4 — and may surface locking errors under concurrent access. | Medium | Medium |
| R2 | **The 3-hour time box runs out** with the UI unfinished. | High | Medium |
| R3 | **`PRAGMA foreign_keys` is OFF by default in SQLite**, so foreign keys are silently not enforced unless it is set explicitly — the schema would look correct while the referential guarantees were absent. | High | Medium |
| R4 | **The boundary case drifts.** Under a live clock, the vendor seeded at exactly 7 days becomes "stuck" within a second, so the demo silently contradicts the documentation. | Medium | High |
| R5 | **The rule is written against floored days** instead of elapsed milliseconds, so a vendor 7 days 23 hours into a stage is reported as not stuck. | High | Medium |
| R6 | **The no-op path bumps `version`**, so the client's next update fails with a spurious `409`. | Medium | Medium |
| R7 | **The SPA catch-all swallows unknown `/api` routes** and answers them with `200` + HTML, breaking the client's JSON error handling and hiding `404`s. | Medium | Medium |
| R8 | **`node --test test/`** — the intuitive form — fails on Node 22, because a positional path is treated as a module to execute rather than a directory to search. | Low | High |
| R9 | The seed drifts out of sync with the invariants as it is edited. | Low | Medium |

### Mitigations

- **R1** — Verified in the build environment: writes succeed and the default rollback
  journal works correctly on the mount, so the risk is performance, not correctness. A
  30-second SQLite smoke test on the target filesystem is **Checkpoint 0** of the build
  order, before any application code is written. If it fails, `DB_PATH` points at a
  local ext4 path and the problem is gone.
- **R2** — The build order front-loads the domain layer and the API test suite, and
  defines an explicit cut line. A working API with passing tests and a plain table is a
  complete, submittable deliverable; a beautiful UI over a broken API is not.
- **R3** — `PRAGMA foreign_keys = ON` is set in `openDb()`, and `test/schema.test.js`
  asserts that inserting a history row with a non-existent `changed_by` **throws**. That
  test fails if the pragma is ever removed.
- **R4** — The clock is frozen by default, with `VENDOR_TRACKER_NOW=live` as the opt-in
  for real time. The UI shows a visible "demo clock" badge, so the frozen state is
  disclosed rather than hidden.
- **R5** — The rule is `durationMs > thresholdMs` on exact integers. `daysInStage` is a
  display value only. Seed Company K (7 d 23 h 59 m 59.999 s) exists to fail any
  implementation that gets this wrong, and a test pins it.
- **R6** — The no-op path returns before the write, so no version bump occurs. Asserted
  explicitly by a test.
- **R7** — The SPA fallback excludes the API prefix (`/^\/(?!api\/).*/`), and a JSON
  `404` handler is registered for `/api/*`.
- **R8** — The `test` script uses the glob form, verified working on Node 22.
- **R9** — Invariants I1–I5 are asserted over the whole seeded dataset at once, so a
  seed edit that breaks consistency fails the suite rather than a reviewer.

### Rollback

The application owns no shared infrastructure, so rollback is cheap and total.

1. **Stop the server** (`Ctrl-C`). No external state to unwind — no background jobs, no
   outbound calls, no notifications.
2. **Discard the database** — `rm -rf data/`. The schema is `CREATE TABLE IF NOT
   EXISTS` and the database is fully derived from the seed, so this loses nothing that
   is not reproducible by `npm run seed`.
3. **Revert the code** — the change is confined to new files, so reverting to the parent
   commit removes the feature entirely.
4. **Verify** — `npm install && npm test` on the reverted tree.

There is no data migration to reverse and no schema version to unwind, because the
schema is additive and disposable. If a future change must not lose data, the migration
story changes with it; that constraint is recorded here rather than solved in advance.

---

## 9) Open Questions

| # | Question | Owner | Decision deadline | Current position |
| --- | --- | --- | --- | --- |
| Q1 | Should a vendor in the terminal `Active` stage be exempt from the stuck threshold? | Product | Before a future iteration | **Exempt.** A vendor that reached `Active` has finished onboarding, so waiting there is the intended outcome rather than a stall. The threshold rule itself stays pure and is applied to every stage; the exemption lives in one function (`isVendorStuck`), so reversing it is a one-line change. `isTerminal` is exposed on the payload either way. |
| Q2 | Should sequential stage transitions be enforced? | Product | Before a future iteration | **No.** The brief requires coordinators to move vendors and does not require ordering. Documented as an assumption; enforcing it later would be additive. |
| Q3 | Should the coordinator be able to edit the free-text note? | Product | Before a future iteration | **Out of scope.** Notes are seeded and read-only. The spec asks for stage tracking, not a notes editor. |
| Q4 | Should sessions survive a server restart? | Engineering | Next iteration | **No.** In-memory for now; a session table or Redis is the first item on the "what next" list. |
| Q5 | Should the "stuck" list be sorted to the top by default? | Product | Before the UI is built | **No.** The board keeps the spreadsheet's alphabetical order, so a coordinator is not looking at a list that reorders itself under them; stuck vendors are marked in place and an "only stuck" filter narrows the list to them. This is a presentation choice, not a rule. |
| Q6 | Does the Ops team need per-region coordinator permissions? | Product | Unknown | **Assumed no.** All coordinators can move all vendors, matching the spreadsheet. Worth confirming with the team. |
| Q7 | Should the frozen demo clock be the default in the submitted repository? | Engineering | At submission | **Yes**, with a visible badge and a one-line switch to live time. The brief explicitly permits it, and it is what makes the boundary case demonstrable. |

---

## 10) References

- **Primary source** — `Home Assignment_ Vendor Onboarding Tracker.pdf`: the business
  problem, the five stages, the example spreadsheet, the four requirements, the scope
  exclusions, and the submission requirements.
- **Brief's stated problems** — "vendors can sometimes remain at the same stage for a
  long time without anyone noticing" and "it can be difficult to understand what
  happens when information in the spreadsheet looks incorrect" (brief, *The Business
  Problem*). The third problem, manual status maintenance, is an interpretation of the
  described process and is labelled as such in the write-up.
- **Example spreadsheet rows** — Companies A–F with their regions, stages, last-updated
  dates, coordinators, and notes. The seed data preserves those names and regions so
  the seeded dataset reads as the spreadsheet the brief describes, extended to cover
  the edge cases the spreadsheet cannot express.
- **Implementation plan** — [./feature-vendor-onboarding-tracker-plan.md](feature-vendor-onboarding-tracker-plan.md).
- **Assignment constraints** — 3-hour time box; submission = working repository,
  short write-up, and tests, with the emphasis on "what you chose to test and why".
