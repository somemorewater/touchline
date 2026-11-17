# Authorization

Authorization is centralized in `src/security/`. Routes must use the shared hooks and helpers; they must not implement ad-hoc role checks, and they must never trust roles, permissions, user IDs, team IDs or competition IDs supplied by a client.

## Roles and permissions

Roles and permissions are seeded repeatably from `src/security/permissions.ts` with `pnpm db:seed`. Dot-notation keys are the canonical vocabulary.

| Permission | visitor | registered_user | team_captain | match_official | competition_admin | super_admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `users.manage` | | | | | | ✓ |
| `users.read`, `roles.manage` | | | | | ✓ scoped | ✓ |
| `competitions.read` | | | | | ✓ scoped | ✓ |
| `competitions.create` | | | | | | ✓ |
| `competitions.update`, `competitions.publish` | | | | | ✓ scoped | ✓ |
| `teams.read`, `players.read`, `fixtures.read`, `matches.read`, `lineups.read`, `standings.read` | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `teams.manage`, `players.manage` | | | ✓ own team | | ✓ scoped | ✓ |
| `captains.manage` | | | | | ✓ scoped | ✓ |
| `registrations.review` | | | | | ✓ scoped | ✓ |
| `fixtures.manage`, `matches.manage` | | | | | ✓ scoped | ✓ |
| `matches.report` | | | | ✓ assigned match | | ✓ |
| `lineups.manage` | | | ✓ own team | ✓ assigned match | ✓ scoped | ✓ |
| `standings.manage` | | | | | ✓ scoped | ✓ |
| `officials.assign`, `disciplinary.manage`, `disputes.manage`, `audit.read` | | | | | ✓ scoped | ✓ |
| `disputes.submit` | | | ✓ own team | | ✓ scoped | ✓ |
| `announcements.manage` | | | | | ✓ scoped | ✓ |
| `files.read` | | | ✓ owned disputes | ✓ assigned disputes | ✓ scoped | ✓ |
| `files.manage` | | | | | ✓ scoped | ✓ |

`super_admin` is a true superset: a global `super_admin` passes every permission check, even if a permission row is missing from the seed. `visitor` is reserved for anonymous access and has no account grant.

Read permissions on public data do not make private data readable. Private competition/fixture/match access is gated by scoped management or scoped read permissions.

## Global versus competition-scoped grants

`user_roles.competition_id` is nullable:

- `NULL` means a **global** role assignment. Its permissions apply everywhere.
- A competition UUID means a **scoped** assignment. Its permissions apply only to resources resolved to that competition in the database.

The old all-zero UUID sentinel was removed. A foreign key to `competitions` and partial unique indexes prevent duplicate global or scoped assignments.

Role assignments are loaded from the database on every authenticated request. Client-supplied roles or scopes are ignored.

## Reusable guards

Available after the root security plugin is installed:

- `app.authenticate` — require a valid, active, non-revoked session.
- `app.authenticateOptional` — populate `request.auth` when a valid token is present; used by public reads that reveal private data to authorized callers.
- `app.authenticateWebSocket` — authenticate during WebSocket pre-validation, including the cookie Origin allowlist.
- `app.requirePermission(permission)` — require a global permission.
- `app.requireAnyPermission(...permissions)` — require at least one.
- `app.requireRole(role)` — require a global role where a role check is genuinely appropriate.

Guards throw `401 UNAUTHENTICATED` when authentication is missing/invalid and `403 FORBIDDEN` when an authenticated principal lacks a permission.

`request.auth` contains only server-derived data: user ID, session ID, email, display name, role assignments, global permissions and scoped permissions.

Resource helpers in `src/security/access.ts` enforce ownership and scope:

- `canViewCompetition` — public competition or scoped read/update/publish permission.
- `canManageCompetition` — competition administrator plus permission in that competition.
- `canReadMatch` — public match, scoped manager, assigned official, or participating team captain.
- `canReportMatch` — `matches.manage` in scope, or `matches.report` **and** an explicit `match_officials` assignment.
- `canManageTeamRegistration` — captain of that registration, or competition administrator in scope.
- `canManagePlayerRegistration` — inherits the owning team registration's captain/scope rules.
- `canManageLineup` — captain of that lineup's team, assigned match official, or competition administrator in scope.
- `canManageTeamEntity` — super administrator, or an administrator with the permission in a competition where the team has an entry.
- `canAdministerTeamRegistration` — administrative only; deliberately excludes the captain ownership path.
- `canViewTeamEntity` — captain ownership, scoped team permission, or an approved entry in a public competition.
- `isCaptainOfTeam` — database-backed captain ownership for a team entity.
- `canReviewRegistrationsIn` — competition administrator plus `registrations.review`; captains never qualify.
- `assertRoleAssignmentAllowed` — central privilege-escalation guard for future role-management routes.

