# API

Successful bodies use `{success:true,data,meta?}`. Errors use a single contract:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "statusCode": 400,
    "requestId": "req-1",
    "details": [{ "field": "params.id", "message": "must match pattern ..." }]
  }
}
```

`details` is optional and contains only safe field/message pairs. Validation errors are translated from Fastify/Ajv and Zod. Unexpected exceptions return `INTERNAL_ERROR` with status `500` and are logged server-side with the request ID; stacks, SQL, credentials and tokens are never returned to clients.

| Situation | Status | Typical code |
|---|---:|---|
| Invalid body, query or route parameter | 400 | `VALIDATION_ERROR` |
| Malformed or empty JSON body | 400 | `INVALID_JSON` |
| Missing, invalid, expired or revoked access token | 401 | `UNAUTHENTICATED` / session code |
| Authenticated but lacking permission or scope | 403 | `FORBIDDEN` |
| Unknown or deliberately hidden private resource | 404 | `RESOURCE_NOT_FOUND` |
| Duplicate or related-resource conflict | 409 | `RESOURCE_CONFLICT` / module code |
| Request body over 1 MiB | 413 | `PAYLOAD_TOO_LARGE` |
| Route or global rate limit exceeded | 429 | `RATE_LIMIT_EXCEEDED` |
| Unexpected failure or database outage | 500 | `INTERNAL_ERROR` |

Authentication responses set `Cache-Control: no-store`. Permission codes are part of the API contract; see `docs/authorization.md`.

## Health

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health/live` | public | Liveness; `200` while the process runs |
| GET | `/health` | public | Readiness; checks PostgreSQL, `503` when unavailable |
| GET | `/ready` | public | Alias of `/health` |

Readiness failure uses status `503` with code `DATABASE_UNAVAILABLE`.

## Routes

OpenAPI UI is `/docs`. Path parameters shown as `:id` must be UUIDs; otherwise the request is rejected with `400`.

