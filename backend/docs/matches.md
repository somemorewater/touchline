# Matches

A match references exactly one fixture. Fixture rows identify the season, optional group, home/away team registrations, kickoff, venue, status and publication timestamp. Match rows hold the period status, explicit clock, score, start/end timestamps and result confirmation.

The engine is documented in detail in `match-engine.md` and `match-events.md`; this page is the short overview.

## Reads

`GET /api/v1/matches/:id` returns the match, its fixture, both participants with team details, and the events and lineups visible to the caller. Public published matches are readable anonymously; private matches require scoped management, an assigned official, or captain ownership of a participant. Voided events are hidden from non-managing readers.

`GET /api/v1/matches/:id/lineups` keeps the Phase 3 behavior: published/confirmed lineups are public, draft lineups are visible only to the owning captain, a scoped manager or the assigned official.

## Lifecycle

```
scheduled → first_half → half_time → second_half → full_time
scheduled → postponed → scheduled   (reschedule)
scheduled | postponed → cancelled
in-play → abandoned
```

Transitions are action endpoints, not a status field in a PATCH body. Each verifies the current database status, the caller's authority and the fixture state, then writes the match, the fixture status, an audit row and (after commit) a WebSocket frame. Invalid, repeated or out-of-order transitions return `409`. Two concurrent transitions produce one `200` and one `409`.

`live` remains an accepted in-play status for compatibility, but new transitions use the period names above.

Half-time is at half the configured duration, the second half starts one minute later, and full-time is at the configured duration. Matches created before the duration field existed keep the default of 90 minutes.

## Venue and duration

`PATCH /api/v1/matches/:id/venue` updates the fixture's existing `venue` field (nullable, at most 200 characters). `PATCH /api/v1/matches/:id/duration` sets `durationMinutes` to a whole number from 10 to 120. Both require `matches.manage` in the competition (or superadmin), are rejected once the match has started or finished, and append `match.venue.updated` / `match.duration.updated` audit rows with the previous and new values. Teams, kickoff, lineups, events and results are untouched.

## Clock

`PATCH /api/v1/matches/:id/clock` sets `minute` (`0..150`) and optional `addedMinutes` (`0..30`). It is explicit server state, not wall-clock derived. Updates are rejected when the match is not in play or the result is confirmed.

## Officials

`GET`, `POST`, `PATCH` and `DELETE /api/v1/matches/:id/officials` manage `match_officials`. Assignment requires `officials.assign` or `matches.manage` in the match's competition, an active `match_official` or `commentary_operator` role (global or scoped to that competition) matching the requested `official`/`commentary` assignment, no duplicate, and no self-assignment. Removal is only possible before kickoff. `PUT /personnel/:role` replaces one role's holder atomically. Optional personnel IDs can also be supplied when the fixture/match is created; they are validated inside the creation transaction. `GET /api/v1/officials/me/matches` lists the caller's assigned matches.

Write authority for match operations is `canReportMatch`: `matches.manage` in scope, or `matches.report` plus an explicit assignment. A `commentary_operator` holds `matches.report` and is assigned through `matchOfficials` with role `commentary`, so the same clock, lifecycle, event, correction and result endpoints apply to them. Captains can read their own matches and events but cannot report or correct results.

Editorial commentary and the match overview use separate `commentary_entries` / `match_overviews` records, gated by `commentary.manage` plus match assignment. They appear on the public match centre but never create official events or change scores.

## Results

Scores are derived from non-voided `goal`, `own-goal` and `penalty-scored` events; no endpoint accepts a score. `POST /api/v1/matches/:id/report` confirms the full-time result and snapshots the event set. `POST /api/v1/matches/:id/result/correct` is the administrative, audited re-confirmation path. `GET /api/v1/matches/:id/result/history` returns the `match.result.*` audit rows.

Only confirmed results feed standings. See `standings.md` for the live table, snapshot publication and invalidation flow.

## Database-enforced rules

Scores are non-negative, an end time cannot precede a start time, and each fixture has at most one match row. Event types come from the frontend vocabulary, minutes are `0..150` and added time `0..30`. Substitutions must name two distinct players, and a trigger requires the event team and players to participate in the match, belong to the event team and share the fixture season. A confirmed result can only exist on a `full_time` match (`match_result_status_check`).