Phase 7 adds user, discipline, dispute, evidence, announcement, notification and audit authority:

- `modules/users/service.ts` — `users.read` resolves a global reader or competition scopes; `users.manage` remains global and gates status changes/session revocation; role grants use `assertRoleAssignmentAllowed`. Account/role views resolve competition membership through role grants, captaincy and official assignments.
- `modules/disciplinary/access.ts` — `canManageCase` (competition `disciplinary.manage`), `canReviewCase` (manager or assigned reviewer), `canViewCase` (reviewer, creator, subject user or subject-team captain). Invisible cases return `404`; visible unauthorized operations return `403`.
- `modules/disputes/access.ts` — `canManageDispute`, `canReviewDispute`, `canViewDispute` (reviewer, submitter or referenced-team captain). Disputes are private by default and use the same `404`/`403` split.
- `modules/files/service.ts` — evidence access resolves the linked case/dispute, then requires `files.read`; removal requires case management, dispute management, or the uploader while the dispute is open.
- `modules/announcements/service.ts` — `announcements.manage` in competition scope; global announcements are super-admin only; audiences are resolved server-side.
- `modules/audit/service.ts` — global `audit.read` reads everything; scoped grants read only their competition's rows.
- `modules/notifications/service.ts` — recipients are resolved from role grants, captaincy and official assignments; endpoints always filter by `auth.userId`.

Phase 6 adds:

- `canManageCompetitionLineups` — `matches.manage` **or** `fixtures.manage` in the competition. Deliberately not `lineups.manage`, because match officials hold that permission for assigned matches.
- `canManageTeamLineup` — competition lineup manager or captain of that exact team entry.
- `canReviewLineups` — competition lineup manager only; gates confirm/return and administrative corrections. Match officials and captains never qualify.
- `standings.manage` — checked with `hasPermissionInCompetition` for snapshot publication, preview and recalculation. Competition admins hold it scoped; match officials and captains do not.
- Statistics and standings reads resolve their own scopes in `modules/statistics/eligibility.ts`: public competitions are readable publicly; private competitions require competition management, an assigned match when filtering by match, or a captaincy in that competition.

Phase 5 adds match-scoped authority in `src/modules/matches/engine.ts`:

- `canManageMatch` — `matches.manage` in the match's competition; gates result correction and confirmed-result edits.
- `canManageOfficials` — `officials.assign` or `matches.manage` in scope; gates official assignment changes.
- `requireMatchRead` / `requireMatchWrite` / `requireMatchManage` — resolve the match scope, then apply read, reporting or management authority. A caller who cannot even read the match receives `404`; a reader without write authority receives `403`.

Fixture writes accept `fixtures.manage`, `matches.manage` or `competitions.update` in competition scope. Generation, publish, postpone, reschedule and cancel all use the same check.

## Public versus private resources

Public competition: `visibility = 'public'` **and** status in `published`, `active`, `completed`, `archived`.

Public fixture: `published_at` is set and not in the future, and its season's competition is public.

Public lineup: status `published` or `confirmed`. Draft, returned and submitted lineups are visible only to a scoped lineup manager, an assigned match official, or the captain of that team.

Public statistics and standings: public competition, published fixtures only where a fixture filter applies, and confirmed full-time results. Private competitions require scoped management, an assigned match or captaincy. Player registration records are never joined into public statistics responses.

Public announcement: published, not archived, audience `public`, and either global or tied to a public competition. Competition-scoped readers see all audiences for their competition. Non-public audiences for public competitions are hidden from anonymous and ordinary users; captains/officials see `captains`/`officials`/`participants` in competitions where they participate, and scoped administrators see every audience in scope.

Evidence files are always private. Metadata/content require `files.read` plus visibility of the linked disciplinary case or dispute. File IDs do not bypass case/dispute visibility.

Disciplinary cases and disputes are private by default; there is no public listing. An assigned reviewer, the submitter/creator, the subject user or subject-team captain can view; everyone else receives `404`.

Public routes apply these filters in SQL for competitions, fixtures, matches, statistics and standings. Lineup visibility is resolved from the match scope and then applied to the match's at-most-two lineup rows, so draft rosters are never serialised to unauthorised callers.

## `403` versus `404`

- `401 UNAUTHENTICATED`: no valid session or credential.
- `403 FORBIDDEN`: an authenticated principal lacks a permission or resource scope. Reserved for operations where the resource is known to exist.
- `404 RESOURCE_NOT_FOUND`: used on current public-read routes when a private competition, fixture or match must not reveal its existence to the caller.

