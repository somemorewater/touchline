# Match events

Match events are the source of truth for the score. The engine never accepts a score directly; it derives it from events and only counts events that are not voided.

Module: `src/modules/matches/events.ts`. Route handlers are in `routes.ts`; schemas in `schemas.ts`.

## Endpoints

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/matches/:id/events` | match readers |
| GET | `/api/v1/matches/:id/events/:eventId` | match readers |
| POST | `/api/v1/matches/:id/events` | reporting authority (`canReportMatch`) |
| PATCH | `/api/v1/matches/:id/events/:eventId` | reporting authority or manager |
| POST | `/api/v1/matches/:id/events/:eventId/void` | reporting authority or manager |

Reads follow match visibility. Public readers and captains without management/official access see only non-voided events; managers and assigned officials see the full history including voided rows and audit columns.

## Event types

`goal`, `own-goal`, `yellow-card`, `second-yellow`, `red-card`, `substitution`, `injury`, `penalty-awarded`, `penalty-scored`, `penalty-missed`, `kickoff`, `half-time`, `full-time`.

Types are validated against this fixed vocabulary. Team-required types are the goals, cards, substitutes, injuries and penalties. Player-required types are goals, cards, substitutions and scored/missed penalties.

## Write rules

Events can only be created while the match is in play (`first_half`, `live`, `half_time`, `second_half`, `extra_time`, `penalties`) and the result is not confirmed. A `full_time`, `cancelled` or `abandoned` match rejects new events with `409`.

Client-supplied identifiers are treated as untrusted claims:

- `teamRegistrationId` must be one of the fixture participants, resolved from the database.
- `playerRegistrationId` must exist, belong to the fixture season, and belong to the event team; when the request omits the team, it is derived from the player.
- `secondaryPlayerRegistrationId` must belong to the same team and season.
- A substitution requires two distinct players; a player cannot be both sides of any event.
- When the event team has a `confirmed` lineup for the match, a substitution must name a starter as the outgoing player (`playerRegistrationId`) and a substitute as the incoming player (`secondaryPlayerRegistrationId`). Otherwise the request is rejected with `400`.

The Phase 3 validation trigger re-checks the same rules in PostgreSQL, so a bypass of the service still cannot create an inconsistent event.

## Idempotency and offline retries

`clientEventId` is a client-generated UUID and `(match_id, client_event_id)` is unique.

- A retry with the same payload returns `200`, `created: false` and the stored event.
- A retry with a different payload for the same `clientEventId` returns `409`.
- Retries are serialized by the match row lock, so two concurrent submissions yield one `201` and one `200`, never two rows.

This is the server half of the offline contract. Clients must persist the UUID before sending and reuse it on every retry; see `offline-sync.md`.

## Corrections

`PATCH /matches/:id/events/:eventId` accepts any subset of the event fields plus a required `reason`. The merged event is re-validated exactly like a new event, so a correction cannot move a player to a foreign team or a foreign season.

The update writes:

- the corrected values plus `corrected_at`, `corrected_by` and `correction_reason`;
- an `audit_logs` row (`match.event.corrected`) with the full before/after event and the reason.

The original values are preserved in the audit row, not overwritten silently. A voided event cannot be corrected.

## Voids

`POST /matches/:id/events/:eventId/void` requires a `reason` and sets `voided_at`, `voided_by` and `void_reason`. The row is never deleted, so history remains complete.

- Voided events are excluded from the score.
- Voided events are hidden from public lists but visible to managers/officials with their audit fields.
- Voiding an already voided event returns `409`.

## Score derivation

Only non-voided `goal`, `own-goal` and `penalty-scored` events count.

- `goal` and `penalty-scored` credit the event's `teamRegistrationId`.
- `own-goal` records the **conceding** team in `teamRegistrationId`; the engine credits the opposing participant. This convention is documented because the Phase 3 schema constraint only requires consistency, not a direction. Writers must always send the own-goal player's own team.

`calculateScore` is the only score implementation. It is called after every create, correction and void inside the same transaction, so `matches.home_score` / `away_score` are always a function of the current non-voided event set.

## Confirmed results

If the result is confirmed, an event correction or void additionally:

1. clears `result_confirmed_at` and `confirmed_by`;
2. audits `match.result.reopened` with the actor and reason;
3. recalculates the score;
4. clears the season's current standings snapshots and audits `standings.snapshot.invalidated`.

Only `matches.manage` in scope may do this on a confirmed result; an assigned official receives `403`. The administrator then re-confirms with `POST /matches/:id/result/correct`.

## Broadcast

After the transaction commits, the service emits a sanitized `match.update` frame with `reason` `event.recorded`, `event.replayed`, `event.corrected` or `event.voided`. Payloads include the event identity, type, minute and voided/corrected flags, but never actor IDs or audit reasons. See `realtime.md`.
