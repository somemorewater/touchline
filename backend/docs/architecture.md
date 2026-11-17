# Architecture

Fastify handles HTTP, plugins and OpenAPI. Domain modules own routes, schemas and services; Drizzle/PostgreSQL owns persistence. Shared response/error helpers standardize API behavior. Errors are translated centrally from `AppError`, Zod, Fastify validation/body-parser/rate-limit/JWT failures and known PostgreSQL constraint codes into one error envelope with a stable code, HTTP status and request ID. `/health/live` is process liveness; `/health` and `/ready` check PostgreSQL readiness. Database entities use UUIDs and UTC timestamptz values. Historical records use restricted deletion or archival; audit rows have no ordinary delete endpoint.

Phase 4 adds the competition-management write model:

- `modules/competitions` — competition, season and group lifecycle.
- `modules/teams` — team entities, season participation entries and captain provisioning/assignment.
- `modules/registrations` — player registration submission, review, approval, rejection, withdrawal and history.
- `modules/admin` — super-admin account creation and competition-admin assignments.

Each module separates HTTP schemas (`schemas.ts`), route handlers (`routes.ts`) and business rules (`service.ts`). Route handlers only parse/validate input and translate results; services perform authorization, transactions and database writes.

Phase 5 adds the scheduling and match-lifecycle model:

- `modules/fixtures` — fixture CRUD, publication, postpone/reschedule/cancel, round-robin preview and transactional generation.
- `modules/matches` — period state machine, explicit clock, official assignment, event writes/corrections/voids, score derivation, result submission and audited correction.
- `modules/matches/engine.ts` — shared match scope, locking and score helpers used by both the fixture and match modules.

Fixture writes and match writes use the same fixture→match row-lock order, so scheduling never deadlocks against in-play operations. Scores are never accepted from a client: `matches.home_score`/`away_score` are recomputed from non-voided score events inside the transaction that changed them. Post-commit WebSocket frames are emitted from the services, never from inside the transaction.

Phase 6 adds the selection, reporting and table model:

- `modules/lineups` — formation catalogue, eligibility validation, draft/submit/confirm/return/withdraw lifecycle, administrative corrections and lineup history.
- `modules/statistics` — live player, team and match aggregates plus rankings derived from confirmed results, confirmed lineups and non-voided events.
- `modules/standings` — live league/group tables, deterministic tie-breaking, immutable versioned snapshots and result-driven invalidation.
- `modules/matches` — result submission, correction and reopening now invalidate current standings snapshots inside the same transaction; substitution validation consults a confirmed lineup.

Phase 7 adds the administration and supporting systems:

- `modules/users` — paginated account search, status changes, session revocation, role grants/revocations, associations and history.
- `modules/administration` — a read-only competition overview using existing counts and operational warnings.
- `modules/disciplinary` — private case lifecycle, reviewer assignment, findings, responses, sanctions, appeals, closure and explicit eligibility checks.
- `modules/disputes` — private captain/administrator dispute lifecycle with reviewer assignment, information exchange and decisions that never mutate results.
- `modules/files` — private evidence upload, validated binary storage, authorized metadata/content and archival removal.
- `modules/announcements` — draft/publish/unpublish/archive lifecycle with controlled audiences and audience notification fan-out.
- `modules/notifications` — persistent in-app notifications with server-resolved recipients and per-user read state.
- `modules/audit` — scoped, filtered, paginated and sanitized audit retrieval.
- `src/storage` — a small `StorageAdapter` abstraction with a local filesystem implementation.

Phase 7 services extend existing match, registration and lineup flows with transactional notifications and audit scope; no competing management API or duplicate workflow was introduced.

There is no statistics table, no materialised aggregate and no background recalculation worker. Statistics and live standings are SQL-derived on every read. Only published standings snapshots are stored, append-only, versioned per season/group.

## Security boundary

`src/security/` is the single authorization boundary:

