# Announcements

`modules/announcements` owns the announcement draft/publish/archive lifecycle, audience visibility and audience notification fan-out. Scheduling is deliberately not implemented.

## Authorization

- `announcements.manage` in competition scope allows create, edit, publish, unpublish and archive. `super_admin` is global.
- Global announcements (`competitionId = null`) can only be created or managed by a global `super_admin`.
- Non-public audiences require a competition, except that a global announcement may target `participants`.
- Public reads remain unauthenticated.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/announcements` | optional | Published, non-archived, audience-filtered list |
| GET | `/api/v1/announcements/manage` | authenticated | Draft/published/archived list in scope |
| POST | `/api/v1/announcements` | authenticated | Create a draft |
| PATCH | `/api/v1/announcements/:id` | authenticated | Edit a draft |
| POST | `/api/v1/announcements/:id/publish` | authenticated | Publish and notify the audience |
| POST | `/api/v1/announcements/:id/unpublish` | authenticated | Return to draft |
| POST | `/api/v1/announcements/:id/archive` | authenticated | Archive; read-only afterwards |

`/announcements` accepts `competitionId`, `seasonId`, `audience`, `limit` (`1..200`, default 100) and `offset`. `/announcements/manage` accepts `competitionId`, `seasonId`, `status` (`draft`/`published`/`archived`), `audience`, `limit` (`1..100`, default 25) and `offset`.

## Lifecycle

- Create → draft (`publishedAt = null`, `archivedAt = null`).
- Edit → drafts only. A published announcement must be unpublished first; an archived announcement is read-only.
- Publish → sets `publishedAt` and notifies the resolved audience. Republishing after unpublish reuses the same audience dedupe key, so recipients are not notified twice for the same announcement.
- Unpublish → clears `publishedAt`, hiding it from public reads.
- Archive → sets `archivedAt`; terminal for editing and publishing.

There is no `scheduled_at` column and no background publisher. An announcement is visible only after an explicit publish request. A future scheduler would need a reliable job runner; none is introduced in this phase.

## Audiences

| Audience | Who receives it |
|---|---|
| `public` | Everyone, subject to competition visibility |
| `participants` | Captains, assigned officials and competition administrators (global: active accounts) |
| `captains` | Captains of team entries in the competition/season |
| `officials` | Users assigned as match officials in the competition/season |
| `administrators` | Competition administrators and super administrators |

The database check restricts `audience` to this vocabulary. The migration preflight aborts on historical rows with other values rather than silently reinterpreting them.

## Visibility

`GET /announcements` always requires `publishedAt` set and `archivedAt` null.

- Anonymous callers see public announcements in public competitions and global public announcements.
- Global readers and competition readers see all audiences in their scope.
- Captains see public, `participants` and `captains` announcements for competitions they captain.
- Officials see public, `participants` and `officials` announcements for competitions where they are assigned.
- Competition administrators see all audiences in their managed competitions.
- Ordinary users see public announcements plus `participants` announcements where they participate.

Drafts and archived announcements never appear in the public list. They appear only in the management list for a permitted scope.

## Notifications

Publishing resolves recipients server-side; no client-supplied recipient list exists. Each recipient gets one persisted in-app notification (`type = announcement.published`) with entity `announcement` and the announcement's competition. Dedupe is per announcement. Notification creation shares the publish transaction, so a failed notification insert rolls back publication.

## Audit

Create, update, publish, unpublish and archive write `announcement.*` rows to `audit_logs` with competition and season scope. The public list does not expose audit data.
