# Vendor Onboarding Tracker

A small web app that replaces the Operations team's vendor-onboarding
spreadsheet. A coordinator signs in, sees every vendor's current stage, moves a
vendor to the next stage, and sees who changed what and when. Vendors that have
been sitting in one stage for too long are flagged automatically.

The full design and the build plan live alongside this file:

- [`feature-vendor-onboarding-tracker-design.md`](./feature-vendor-onboarding-tracker-design.md)
- [`feature-vendor-onboarding-tracker-plan.md`](./feature-vendor-onboarding-tracker-plan.md)

---

## Quick start

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

The database is created and seeded on first run, so there is nothing else to
set up.

### Demo accounts

| Coordinator | Email | Password |
| --- | --- | --- |
| Linh | `linh@company.vn` | `ops1234` |
| Huy | `huy@company.vn` | `ops1234` |
| Mai | `mai@company.vn` | `ops1234` |

The password is shared and public by design — this is a mock identity system
for a take-home assignment, not production authentication. Passwords are still
stored as scrypt hashes with a per-user salt and compared in constant time.

### Other commands

```bash
npm test        # the full test suite (node:test + supertest, no DB file needed)
npm run seed    # reset the database and print the demo dataset
```

### Configuration

Every knob is an environment variable with a sensible default:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/tracker.db` | SQLite file |
| `STUCK_THRESHOLD_DAYS` | `7` | Days in stage before a vendor is flagged stuck |
| `VENDOR_TRACKER_NOW` | unset | Freeze the clock at an ISO instant, for a stable demo |

Freezing the clock is what keeps the demo dataset honest — the vendor seeded at
*exactly* seven days stays at exactly seven days instead of drifting into
"stuck" while you are looking at it:

```bash
VENDOR_TRACKER_NOW=2026-08-10T00:00:00Z npm start
```

---

## What it does

| Requirement | How it is met |
| --- | --- |
| **Coordinator login** | `POST /api/login` checks an scrypt hash and issues an HttpOnly session cookie. Every API route except login sits behind one authentication middleware, so the acting coordinator is taken from the session and never from the request body. |
| **View vendors** | `GET /api/vendors` returns the list with stage, owner, time in stage, stuck flag and last change. The dashboard adds search, stage filter and a "only stuck" toggle. |
| **Update stage, recorded automatically** | `PATCH /api/vendors/:id/stage` writes the new stage, the coordinator and the timestamp to `stage_history` in the same transaction that updates the vendor, and keeps the previous stage. Moving a vendor *back* also records why. The history is visible per vendor from the dashboard. |
| **Highlight stuck vendors** | Time in stage is computed from `stage_entered_at`, which the system writes on every stage change. Nothing is typed into a "last updated" field by a person. |

---

## How it is put together

```
src/
  domain/      pure rules - stages, duration, stuckness. No I/O, no clock.
  db/          schema, connection, prepared statements, seed data.
  services/    the write path and the row-to-API mapping.
  http/        routes, authentication middleware, error shape.
  app.js       the express app factory.
  server.js    the composition root that wires it all together.