- `permissions.ts` — canonical roles, dot-notation permissions, grants, descriptions and reserved permissions.
- `context.ts` — typed `AuthContext` and global/scoped permission helpers.
- `service.ts` — validates sessions/users and loads roles/permissions from the database.
- `tokens.ts` — access-token signing/verification, cookie names and duration parsing.
- `plugin.ts` — `request.auth`, authentication decorators, permission/role guards and WebSocket authentication.
- `access.ts` — competition visibility, match scope, team ownership, team/entity scope, official assignment and role-assignment guards.
- `passwords.ts` — shared Argon2id hashing for every account-provisioning path.
- `connections.ts` — process-local registry of live WebSocket connections for immediate revocation.

Authentication is not implemented per route. Routes declare `preHandler: app.authenticate`, `app.authenticateOptional` or `app.requirePermission(...)`, then call resource helpers. The trusted context is derived only from the JWT plus database state.

## Persistence

The schema establishes identity/permission, session/refresh-token, competition, team/player registration, fixture/match/event/lineup, match-official, snapshot, announcement, file and audit boundaries.

Session relationships:

- `sessions.id` is the refresh-token family ID.
- `refresh_tokens.family_id` references `sessions.id` with cascade delete.
- Access JWTs carry `sid` referencing the session.
- `user_roles.competition_id` is nullable; `NULL` is global, otherwise the assignment is scoped to that competition.

Migrations are committed under `drizzle/` and tracked by Drizzle. Migration `0001` adds sessions, match officials, the refresh-token session FK, nullable role scope and indexes, with backfills for existing refresh-token families and the old zero-UUID role scope. Migrations `0002`–`0005` add, respectively, Phase 3 integrity constraints/triggers, Phase 4 competition-management metadata, Phase 5 fixture/match-engine columns and Phase 6 lineup-review/current-snapshot columns. Migration `0006` adds Phase 7 administration tables, user suspension metadata, announcement audiences, file storage metadata, audit competition/season scope and the audit append-only trigger. Applied migrations are immutable.

## Integrity boundary

PostgreSQL enforces domain invariants in addition to referential integrity:

- Composite foreign keys keep season-scoped children consistent: a team entry's group, a player registration's team entry, a fixture's participants and group, a lineup player's team, a snapshot's group and an announcement's competition/season.
- Partial unique indexes define active-state uniqueness (one active player registration and matriculation number per season) while preserving rejected/withdrawn history.
- CHECK constraints cover vocabularies, ranges, scores, dates, formations, shirt numbers and pitch coordinates. Formation counting uses the immutable SQL function `touchline_formation_outfield_count`.
- `NULLS NOT DISTINCT` unique constraints make fixture identity and standings versions deterministic even when optional columns are `NULL`.
- Two `BEFORE` triggers cover cross-row rules that foreign keys cannot: lineup membership in a match, and event players/team membership in the same match and season.

Writes are rejected with SQLSTATE `23505`/`23503` (conflict) or `23514`/`23502`/`22003` (invalid input), which `src/app.ts` maps to the standard envelope. Constraint definitions and their rationale are in `database-schema.md`; transaction, concurrency and migration conventions are in `data-integrity.md`.

Multi-write flows use Drizzle transactions. Auth registration, session creation, refresh rotation/revocation and the security seed commit atomically; refresh rotation additionally locks the session row before deciding. Phase 4 adds transactions for team+entry creation, captain account+role+assignment provisioning, registration submission/resubmission, and registration review/approval/rejection. Team entries are locked while captain assignment changes, and player registrations are locked with `FOR UPDATE` before a decision; approval revalidates team, season, competition and uniqueness rules inside the same transaction. Offline event retries are idempotent through `(match_id, client_event_id)`. Migrations apply pending files in one transaction, and `0002`/`0003`/`0004` run read-only preflights that abort with offending rows instead of modifying history.

Phase 5 adds transactional generation (season lock), fixture lifecycle writes (fixture then match lock), match transitions, clock updates, official assignment, event create/correct/void, and result submit/correct. Each writes its audit row in the same transaction and broadcasts only after commit.

Phase 6 adds lineup creation/update/transition transactions (fixture → match → lineup locks, eligibility revalidation and audit in the same transaction) and standings snapshot publication (season row lock, version allocation, current-flag switch, snapshot insert and audit atomically). Result submission, correction and reopening clear `is_current` and append an invalidation audit in the result transaction. Snapshot history is never rewritten or deleted.

