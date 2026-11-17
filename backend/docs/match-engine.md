# Match engine

The match engine owns the in-play lifecycle, period clock, official assignments and result confirmation. Fixtures are scheduled by `fixtures`; the engine moves a `matches` row through its periods and keeps the fixture status in sync.

Modules:

- `src/modules/matches/engine.ts` — shared authorization, locking, score calculation.
- `src/modules/matches/service.ts` — lifecycle, clock, officials, results and history.
- `src/modules/matches/events.ts` — event writes, corrections and voids (see `match-events.md`).
- `src/modules/matches/live.ts` — post-commit WebSocket payloads.

## Status model

`matches.status` doubles as the period state.

| Status | Meaning |
|---|---|
| `scheduled` | Not started |
| `first_half` | First half in progress |
| `half_time` | Between halves |
| `second_half` | Second half in progress |
| `full_time` | Ended; result can be submitted |
| `postponed` | Deferred before kickoff |
| `cancelled` | Never played |
| `abandoned` | Stopped after kickoff |

`live` remains accepted by the database and treated as in-play for compatibility with the existing schema and client vocabulary, but new transitions write the canonical period names above.

## Transitions

| Action | Endpoint | Allowed from | Result |
|---|---|---|---|
| Start | `POST /matches/:id/start` | `scheduled` | `first_half`, `started_at`, clock 0 |
| Half time | `POST /matches/:id/half-time` | `first_half`, `live` | `half_time`, clock ≥ 45 |
| Second half | `POST /matches/:id/second-half` | `half_time` | `second_half`, clock ≥ 46 |
| End | `POST /matches/:id/end` | `second_half` | `full_time`, `ended_at`, fixture `completed` |
| Postpone | `POST /matches/:id/postpone` | `scheduled` | `postponed`, fixture `postponed` |
| Cancel | `POST /matches/:id/cancel` | `scheduled`, `postponed` | `cancelled`, fixture `cancelled` |
| Abandon | `POST /matches/:id/abandon` | in-play statuses | `abandoned`, fixture `abandoned` |

Every transition is validated against the current database row, not a client-supplied status. `start` also requires the fixture to be `scheduled` (published). `end` refuses a match without `started_at`. Starting an already-started match, resuming `full_time`, or any other unlisted transition returns `409`.

Each transition writes:

- the match row (`status`, timestamps, clock, `updated_at`);
- the fixture status when the definition sets one;
- an `audit_logs` row with `entity_type = 'match'`, the before/after match and fixture status, the authenticated actor and the optional reason.

## Clock

`PATCH /matches/:id/clock` accepts `{ minute, addedMinutes? }`. The minute is explicit state, never derived from wall-clock time, so a late or missed request cannot silently invent minutes.

- Only in-play statuses accept clock updates.
- `minute` is `0..150`, `addedMinutes` is `null` or `0..30`, matching the Phase 3 bounds.
- A confirmed result blocks further clock changes.
- Transitions advance the clock forward (`start` = 0, `half_time` ≥ 45, `second_half` ≥ 46, `end` ≥ 90). It is a floor, not a rewrite of a higher reported minute.

## Match detail and reads

`GET /matches/:id` returns the match, fixture, both participants with team details and the events/lineups visible to the caller. Visibility reuses `canReadMatch`: public published match, scoped manager, assigned official or participating captain. Private matches return `404` to callers without access.

## Officials

Assignments live in `match_officials` (unique `(match_id, user_id)`).

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/matches/:id/officials` | match readers |
| POST | `/api/v1/matches/:id/officials` | `officials.assign` or `matches.manage` in scope |
| PATCH | `/api/v1/matches/:id/officials/:userId` | same |
| DELETE | `/api/v1/matches/:id/officials/:userId` | same |
| GET | `/api/v1/officials/me/matches` | authenticated; returns the caller's assignments |

Rules:

- The account must exist and be active.
- The account must hold an active `match_official` role that is either global or scoped to the match's competition.
- Duplicate assignments return `409`.
- An administrator cannot assign themselves, which prevents self-granted report authority.
- Officials cannot be assigned to `full_time`, `cancelled` or `abandoned` matches.
- Removal is only allowed before kickoff (`scheduled` or `postponed`); a started match keeps its assigned official for the record.
- Every assignment change is audited with `entity_type = 'match'`.

Write authority for match operations is `canReportMatch`: `matches.manage` in scope, or `matches.report` plus an explicit assignment. Captains and ordinary users never report.

## Results

Scores are never accepted as input. `matches.home_score` / `away_score` are derived from non-voided `goal`, `own-goal` and `penalty-scored` events (see `match-events.md`).

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/matches/:id/result` | match readers; includes derived score and event snapshot |
| POST | `/api/v1/matches/:id/report` | reporting authority; full-time only |
| POST | `/api/v1/matches/:id/result/correct` | `matches.manage` only; audited |
| GET | `/api/v1/matches/:id/result/history` | reporting authority; audit log subset |

Report submission:

1. Requires `full_time`, `started_at` and `ended_at`, a `completed` fixture and no existing confirmation.
2. Recalculates the score from events inside a transaction.
3. Sets `result_confirmed_at` and `confirmed_by`.
4. Audits `match.result.submitted` with the event snapshot, previous and new score.
5. Clears the season's current standings snapshots and audits `standings.snapshot.invalidated`.

Correction:

1. Administrative only, and only for a `full_time` match.
2. Re-derives the score from the current events.
3. Re-stamps `result_confirmed_at` / `confirmed_by`.
4. Audits `match.result.corrected` with reason, previous confirmation and events.
5. Again clears the season's current standings snapshots and audits invalidation.

Editing or voiding an event on a confirmed result clears the confirmation (`match.result.reopened` audit) and also invalidates current standings. An administrator must then re-confirm through the correction endpoint. This keeps the invariant "a confirmed result always matches its event set".

History returns the `match.result.submitted`, `match.result.corrected` and `match.result.reopened` audit rows, newest first. It is not a public endpoint.

`GET /matches/:id/result` exposes both the persisted `score` and the freshly computed `derivedScore`; they should agree. Live standings and statistics consume only confirmed results; published standings snapshots are versioned and are never treated as current after a result change. See `standings.md`.

## Concurrency

- All transitions, clock updates, official changes and result writes run inside `db.transaction(...)`.
- The shared helper `lockMatch` locks the fixture row first, then the match row (`SELECT … FOR UPDATE`). Fixture lifecycle writes now use the same fixture→match order, so scheduling and in-play operations cannot deadlock.
- Two concurrent `start` calls serialize on the row lock; exactly one returns `200` and the other `409`.
- Event writes take the same match lock before checking idempotency, so retries and conflicting payloads are ordered.
- Unique constraints (`one match per fixture`, `(match_id, user_id)`, `(match_id, client_event_id)`) remain the final guard.

## Not implemented

Disciplinary records, disputes, notifications and multi-instance realtime fan-out are out of scope. Extra time and penalty shootouts exist in the status vocabulary but have no dedicated transition endpoints; they are not reachable from the canonical flow. Lineup management and standings are implemented in Phase 6; see `lineups.md` and `standings.md`.