WebSocket authorization failures use typed error frames and close codes: `4401` session revoked, `4403` forbidden subscription, `4404` match not found/not visible.

## Privilege-escalation controls

- Registration body is strict and can only receive `registered_user`.
- Role and permission data is always loaded server-side.
- Users cannot assign roles to themselves (`assertRoleAssignmentAllowed`).
- Only a global `super_admin` can create administrator accounts, grant `super_admin` or grant `competition_admin`. Competition administrators may grant/revoke only `team_captain` and `match_official` in their permitted competition.
- Account status changes and session revocation require global `users.manage`; scoped `users.read` never implies `users.manage`.
- The last global super administrator cannot be deactivated, suspended or demoted.
- Reviewers assigned to disciplinary cases or disputes must be active administrators in that competition; assignment does not grant case-management authority beyond the assigned record.
- Administrator accounts created through the API receive either a global `super_admin` grant or explicit competition-scoped `competition_admin` grants; no wildcard scope is inferred.
- Captains manage only registrations where they are `captain_user_id`.
- A captain cannot submit, withdraw, review, approve or reject another team's registration. Administrative review also rejects the case where the reviewing administrator is the team's own captain.
- Captains cannot create/update team entities, seasons, groups or competitions.
- Officials report only for explicitly assigned matches. There is no self-assignment: an administrator cannot grant themselves official authority, and `matches.report` alone is never sufficient.
- Officials must hold an active `match_official` role that is global or scoped to the match's competition.
- Only `matches.manage` can correct a confirmed result or edit/void an event after confirmation; an assigned official cannot.
- Captains can read their team's fixtures, matches and events but never report, confirm or correct a result.
- Captains can create/edit/submit/withdraw only their own team's lineup before kickoff. They cannot confirm or return any lineup, including their own, and cannot edit a submitted or confirmed lineup.
- Match officials can read all lineups for assigned matches but cannot confirm, return, correct or withdraw them, and do not receive `standings.manage`.
- Administrative lineup corrections require competition scope plus an explicit reason; corrections after kickoff or on a confirmed lineup are audited.
- Standings publication/recalculation requires `standings.manage` in scope; a lineup manager without that permission receives `403`, not implicit authority.
- Statistics and standings never expose registration review notes, contact details or other private player fields.
- Fixture generation and lifecycle changes are limited to the fixture manager in competition scope.
- Competition administrators act only within their scoped competition; database-derived scope, not request claims, decides access.
- Account deactivation and session revocation take effect on the next request.

- Captains may submit disputes only for their own team entry and only about matches their team played; they cannot decide or close disputes.
- Dispute decisions never mutate match results or events; result changes require the separate Phase 5 correction authority.
- Captains and officials can read evidence for disputes they can see; `files.manage` evidence removal stays administrative (or the uploader while a dispute is open).
- Announcement audiences are resolved from server-side relationships; clients cannot name recipients, and only a super administrator can manage global announcements.
- Notifications are always filtered by the authenticated user; recipient IDs are never accepted from clients.
- Audit reads are scoped by competition; unattributed rows are global-reader only.

## Integration rules for new modules

1. Use `app.authenticate`/`app.authenticateOptional`; never parse JWTs in a route.
2. Use a permission guard plus a resource helper. Route access alone does not authorize every record.
3. Resolve competition scope from the database (season → competition), not from request parameters.
4. Filter private data at the SQL/service layer.
5. Use `403` for known-resource permission failures and `404` when existence must be hidden.
6. Add new permissions to the catalog and seed, then document them.
7. Add real database tests for new ownership and scope rules.

## Reserved permissions

`users.*`, `roles.manage`, `competitions.create`, `fixtures.manage`, `matches.manage`, `matches.report`, `officials.assign`, `disciplinary.manage`, `disputes.manage`, `disputes.submit`, `announcements.manage`, `files.read`, `files.manage`, `audit.read`, `lineups.manage` and `standings.manage` are enforced by the reusable layer. Competition/season/group/team/captain/player-registration, fixture/match/event/result, lineup, standings, user/role administration, disciplinary, dispute, evidence, announcement, notification and audit-read workflows exist.

## Public versus private fixtures and matches

- Public fixture: `published_at` set and not in the future, with a public parent competition. Postponed, cancelled and completed fixtures remain readable once published.
- Public match: the parent fixture is public. Live scores and non-voided events are public; voided events and audit reasons are not.
- Owner/manager/official paths bypass the public filter through database joins, never through client claims.
- A fixture list filtered by `competitionId` or `seasonId` checks read/manage permission first and returns `404` instead of an empty or filtered list that would confirm the resource exists.