Phase 7 adds transactional account status/role changes, disciplinary and dispute lifecycle entries, evidence metadata, announcement publication plus audience notifications, and notification/audit scope on existing match and lineup operations. Account suspension/deactivation revokes sessions and closes sockets after commit. The audit append-only trigger rejects `UPDATE`/`DELETE` at the database level.


## Read model

Competitions, seasons, fixtures, matches, events, lineups and announcements are read through SQL-level visibility predicates. Public reads are still public, but draft/private records are filtered in the query rather than hidden in the client. Authorized callers receive additional records according to their scoped permissions, match-official assignments or team-captain ownership.

Lineup reads add status-aware visibility: confirmed/published lineups are public on public matches, draft/returned/submitted lineups are visible only to the owning captain, scoped managers and assigned officials. Statistics and standings reuse competition visibility (public competition, scoped manager, assigned match or captaincy) and never expose private player records.

Team visibility follows participation. Anonymous callers see a team only when it has an approved entry in a public competition. Captains see entries they own; scoped administrators see entries in competitions where they hold `teams.read` or `teams.manage`. Player registrations are never public: only the owning captain and scoped registration reviewers/administrators can read them.

Phase 7 administrative reads stay bounded and scoped: user lists filter by competition membership; competition overview counts use aggregate queries; announcements filter by published state and audience; disciplinary cases/disputes are private by default; evidence resolves the linked case/dispute; notifications always filter by the authenticated user; audit queries require a scope and a limit. No new public listing exposes drafts, private evidence or unrelated accounts.

## Competition-management workflows

Competition and season lifecycle changes are explicit action endpoints with transition maps. Archived competitions and seasons are read-only. Teams are global entities; `team_registrations` is their season-specific participation and carries the captain binding and review status. Player registrations belong to one team entry and one season, with a denormalized `season_id` kept consistent by a composite foreign key.

Captain provisioning uses an administrator-supplied temporary password, hashed with Argon2id. Account creation, the global `team_captain` grant and the team-entry binding commit in one transaction, so a failed assignment cannot leave an orphan account. No shared password, plaintext storage or email provider is used.

Registration history is stored in `audit_logs` with `entity_type = 'player_registration'`. Rejecting or withdrawing a registration never deletes the row; a later resubmission reuses the same `(player_id, team_registration_id)` row and appends an audit transition.

## Realtime

`/ws/matches/:id` authenticates during WebSocket pre-validation. `connection.ready` is sent only after authentication and match authorization. The channel is bound to the URL match; each message revalidates the session and subscription. A local connection registry closes sockets immediately on logout, logout-all or deactivation.

Phase 5 registers a connection against its authorized match and broadcasts sanitized `match.update` frames after each committed transition, clock update, event change and result change. Payloads never include actor IDs or audit reasons, and only sockets that passed match authorization are in the registry. Multi-instance deployments would need a shared revocation/broadcast bus; this phase is single-instance.

Phase 6 adds one frame type: `lineup.update`, emitted only when a lineup becomes `confirmed`. The payload is the sanitized lineup (IDs, formation, status, confirmation timestamp and roster roles/positions/shirt numbers/coordinates). Draft, returned and submitted rosters are never broadcast, and there is no standings channel. See `realtime.md`.

Phase 7 adds no WebSocket channel. Notifications and announcements are read through authenticated HTTP endpoints. No private evidence, case or dispute data is broadcast, and the process-local limitation is unchanged.

## Scheduling and match lifecycle

Fixtures use `team_registrations` as participants so a fixture can never cross seasons. The fixture status (`draft`, `scheduled`, `postponed`, `cancelled`, `completed`, `abandoned`) is separate from the match period state (`scheduled`, `first_half`, `half_time`, `second_half`, `full_time`, plus terminal states). Round-robin generation is a pure circle-method function, previewed without writes and committed under a season lock; it never deletes or overwrites existing fixtures. See `fixture-management.md`, `match-engine.md` and `match-events.md`.

## Frontend

The frontend is `frontend/`, Next.js 15/TypeScript. Its implemented service contract reads competitions, seasons, leagues, team entries, players, matches, announcements and search. API URL config is `NEXT_PUBLIC_API_BASE_URL`; credentials include cookies. Backend currently serves a subset of these read contracts.
