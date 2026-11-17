# Notifications

`modules/notifications` provides persistent in-app notifications. Creation is separate from delivery, recipients are always resolved server-side, and read state is per user.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/notifications` | Paginated feed; `unreadOnly`, `type`, `limit` (`1..100`, default 25), `offset` |
| GET | `/api/v1/notifications/unread-count` | `{ unread }` for the caller |
| POST | `/api/v1/notifications/:id/read` | Mark one notification read |
| POST | `/api/v1/notifications/read-all` | Mark every unread notification read |

Every route is authenticated. Queries always include `user_id = auth.userId`; a notification owned by another user returns `404`, never `403`, so existence is not leaked. Clients cannot choose a recipient ID.

## Data model

`notifications` stores the user, type, title, body, optional entity type/ID, competition, dedupe key and `read_at`.

- `notification_user_idx` supports the feed (`user_id, created_at`).
- `notification_unread_idx` supports unread counts.
- `notification_competition_idx` supports scoped administrative reporting.
- `notification_dedupe_uq` is a partial unique index on `(user_id, dedupe_key)` where the key is not null. Repeating an operation with the same key creates no duplicate.

`notification_deliveries` records channel delivery separately. `(notification_id, channel)` is unique; channel is currently `in_app` or a reserved `email`; status is `pending`, `delivered`, `failed` or `skipped`.

## Creation and delivery

`createNotification(tx, userId, input)` runs inside the caller's business transaction:

1. insert the notification (dedupe-aware);
2. insert an `in_app` delivery row with status `delivered`, `attempts = 1`, `deliveredAt = now`.

If the business transaction rolls back, the notification and delivery do not exist. In-app delivery is truthful because the row is immediately readable through the API. **No email or push provider is configured**, and no external delivery is claimed. There is no retry worker; failed external channels would require one.

`createNotifications` deduplicates recipient IDs and counts created rows.

## Trusted recipient resolution

Recipients come from database relationships, never from request payloads:

| Helper | Resolution |
|---|---|
| `competitionAdministratorIds` | Active `competition_admin`/`super_admin` grants for the competition or global |
| `teamCaptainId` | `team_registrations.captain_user_id` |
| `matchOfficialIds` | `match_officials` for the match |
| `matchTeamCaptainIds` | Captains of both participating team entries |
| `notifyTeamCaptain` | Captain of a team entry |
| `notifyMatchParticipants` | Both team captains plus assigned officials |
| `notifyCaseParticipants` | Case subject user and administrators |

## Current producers

- Registration approval/rejection → team captain.
- Lineup confirmation/return → team captain.
- Match official assignment → assigned official.
- Match reschedule → participating captains and officials.
- Announcement publication → resolved audience.
- Dispute submission/response/information/decision → administrators and submitter.
- Disciplinary opening/response request/decision/appeal/closure → subject or administrators.
- User role grant/revocation → affected user.

## Limitations

- Only the in-app channel is implemented. Email/push requires a provider, credentials, retry policy and failure reporting; none is added.
- There is no realtime notification channel. Polling the feed or unread count is the supported client behavior. Match WebSocket channels are unchanged and process-local.
- Notifications are not automatically purged. There is no notification-management endpoint.