public/        a plain-JavaScript single page app. No framework, no build step.
test/          node:test + supertest.
```

Dependencies point one way: `http → services → db`, with the pure `domain`
layer imported by both `services` and `http` and depending on nothing. The
duration and stuckness rules therefore have no database in their unit tests, and
can be read on their own.

The stages themselves are **state objects** (`src/domain/stages.js`). Each of
the five knows its place in the workflow, whether it is the terminal stage, which
stages it may move to, and — through `judgeMove()` — how to classify a proposed
move. The write path asks the vendor's current stage to judge the move instead
of comparing stage names against a list of conditionals, so a rule that differs
between stages lives on the stage it belongs to:

```js
const move = from.judgeMove(to);          // { allowed, direction, requiresReason }
if (!move.allowed) return { kind: 'invalid_transition' };
if (move.requiresReason && !reason) return { kind: 'reason_required' };
```

The whole app has two runtime dependencies (`express`, `better-sqlite3`) and one
dev dependency (`supertest`). Fewer moving parts is worth more than a framework
inside a three-hour box.

---

## The decisions worth arguing about

**Timestamps are integer epoch milliseconds.** The feature *is* duration
arithmetic. Integer math keeps the threshold comparison exact — no float
rounding, no timezone parsing — and the API still shows ISO-8601 strings for
humans. The conversion happens only at the boundary.

**The threshold is strict `>`, not `>=`.** The brief says a vendor that has
remained in a stage for *more than* the threshold is stuck, so a vendor sitting
at exactly seven days is not yet stuck. There is a test on that exact
boundary, and on seven days plus one millisecond.

**Floored days are for display only.** Seven days twenty-three hours floors
to "7 days", but it is more than seven days, so it is stuck. A rule that
compared the rounded-down day count would get that vendor wrong. The rule is
applied to the exact elapsed milliseconds.

**A missing stage-entry time is "unknown", not "zero days".** `stage_entered_at`
is nullable on purpose. When it is missing the app says so — a distinct badge,
no fabricated number — rather than silently treating the vendor as healthy
forever. A timestamp in the future is reported the same way, as a data problem.

**One transaction for the status and its history.** The vendor's current stage
and its audit trail are one business fact. Writing them separately is exactly
how a tracker starts lying about what happened, so they are committed together
or not at all.

**Optimistic locking, not last-write-wins.** Three coordinators editing one
spreadsheet silently lose each other's work. Every vendor carries a `version`,
the client sends the version it saw, and the `UPDATE` carries that version in
its `WHERE` clause — so a write built on a stale view updates nothing and comes
back as `409 Conflict`. The UI then says who moved the vendor where, and
refreshes the row. The history is never rewritten to force a match.

**A terminal stage is exempt from the stuck rule.** A vendor that reached
`Active` has finished onboarding; sitting there for ninety days is the
intended outcome, not a stall. The threshold rule itself stays pure and is
applied to every stage; this one judgement lives in a single documented place.

**No automatic stage transitions exist anywhere.** A vendor whose KYC
verification failed simply stays at `KYC Docs Received` until a coordinator
moves it. There is no background job, no timer and no rule that can advance a
vendor — which is what makes "a failed verification does not advance the
vendor" true structurally rather than by convention. It is also what keeps the
app from quietly inventing progress the Ops team never made.

**Arbitrary transitions are allowed — but a backward one has to be explained.**
The brief requires coordinators to move vendors and does not require enforcing
order, so a coordinator may move a vendor between any two stages. The one
judgement this does make is about *backward* moves: sending a vendor back to an
earlier stage is rework, so the coordinator has to say why, and the reason is
recorded with the change. That rule is a property of the stage states, not a
fourth `if` in the write path — `judgeMove()` is the only thing that knows what
"backward" means. The one judgement the app does *not* make for them is the
failed-KYC case above, which is expressed by not moving the vendor.

---

## The demo dataset

Twelve vendors covering every case the brief names, so the interesting
behaviour is visible without touching the database:

| Vendor | Stage | Time in stage | Why it is there |
| --- | --- | --- | --- |
| A | Active | 90d | finished; long past the threshold but not stalled |
| B | KYC Docs Received | 24d | **stuck** — and the KYC re-upload note |
| C | Contract Signed | 3d | healthy |
| D | KYC Verified | 6d | healthy, close to the threshold — and a **rework loop**: sent back to re-sign, with the reason recorded |
| E | KYC Docs Received | exactly 7d | **on the boundary** — not stuck |
| F | Contract Sent | 12d | **stuck**; imported with no prior stage |
| G | Active | 45d | finished |
| H | KYC Docs Received | *unknown* | **no stage-entry time** — imported from a blank spreadsheet cell |
| I | Contract Signed | 8d | **stuck** |
| J | Contract Signed | 7d + 1ms | **stuck** — the boundary from the other side |
| K | KYC Docs Received | 7d 23:59:59.999 | **stuck**, though it floors to 7 days |
| L | Contract Signed | 6d 23:59:59.999 | not stuck |

---

## The API

All responses use one error shape: `{ "error": { "code", "message", "details?" } }`.

| Method & path | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /api/login` | no | `{ email, password }` | `200 { coordinator }` | `400`, `401` |
| `POST /api/logout` | yes | — | `204` | — |
| `GET /api/me` | yes | — | `200 { coordinator }` | `401` |
| `GET /api/vendors` | yes | — | `200 { vendors, stages, stuckThresholdDays, asOf, clockFrozen }` | `401` |
| `GET /api/vendors/:id` | yes | — | `200 { vendor }` | `401`, `404` |
| `GET /api/vendors/:id/history` | yes | — | `200 { vendorId, history }` | `401`, `404` |
| `PATCH /api/vendors/:id/stage` | yes | `{ stage, expectedVersion, reason? }` | `200 { changed, vendor, historyEntry? }` | `401`, `400`, `404`, `409` |

`reason` is optional in general and **required for a backward move** — a move to an
earlier stage. Without one, the request is refused with
`400 invalid_request` and `error.details.field === "reason"`, and nothing is written.
A forward move may still carry a note, and that note is recorded the same way.

A vendor looks like this:

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
  "version": 3,
  "lastChange": {
    "previousStage": "Contract Signed",
    "newStage": "KYC Docs Received",
    "changedBy": { "id": 2, "name": "Huy" },
    "changedAt": "2026-07-17T00:00:00.000Z",
    "reason": null
  }
}
```

`isStuck` is deliberately tri-state: `true`, `false`, or `null` when the
duration could not be measured. A client never has to infer "unknown" from a
null field.

---

## Tests

```bash
npm test
```

One hundred and eight tests across seven files, each one tied to a rule rather
than to an implementation detail:

| File | What it covers |
| --- | --- |
| `test/duration.test.js` | the threshold from both sides, the floored-days trap, unknown and future timestamps, the terminal-stage exemption |
| `test/stages.test.js` | the five stages, their validation, and the state objects — their positions, the terminal flag, and how each judges a proposed move |
| `test/schema.test.js` | the database constraints — invalid stage, dangling foreign key, a history entry that claims nothing changed — the `reason` column and its migration, plus five invariants over the whole seeded dataset |
| `test/seed.test.js` | the demo dataset's coverage of the interesting cases, and that a reseed is identical to the first one |
| `test/auth.test.js` | the authentication gate, the cookie's flags, no password in any response, an unknown account being indistinguishable from a wrong password, session expiry |
| `test/vendors.test.js` | the list and history shapes, the tri-state stuck flag on the wire, 404s |
| `test/stage-change.test.js` | the write path: who changed it and when, the clock restarting, the no-op, the stale version, the two-coordinator race, the backward-move reason rule, and a failed write leaving the vendor untouched |

The two-coordinator race is modelled the way it actually happens: both
coordinators are looking at the same version, the first one succeeds, and the
second one's write is refused — with exactly one history row, for the change
that really happened.

---

## What is deliberately not here

- **Vendor CRUD.** Vendors come from the seed, as they do from the spreadsheet
  today. Adding, editing and removing vendors is a different piece of work.
- **Sequential stage enforcement.** See the trade-off above: enforcing order
  would also stop a coordinator from fixing a wrongly-entered stage.
- **Persistent sessions.** They live in memory, so restarting the server signs
  everyone out. A real deployment would move them to a store.
- **Notifications and live updates.** Nothing pushes; the dashboard refreshes
  when you ask it to, and a conflict is reported when you try to write.