| Method | Path | Classification | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/register` | public | Strict body; only `registered_user`; 5/min per IP |
| POST | `/api/v1/auth/login` | public | Access token + refresh/access cookies; 8/min per IP |
| POST | `/api/v1/auth/refresh` | cookie | Rotates refresh token; 30/min per IP |
| POST | `/api/v1/auth/logout` | optional auth / cookie | Revokes current session; idempotent |
| POST | `/api/v1/auth/logout-all` | authenticated | Revokes every session for the user |
| POST | `/api/v1/auth/change-password` | authenticated | Verifies the current password, updates the hash and revokes the user's sessions; 8/min per IP |
| GET | `/api/v1/auth/me` | authenticated | Safe account, roles, permissions and scopes |
| GET | `/api/v1/competitions` | public, optionally private | Public competitions always; private only in scope |
| POST | `/api/v1/competitions` | super admin | `competitions.create` |
| GET | `/api/v1/competitions/:id` | public, optionally private | Private/draft returns `404` unless authorized |
| PATCH | `/api/v1/competitions/:id` | scoped admin | `competitions.update` in scope; archived is read-only |
| POST | `/api/v1/competitions/:id/publish` | scoped publisher | `competitions.publish`; draft → published |
| POST | `/api/v1/competitions/:id/unpublish` | scoped publisher | `competitions.publish`; published → draft |
| POST | `/api/v1/competitions/:id/archive` | scoped admin | Terminal; historical records retained |
| GET | `/api/v1/competitions/:id/seasons` | public, optionally private | Same visibility as competition |
| POST | `/api/v1/competitions/:id/seasons` | scoped admin | `competitions.update`; creates a `planned` season |
| GET | `/api/v1/seasons/:id` | public, optionally private | Season plus groups |
| PATCH | `/api/v1/seasons/:id` | scoped admin | Label/dates; archived is read-only |
| POST | `/api/v1/seasons/:id/activate` | scoped admin | planned → active |
| POST | `/api/v1/seasons/:id/close` | scoped admin | planned/active → completed |
| POST | `/api/v1/seasons/:id/archive` | scoped admin | Terminal; historical records retained |
| GET | `/api/v1/seasons/:id/groups` | public, optionally private | Archived groups hidden from ordinary readers |
| POST | `/api/v1/seasons/:id/groups` | scoped admin | `teams.manage`; planned/active season only |
| GET | `/api/v1/groups/:id` | public, optionally private | Archived groups hidden from ordinary readers |
| PATCH | `/api/v1/groups/:id` | scoped admin | Archived groups are read-only |
| POST | `/api/v1/groups/:id/archive` | scoped admin | Only when no team entries reference the group |
| GET | `/api/v1/teams` | public, optionally private | Public approved participation or scoped/captain access |
| POST | `/api/v1/teams` | scoped admin / super admin | With `seasonId` creates team + draft entry; standalone is super-admin only |
| GET | `/api/v1/teams/:id` | public, optionally private | Includes entries visible to the caller |
| PATCH | `/api/v1/teams/:id` | scoped admin | `teams.manage`; archived teams are read-only |
| POST | `/api/v1/teams/:id/archive` | scoped admin | Blocked while an active season entry exists |
| POST | `/api/v1/teams/:id/restore` | scoped admin | Rechecks active-name uniqueness |
| GET | `/api/v1/seasons/:id/team-entries` | public, optionally private | Approved public entries, own entries and scoped entries |
| POST | `/api/v1/seasons/:id/team-entries` | scoped admin | Enters an existing team in a planned/active season |
| GET | `/api/v1/team-entries/:id` | public, optionally private | Team, season and competition context |
| PATCH | `/api/v1/team-entries/:id` | scoped admin | Group/status/review note; planned/active season only |
| GET | `/api/v1/team-entries/:id/captain` | captain/admin | Captain assignment; no password material |
| POST | `/api/v1/team-entries/:id/captain` | scoped admin | `captains.manage`; planned/active season only |
| POST | `/api/v1/team-entries/:id/captain/revoke` | scoped admin | Removes the binding, not the account |
| POST | `/api/v1/captains` | scoped admin | Atomically creates account + role + binding; planned/active season only |
| GET | `/api/v1/captains/me/teams` | captain | Entries where the caller is `captain_user_id` |
| POST | `/api/v1/player-registrations` | captain only | Submit/resubmit for the caller's own team entry |
| GET | `/api/v1/player-registrations` | captain/admin | Filters: competition, season, team, entry, status |
| GET | `/api/v1/player-registrations/:id` | captain/admin | Owning captain or scoped reviewer |
| GET | `/api/v1/player-registrations/:id/history` | captain/admin | Audit transitions, oldest first |
| POST | `/api/v1/player-registrations/:id/review` | scoped reviewer | submitted → under_review |
| POST | `/api/v1/player-registrations/:id/approve` | scoped reviewer | Transactional revalidation + row lock |
| POST | `/api/v1/player-registrations/:id/reject` | scoped reviewer | Requires a rejection reason |
| POST | `/api/v1/player-registrations/:id/withdraw` | owning captain | submitted/under_review → withdrawn |
| POST | `/api/v1/competition-accounts` | scoped `roles.manage` | Creates a scoped `match_official` or `commentary_operator` account |
| POST | `/api/v1/admin-accounts` | super admin | Creates admin account + global/scoped grants |
| GET | `/api/v1/admin-accounts` | super admin | Lists administrator accounts and assignments |
| POST | `/api/v1/admin-accounts/:id/competitions` | super admin | Grants scoped `competition_admin` |
| DELETE | `/api/v1/admin-accounts/:id/competitions/:competitionId` | super admin | Revokes that scoped grant |
| GET | `/api/v1/fixtures` | public, optionally private | Filters: competition, season, group, team, team entry, status; only published fixtures publicly |
| POST | `/api/v1/fixtures` | fixture manager | Creates a draft fixture + match in one transaction; optional `officialUserId`/`commentaryUserId` assignments are validated and inserted in the same transaction |
| POST | `/api/v1/fixtures/generate/preview` | fixture manager | Round-robin preview; writes nothing |
| POST | `/api/v1/fixtures/generate` | fixture manager | Transactional generation; never overwrites existing fixtures |
| GET | `/api/v1/fixtures/:id` | public, optionally private | Published fixture in a public competition, or scoped/official/captain |
| PATCH | `/api/v1/fixtures/:id` | fixture manager | Draft-only participant changes; completed/cancelled are read-only |
| POST | `/api/v1/fixtures/:id/publish` | fixture manager | draft → scheduled |
| POST | `/api/v1/fixtures/:id/unpublish` | fixture manager | scheduled → draft; blocked after kickoff |
| POST | `/api/v1/fixtures/:id/postpone` | fixture manager | scheduled → postponed; postpones the match |
| POST | `/api/v1/fixtures/:id/reschedule` | fixture manager | New kickoff; reopens a postponed fixture |
| POST | `/api/v1/fixtures/:id/cancel` | fixture manager | Cancels fixture and match before kickoff |
| GET | `/api/v1/matches/:id` | public, optionally private | Private matches require scope/official/captain access |
| GET | `/api/v1/matches/:id/events` | public, optionally private | Voided events hidden from non-managing readers |
| GET | `/api/v1/matches/:id/events/:eventId` | public, optionally private | Same visibility as the event list |
| POST | `/api/v1/matches/:id/events` | reporting authority | Idempotent on `clientEventId`; `201` created, `200` replay |
| PATCH | `/api/v1/matches/:id/events/:eventId` | reporting authority | Requires `reason`; appends an audit correction |
| POST | `/api/v1/matches/:id/events/:eventId/void` | reporting authority | Requires `reason`; excludes the event from the score |
| GET | `/api/v1/matches/:id/officials` | match readers | Assigned officials with display names |
| POST | `/api/v1/matches/:id/officials` | `officials.assign`/`matches.manage` | Eligible, active, non-self assignment with `role: official|commentary` |
| PUT | `/api/v1/matches/:id/personnel/:role` | `officials.assign`/`matches.manage` | Atomic replacement of one role's holder |
| PATCH | `/api/v1/matches/:id/officials/:userId` | same | Updates the assignment role |
| DELETE | `/api/v1/matches/:id/officials/:userId` | same | Removal before kickoff only |
| GET | `/api/v1/officials/me/matches` | authenticated official | Matches explicitly assigned to the caller |
| POST | `/api/v1/matches/:id/start` | reporting authority | `scheduled` → `first_half` |
| POST | `/api/v1/matches/:id/half-time` | reporting authority | `first_half` → `half_time` |
| POST | `/api/v1/matches/:id/second-half` | reporting authority | `half_time` → `second_half` |
| POST | `/api/v1/matches/:id/end` | reporting authority | `second_half` → `full_time`; fixture `completed` |
| POST | `/api/v1/matches/:id/postpone` | reporting authority | `scheduled` → `postponed` |
| POST | `/api/v1/matches/:id/cancel` | reporting authority | Never-started match → `cancelled` |
| POST | `/api/v1/matches/:id/abandon` | reporting authority | In-play match → `abandoned` |
| POST | `/api/v1/matches/:id/reschedule` | reporting authority | New kickoff for a scheduled/postponed match |
| PATCH | `/api/v1/matches/:id/venue` | `matches.manage` | Audited venue change on the underlying fixture; before kickoff only |
| PATCH | `/api/v1/matches/:id/duration` | `matches.manage` | Audited whole-number duration (`10..120`); before kickoff only |
| PATCH | `/api/v1/matches/:id/clock` | reporting authority | Explicit `minute` + optional `addedMinutes` |
| GET | `/api/v1/matches/:id/commentary` | match reader / operator | Published editorial timeline |
| POST | `/api/v1/matches/:id/commentary` | operator / manager | Audited commentary or key moment |
| PATCH | `/api/v1/matches/:id/commentary/:entryId` | operator / manager | Audited correction |
| POST | `/api/v1/matches/:id/commentary/:entryId/retract` | operator / manager | Audited retraction; history preserved |
| GET | `/api/v1/matches/:id/overview` | match reader / operator | Editorial match overview |
| PUT | `/api/v1/matches/:id/overview` | operator / manager | Audited overview update |
| GET | `/api/v1/matches/:id/result` | public, optionally private | Persisted and derived score plus event snapshot |
| POST | `/api/v1/matches/:id/report` | reporting authority | Full-time result submission; confirms the derived score |
| POST | `/api/v1/matches/:id/result/correct` | `matches.manage` | Audited re-confirmation after a correction |
| GET | `/api/v1/matches/:id/result/history` | reporting authority | `match.result.*` audit rows, newest first |
| GET | `/api/v1/matches/:id/lineups` | public, optionally private | Published public from one hour before kickoff; draft/returned/submitted/confirmed owner/manager/official |
| GET | `/api/v1/lineups/formations` | public | Supported formations with goalkeeper and outfield slots |
| GET | `/api/v1/lineups` | authenticated | History; requires match/team/season/competition filter |
| POST | `/api/v1/matches/:id/lineups` | captain / scoped admin | Creates a `draft`; incomplete drafts allowed |
| GET | `/api/v1/lineups/:id` | public, optionally private | Same status-aware visibility as the match list |
| PATCH | `/api/v1/lineups/:id` | captain before kickoff / scoped admin | Admin corrections after kickoff/confirmation require `reason` |
| POST | `/api/v1/lineups/:id/submit` | captain / scoped admin | No body required; optional `reason`; revalidates the persisted complete XI and eligibility |
| POST | `/api/v1/lineups/:id/confirm` | `matches.manage`/`fixtures.manage` | Revalidates and broadcasts post-commit |
| POST | `/api/v1/lineups/:id/publish` | scoped fixture/match manager or assigned official with `lineups.manage` | Records publication; public at kickoff minus one hour |
| POST | `/api/v1/lineups/:id/return` | same | Requires `reason`; clears confirmation |
| POST | `/api/v1/lineups/:id/withdraw` | captain / scoped admin | Returns the lineup to `draft`; audited |
| GET | `/api/v1/team-entries/:id/lineups` | captain / scoped admin | Team-entry lineup history |
| GET | `/api/v1/statistics/players` | public, optionally private | Filters: competition, season, group, team, player, match, dates |
| GET | `/api/v1/statistics/players/:id` | public, optionally private | Career/season totals plus per-registration rows |
| GET | `/api/v1/statistics/teams` | public, optionally private | Confirmed results and event card totals |
| GET | `/api/v1/statistics/matches/:id` | public, optionally private | `confirmed:false` until the result is confirmed |
| GET | `/api/v1/statistics/rankings/players` | public, optionally private | Metric: goals, appearances, cards or clean sheets |
| GET | `/api/v1/standings` | public, optionally private | Live table; `seasonId`; `groupId` when grouped |
| POST | `/api/v1/standings/calculate` | `standings.manage` | Preview only; writes nothing |
| POST | `/api/v1/standings/snapshots` | `standings.manage` | Publishes a new immutable version |
| POST | `/api/v1/standings/recalculate` | `standings.manage` | Requires `reason`; advances the version |
| GET | `/api/v1/standings/snapshots` | public, optionally private | Version history, newest first |
| GET | `/api/v1/standings/snapshots/:id` | public, optionally private | One immutable version |
| GET | `/api/v1/announcements?competitionId=` | public, optionally private | Published, non-archived; audience-filtered |
| GET | `/api/v1/announcements/manage` | `announcements.manage` | Draft/published/archived list in scope |
| POST | `/api/v1/announcements` | `announcements.manage` | Creates a draft |
| PATCH | `/api/v1/announcements/:id` | `announcements.manage` | Draft only |
| POST | `/api/v1/announcements/:id/publish` | `announcements.manage` | Publishes and notifies the audience |
| POST | `/api/v1/announcements/:id/unpublish` | `announcements.manage` | Returns to draft |
| POST | `/api/v1/announcements/:id/archive` | `announcements.manage` | Terminal archive |
| GET | `/api/v1/users` | `users.read` | Paginated, searchable, scoped user list |
| GET | `/api/v1/users/:id` | `users.read` | Account record |
| GET | `/api/v1/users/:id/roles` | `users.read` | Role assignments |
| GET | `/api/v1/users/:id/associations` | `users.read` | Captaincy, staff and official associations |
| GET | `/api/v1/users/:id/history` | `users.read` | Audit-backed history |
| POST | `/api/v1/users/:id/deactivate` | global `users.manage` | Revokes sessions |
| POST | `/api/v1/users/:id/activate` | global `users.manage` | Non-suspended accounts |
| POST | `/api/v1/users/:id/suspend` | global `users.manage` | Requires `reason`; revokes sessions |
| POST | `/api/v1/users/:id/restore` | global `users.manage` | Clears suspension |
| POST | `/api/v1/users/:id/sessions/revoke` | global `users.manage` | Revokes all sessions |
| POST | `/api/v1/users/:id/roles` | `roles.manage` | Scoped grant rules apply |
| DELETE | `/api/v1/users/:id/roles/:role?competitionId=` | `roles.manage` | Revokes one assignment |
| GET | `/api/v1/competitions/:id/administration?seasonId=` | competition manage/read | Overview counts and warnings |
| POST | `/api/v1/disputes` | `disputes.submit` / manage | Captain own-team or admin dispute |
| GET | `/api/v1/disputes` | authenticated/scoped | Private, paginated list |
| GET | `/api/v1/disputes/:id` | visible party | Detail with filtered entries |
| GET | `/api/v1/disputes/:id/history` | visible party | Audit history |
| POST | `/api/v1/disputes/:id/submit` | submitter/admin | draft → submitted |
| POST | `/api/v1/disputes/:id/reviewer` | manage | Assign an active administrator |
| POST | `/api/v1/disputes/:id/review` | reviewer/manage | submitted → under_review |
| POST | `/api/v1/disputes/:id/responses` | visible party | Response; internal flag for reviewers |
| POST | `/api/v1/disputes/:id/request-information` | reviewer/manage | under_review → awaiting_information |
| POST | `/api/v1/disputes/:id/information` | visible party | awaiting_information → under_review |
| POST | `/api/v1/disputes/:id/decision` | reviewer/manage | Records outcome; never changes results |
| POST | `/api/v1/disputes/:id/close` | reviewer/manage | decided → closed |
| POST | `/api/v1/disputes/:id/evidence` | visible + `files.read` | Raw binary upload |
| GET | `/api/v1/disputes/:id/evidence` | visible + `files.read` | Active evidence metadata |
| DELETE | `/api/v1/disputes/:id/evidence/:evidenceId?reason=` | manage/uploader | Archives evidence |
| POST | `/api/v1/disciplinary-cases` | `disciplinary.manage` | Opens a case |
| GET | `/api/v1/disciplinary-cases` | scoped/manage | Private, paginated list |
| GET | `/api/v1/disciplinary-cases/:id` | visible party | Case, entries, sanctions |
| GET | `/api/v1/disciplinary-cases/:id/history` | visible party | Audit history |
| GET | `/api/v1/disciplinary-cases/:id/sanctions` | visible party | Sanctions |
| POST | `/api/v1/disciplinary-cases/:id/reviewer` | manage | Assign reviewer; status unchanged |
| POST | `/api/v1/disciplinary-cases/:id/review` | reviewer/manage | Starts review |
| POST | `/api/v1/disciplinary-cases/:id/request-response` | reviewer/manage | Moves to awaiting_response |
| POST | `/api/v1/disciplinary-cases/:id/findings` | reviewer/manage | Records a finding |
| POST | `/api/v1/disciplinary-cases/:id/decision` | reviewer/manage | Records a decision |
| POST | `/api/v1/disciplinary-cases/:id/appeal` | subject/manage | decided → appealed |
| POST | `/api/v1/disciplinary-cases/:id/close` | reviewer/manage | Closes |
| POST | `/api/v1/disciplinary-cases/:id/notes` | reviewer/manage | Case note |
| POST | `/api/v1/disciplinary-cases/:id/responses` | subject/manage | Subject response |
| POST | `/api/v1/disciplinary-cases/:id/sanctions` | reviewer/manage | Issues a sanction |
| POST | `/api/v1/disciplinary-cases/:id/evidence` | case manager/reviewer | Raw binary upload |
| GET | `/api/v1/disciplinary-cases/:id/evidence` | case manager/reviewer | Active evidence metadata |
| DELETE | `/api/v1/disciplinary-cases/:id/evidence/:evidenceId?reason=` | case manager | Archives evidence |
| GET | `/api/v1/disciplinary/eligibility/players/:id?matchId=&at=` | permitted | Explicit eligibility check |
| GET | `/api/v1/disciplinary/eligibility/teams/:id?matchId=&at=` | permitted | Explicit eligibility check |
| GET | `/api/v1/files/:id` | `files.read` + linked visibility | Private metadata |
| GET | `/api/v1/files/:id/content` | `files.read` + linked visibility | Private content download |
| GET | `/api/v1/notifications` | authenticated | Own feed; `unreadOnly`, `type` |
| GET | `/api/v1/notifications/unread-count` | authenticated | Own unread count |
| POST | `/api/v1/notifications/:id/read` | authenticated | Own notification only |
| POST | `/api/v1/notifications/read-all` | authenticated | Marks own unread notifications |
| GET | `/api/v1/audit-logs` | `audit.read` | Scoped, filtered, paginated history |
| WS | `/ws/matches/:id` | authenticated | Bearer or allowlisted cookie Origin; match authorization |

Example login:

```bash
curl -i -X POST localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"captain@example.test","password":"..."}'
```

Then call protected routes with `Authorization: Bearer <accessToken>`.

## Visibility rules

- Public competition: `visibility = 'public'` and status in `published`, `active`, `completed`, `archived`.
- Public fixture: `published_at` set and not in the future, with a public parent competition.
- Fixture list with `competitionId`/`seasonId` verifies view or manage permission first and returns `404` for private resources; scoped administrators see unpublished fixtures in their competitions.
- Draft fixtures and unpublished fixtures are visible to the fixture manager, the assigned official and the participating captain.
- Public lineup: only `published` lineups on a public, scheduled match, after kickoff minus one hour. Postponed, cancelled and abandoned matches suppress public lineups. Draft, returned, submitted and confirmed lineups are visible only to the team captain, a scoped manager, or an assigned match official.
- Public statistics and standings: confirmed full-time results only. Public competitions are readable; private competitions require management scope, an assigned match or captaincy. Unpublished fixtures are excluded from public statistics.
- Public announcements: published, not archived, audience `public`, parent competition public or absent. Captains/officials see their audience classes in participating competitions; scoped administrators see every audience in scope. Drafts and archived announcements never appear publicly.
- Public team: has an `approved` team entry in a public, published/active/completed/archived competition. Draft entries are visible only to the owning captain and scoped administrators.
- Player registrations are always private to the owning captain and scoped administrators/reviewers.
- Private resources return `404` rather than `403` on read routes to avoid leaking existence. Write routes use `403` when the resource is known to the caller.

## Competition management request notes

- Competition slugs are lowercase, hyphen-separated and unique. Created competitions start as `draft`.
- Seasons carry an optional date range and must not end before they start.
- Groups belong to exactly one season and cannot be moved between seasons.
- A team entity is global. `team_registrations` is its season participation; a team may have at most one entry per season.
- Creating a team with `seasonId` also creates its entry. Scoped administrators must provide `seasonId` to prove scope; a super admin may create a standalone team entity.
- Captain provisioning accepts an administrator-supplied temporary password of 8–128 characters. Passwords and hashes never appear in responses.
- Player registration submissions accept either `playerId` or an inline `player` object, never both. Inline creation supports `fullName`, `department`, `dateOfBirth`, `position`, `preferredFoot` and `contactEmail`.
- The lifecycle is `submitted → under_review → approved|rejected`, plus `withdrawn` from pending states. `rejected` and `withdrawn` rows can be resubmitted without deleting history.

## Fixture and match request notes

- Fixtures reference `teamRegistrations`, not teams, so both participants always belong to the fixture season.
- API-created and generated fixtures start as `draft`; publish moves them to `scheduled` and sets `publishedAt`.
- Fixture generation accepts `seasonId`, optional `groupId` and `legs` (`1` or `2`). Preview returns the plan without writing. Commit returns `201` with `createdCount`, or `409` when nothing new can be generated.
- Lifecycle reasons are optional on fixture postpone/reschedule/cancel and on match transitions; event corrections, voids and result corrections require a `reason`.
- Match status is the period state: `scheduled`, `first_half`, `half_time`, `second_half`, `full_time` (plus `postponed`, `cancelled`, `abandoned`). `live` is accepted for compatibility.
- Match scores are never accepted as input. `POST /matches/:id/report` confirms the score derived from non-voided events.
- Clock updates are explicit; the server never derives the minute from elapsed wall-clock time.
- Event writes are idempotent on `clientEventId` per match. Reuse with a different payload is a `409`.

## Lineup, statistics and standings request notes

- A lineup belongs to one participating, approved team entry. A draft may be incomplete; `submit` and `confirm` require a supported formation, eleven starters, one goalkeeper, one starting captain, unique players/shirt numbers, coordinates matching formation slots and approved eligible registrations.
- Supported formations are `4-3-3`, `4-4-2`, `4-2-3-1`, `3-5-2`, `3-4-3`, `4-1-4-1` and `5-3-2`. `GET /lineups/formations` returns the exact slot coordinates.
- Captains may edit/submit/withdraw only their own team's lineup before kickoff. Only competition administrators confirm or return. Administrative edits after kickoff or on a confirmed lineup require `reason` and are audited.
- A lineup may contain 0–11 substitutes. `competition_rules.rules.maxSubstitutes` may lower the season limit; higher values are capped at 11.
- Statistics and live standings are derived on read. There is no editable aggregate endpoint and no background recalculation.
- Statistics omit assists and minutes played because the event model cannot derive them reliably; absent data is omitted rather than returned as zero.
- Standings use confirmed full-time results on completed fixtures, configured points and tie-breakers, then deterministic team name and registration ID. Grouped seasons require `groupId`.
- Standings snapshots are immutable versions. Publishing and recalculating require `standings.manage`; recalculation additionally requires a reason. Result submission, correction or reopening clears the current flag and audits invalidation.

## Administration and supporting-system request notes

- User lists are paginated (`limit` 1–100, default 25) and never expose passwords, hashes or tokens. Competition administrators only see users connected to their competition; `users.manage` remains global.
- Status operations are explicit: `deactivate`, `activate`, `suspend` and `restore`. Only one of active/inactive/suspended is possible. Suspension requires a reason, revokes sessions and cannot be bypassed with `activate`.
- Role grants accept `{ role, competitionId? }`. Competition administrators can grant/revoke only `team_captain` and `match_official` in their competition; only a global super administrator can grant `super_admin` or `competition_admin`. Self-assignment and system roles are rejected.
- `GET /competitions/:id/administration` is a read-only aggregate: team/player/fixture/match/lineup counts, current snapshots, pending reviews, unconfirmed results, overdue fixtures and upcoming matches without lineups. It is not a duplicate management API.
- Disciplinary and dispute records are private. Non-visible callers receive `404`; visible callers without authority receive `403`.
- Disciplinary statuses: `open`, `under_review`, `awaiting_response`, `decided`, `appealed`, `closed`. Reviewer assignment does not start review. Sanctions are `warning`, `match_suspension`, `competition_suspension` or `other`; fines do not exist. Eligibility is checked only through the explicit eligibility endpoints.
- Dispute statuses: `draft`, `submitted`, `under_review`, `awaiting_information`, `decided`, `closed`. Outcomes: `accepted`, `rejected`, `partially_accepted`, `no_action`. A decision never changes match results/events; use the Phase 5 correction flow.
- Evidence uploads use a raw binary body with `X-File-Name` and `Content-Type`; allowed types are PNG, JPEG, PDF and plain text. Filename, extension and content are validated; storage keys are server-generated. Downloads are private and authorized through the linked case/dispute.
- Announcement audiences are `public`, `participants`, `captains`, `officials` and `administrators`. Publishing notifies the resolved audience. There is no scheduling mechanism.
- Notifications are per-user in-app records with pagination, unread counts, single-read and read-all. Recipients are never accepted from clients. External email/push is not implemented.
- Audit reads require `audit.read`, are capped at `limit` 100, and sanitize `before`/`after` recursively. Scoped administrators see only their competition rows.

## WebSocket

`/ws/matches/:id` authenticates before upgrade. Messages are JSON and typed:

Client:

```json
{"type":"ping"}
{"type":"subscribe","matchId":"<uuid>"}
{"type":"unsubscribe","matchId":"<uuid>"}
```

Server:

```json
{"type":"connection.ready","matchId":"<uuid>","at":"..."}
{"type":"subscribed","matchId":"<uuid>"}
{"type":"unsubscribed","matchId":"<uuid>"}
{"type":"pong","at":"..."}
{"type":"error","code":"SUBSCRIPTION_FORBIDDEN","message":"..."}
{"type":"match.update","reason":"match.started","at":"...","match":{"matchId":"<uuid>","status":"first_half","currentMinute":0,"addedMinutes":0,"homeScore":0,"awayScore":0,"resultConfirmedAt":null},"event":{...}}
{"type":"lineup.update","reason":"lineup.confirmed","at":"...","lineup":{"id":"<uuid>","matchId":"<uuid>","teamRegistrationId":"<uuid>","formation":"4-3-3","status":"confirmed","confirmedAt":"...","players":[...]}}
```

The channel is bound to the URL match. Subscribing to another match is rejected, even if that match is otherwise readable. Every message revalidates the session; logout/logout-all/deactivation closes live connections with code `4401`.

`match.update` frames are emitted only after the database transaction commits, and only to sockets that passed match authorization. `lineup.update` is emitted only for confirmed lineups, with a sanitized roster. See `realtime.md`.

## Planned, not implemented

Automatic standings publication, scheduled announcements, external notification channels, multi-instance realtime fan-out, S3-compatible storage, full-text search ranking and cursor pagination are planned. No route returns fabricated records for them.
