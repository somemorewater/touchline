# Offline event synchronization

The server implements the write half of the offline contract. Client-side storage still belongs to the Next.js client.

## Contract

1. The client generates a UUID v4 for each event **before** the first send and stores it locally.
2. Every retry reuses the same `clientEventId` and the same payload.
3. The client keeps the original `clientTimestamp` (when the event actually happened on the device); the server stores it alongside its own `receivedAt`.
4. Retries are safe: the server is idempotent on `(match_id, client_event_id)`.

```http
POST /api/v1/matches/:id/events
authorization: Bearer <official access token>

{
  "clientEventId": "3f2b1c4e-...",
  "eventType": "goal",
  "teamRegistrationId": "<uuid>",
  "playerRegistrationId": "<uuid>",
  "minute": 63,
  "addedMinutes": 1,
  "clientTimestamp": "2026-11-16T13:04:12.000Z"
}
```

## Responses

| Situation | Status | Body signal |
|---|---|---|
| New event accepted | `201` | `created: true`, stored event |
| Identical retry | `200` | `created: false`, same stored event |
| Same `clientEventId`, different payload | `409` | `RESOURCE_CONFLICT` |
| Match not in play / result confirmed | `409` | state conflict |
| Invalid player/team/season attribution | `400` | `INVALID_INPUT` / `VALIDATION_ERROR` |
| Caller is not the assigned official or a manager | `403` | `FORBIDDEN` |
| Match hidden from the caller | `404` | `RESOURCE_NOT_FOUND` |

The "already processed" condition is an explicit `created: false`, not a silent overwrite. A conflicting payload is rejected rather than partially applied.

## Why it is concurrency-safe

- The match row is locked (`FOR UPDATE`) before the lookup and insert, so two concurrent retries serialize.
- The database unique index `match_event_client_id_uq` on `(match_id, client_event_id)` remains the final guard if a lock is bypassed.
- The score is recalculated inside the same transaction, so a replay never double-counts a goal.

## Substitutions with confirmed lineups

When a match has a confirmed lineup for the event team, the server validates a `substitution` against it: `playerRegistrationId` must be a starter (outgoing) and `secondaryPlayerRegistrationId` must be a substitute (incoming). The row is rejected with `400` otherwise. This prevents an offline client from recording a substitution between two players who were not part of the confirmed selection. If no lineup is confirmed, the normal event-team/season checks apply.

## Ordering

Events carry `minute` and optional `addedMinutes`. Lists are ordered by minute, then added time, then `created_at`. Out-of-order arrivals are accepted and sorted on read; an event is still recorded against its stated minute. The match clock is separate explicit state updated with `PATCH /matches/:id/clock`, so a delayed event does not move the clock backwards.

## Not implemented

No batch/bulk endpoint, no server-side deduplication across devices beyond the per-match unique key, no automatic conflict resolution UI and no offline queue in this repository. The client must decide whether to discard or display a `409`.
