# Realtime

## Endpoint

`GET /ws/matches/:id` (upgrade to WebSocket). The path parameter must be a match UUID.

## Authentication

Authentication happens during pre-validation, before the HTTP upgrade:

- Non-browser clients: `Authorization: Bearer <accessToken>`.
- Browsers: the HTTP-only `access_token` cookie (path `/ws`) plus an `Origin` listed in `CORS_ORIGINS`.
- Cookie authentication without an allowlisted origin is rejected to prevent cross-site WebSocket hijacking.

The access token must be valid and bound to an active, non-revoked session owned by an active user. Missing, invalid, expired or revoked credentials receive a `401` response instead of a `101 Switching Protocols`; no `connection.ready` frame is sent.

After the upgrade, the server resolves the match and authorizes the caller using the same rules as `GET /matches/:id`: public published match, scoped competition manager, assigned match official, or participating team captain. An unauthorized match closes with code `4404`.

## Messages

Client messages are strict JSON. Unknown fields/types are rejected with an error frame.

```json
{"type":"ping"}
{"type":"subscribe","matchId":"<uuid>"}
{"type":"unsubscribe","matchId":"<uuid>"}
```

Server messages:

```json
{"type":"connection.ready","matchId":"<uuid>","at":"..."}
{"type":"subscribed","matchId":"<uuid>"}
{"type":"unsubscribed","matchId":"<uuid>"}
{"type":"pong","at":"..."}
{"type":"error","code":"SUBSCRIPTION_FORBIDDEN","message":"..."}
```

Messages larger than 4 KiB are rejected. Malformed JSON produces `INVALID_MESSAGE` without closing the socket.

## Subscription rules

- The channel is bound to the match in the URL.
- `subscribe` and `unsubscribe` must name that exact match. A different match is rejected with `SUBSCRIPTION_FORBIDDEN`, even if that other match is public.
- Every message revalidates the session and re-authorizes the match against the database.
- Client-supplied user IDs, roles or permission claims are ignored.

## Revocation

Logout, logout-all and account deactivation revoke sessions immediately. A process-local registry closes affected live sockets with code `4401`. The next message from any socket also revalidates the session and closes it if revoked.

This registry covers single-instance deployments. Multi-instance deployments require a shared revocation/notification mechanism (for example PostgreSQL `LISTEN/NOTIFY` or a message bus); that is not implemented in this phase.

Phase 7 adds no WebSocket channels. Notifications and announcements are read through authenticated HTTP endpoints, so private evidence, case and dispute data is never broadcast. In-app notifications work without any realtime connection; clients may poll `/notifications/unread-count`.

## Event delivery

After a committed write, the server pushes a sanitized `match.update` frame to every connection authorized for that match:

```json
{
  "type": "match.update",
  "reason": "match.started",
  "at": "2026-11-16T10:00:00.000Z",
  "match": {
    "matchId": "<uuid>",
    "status": "first_half",
    "currentMinute": 0,
    "addedMinutes": 0,
    "homeScore": 0,
    "awayScore": 0,
    "resultConfirmedAt": null
  },
  "event": {
    "id": "<uuid>",
    "matchId": "<uuid>",
    "eventType": "goal",
    "teamRegistrationId": "<uuid>",
    "playerRegistrationId": "<uuid>",
    "secondaryPlayerRegistrationId": null,
    "minute": 12,
    "addedMinutes": null,
    "description": null,
    "voided": false,
    "corrected": false
  }
}
```

`event` appears only for event frames. Reasons currently emitted:

- `match.started`, `match.half_time`, `match.second_half`, `match.ended`
- `match.postponed`, `match.cancelled`, `match.abandoned`, `match.rescheduled`
- `match.clock`
- `event.recorded`, `event.replayed`, `event.corrected`, `event.voided`
- `result.submitted`, `result.corrected`

Phase 6 adds one lineup frame, emitted only when a lineup transitions to `confirmed`:

```json
{
  "type": "lineup.update",
  "reason": "lineup.confirmed",
  "at": "2026-11-16T10:00:00.000Z",
  "lineup": {
    "id": "<uuid>",
    "matchId": "<uuid>",
    "teamRegistrationId": "<uuid>",
    "formation": "4-3-3",
    "status": "confirmed",
    "confirmedAt": "2026-11-16T09:59:58.000Z",
    "players": [
      {
        "playerRegistrationId": "<uuid>",
        "role": "starter",
        "shirtNumber": 1,
        "position": "GK",
        "x": 50,
        "y": 5,
        "isCaptain": false
      }
    ]
  }
}
```

Draft, submitted and returned rosters are never broadcast. The payload is sanitized: no submitter/confirmer user IDs, no return reason, no private player records. There is no standings channel and no statistics push.

Guarantees:

- Frames are emitted **after** the database transaction commits, so a client never sees state that was rolled back.
- Only connections that passed match authorization are registered, so private match and draft-lineup data cannot leak to an unauthorized subscriber.
- Payloads exclude actor user IDs, audit reasons and credentials.

Limitations:

- Delivery is process-local. Multiple API instances do not share the registry, so a client connected to instance A will not receive a broadcast triggered on instance B.
- There is no persistent outbox or replay buffer. A client that was disconnected misses intermediate frames and must refresh via REST.
- Frames are best-effort; a failed send never rolls back committed state.

## Not implemented

Persistent outbox, multi-instance fan-out, reconnect/replay recovery, score-only streams, standings pushes and statistics streams are not implemented.
