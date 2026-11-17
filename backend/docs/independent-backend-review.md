# TOUCHLINE Backend — Independent Engineering Audit

- **Audit date:** 2026-11-15
- **Scope:** `backend/` in the TOUCHLINE working tree
- **Review type:** Independent implementation, security, database and API audit
- **Runtime used for verification:** Node.js 24.21.0, pnpm 12.6.0, PostgreSQL 16 (ephemeral Docker container)
- **Git revision:** No Git metadata was present in the workspace; the audit is against the working tree as presented.
- **Source changes during audit:** No source file was edited. Migration generation was performed in a `/tmp` copy of the backend. Temporary build artifacts and an empty Drizzle journal created by verification commands were removed afterwards.

---

## A. Executive Summary

### Overall verdict

**NOT APPROVED.**

The repository is not a completed backend. It is a thin, read-only Fastify skeleton with a relational schema and a partially functional authentication slice. Its own README states that the write workflows described in the brief "remain planned, not represented as finished" (`backend/README.md:23`). That admission is consistent with the source: the entire backend is approximately **241 lines of TypeScript**, with **four domain modules**, **15 HTTP endpoints**, **one WebSocket stub**, **no committed migrations**, **no tests**, and **no permission enforcement**.

The strongest part of the implementation is the basic authentication primitive: Argon2id is used, refresh tokens are random and stored only as SHA-256 hashes, refresh-token rotation exists, and sequential refresh-token reuse revokes the token family. Those controls are real and were verified. Almost everything else required by the brief is either absent or unenforced.

### Implementation completeness

| Area | Actual state |
|---|---|
| Authentication | Partial: register/login/refresh/logout/me exist; password reset, email verification, logout-all, session listing and revocation do not |
| Authorization | Absent: no route or service checks permissions; read routes return draft/private records |
| Competitions | Read-only list/detail/seasons/groups; no creation, season management, rules editing or registration windows |
| Teams | Schema only; no team list, detail, registration, approval, membership or transfer endpoints |
| Players | Schema only; no player list, detail, registration, approval, transfer or eligibility endpoints |
| Fixtures | Read-only list; no generation, preview, publishing, rescheduling, postponement, cancellation or constraints |
| Match engine | No write path, state machine, official assignment, event validation, score derivation, confirmation, correction or audit |
| Lineups | Read-only; no write path, formation validation, eligibility service, starting-XI/subs enforcement or approval |
| Standings | No calculation service or endpoint; only an unvalidated JSON snapshot table |
| Disciplinary | No tables and no endpoints; only unused permission keys |
| Disputes | No tables and no endpoints; only unused permission strings |
| Realtime | Unauthenticated WebSocket stub that emits one `connection.ready` message; no subscriptions, authorization or broadcasts |
| Offline sync | Unique `(match_id, client_event_id)` key exists; no write endpoint, idempotent response, ordering or conflict handling |
| File storage | Metadata table only; no adapter, upload/download route, MIME/size validation or private-access control |
| Audit logging | Table only; no writes, no endpoint, no immutability enforcement |
| Documentation | Extensive and candid about missing work, but some claims are inaccurate and OpenAPI is empty of schemas/security |
| Build / deployment | `pnpm typecheck` and `pnpm build` fail; the start path has no reliable build output; no migrations are committed |
| Tests / quality gates | No test files, no test script, no lint script, no CI configuration |

### Architecture quality

The intended architecture was a modular monolith. What exists is a **monolith shell**, not a modular monolith with separated responsibilities:

- Only the auth module has a service (`src/modules/auth/service.ts`). The competitions, matches and announcements modules execute Drizzle queries directly inside route handlers (`src/modules/competitions/routes.ts`, `src/modules/matches/routes.ts`, `src/modules/announcements/routes.ts`).
- There is no repository layer, no domain/service layer for the domain modules, no dependency injection, and no shared authorization/permission service.
- Shared utilities are limited to `AppError`/factories and an `ok()` response helper (`src/shared/errors.ts`, `src/shared/response.ts`).
- The database schema is imported directly by every module; this is not inherently wrong for a small Drizzle application, but it means schema changes ripple everywhere and there is no transaction/domain boundary.
- No circular dependency was observed; the small module graph is acyclic.
- Configuration is parsed with Zod, but `.env` is not loaded and service/route code bypasses the validated `env` object for token lifetimes and cookie security (`src/config/env.ts:2-3`, `src/modules/auth/service.ts:22,24,37`, `src/modules/auth/routes.ts:3,5,6`).
- TypeScript strictness is enabled (`tsconfig.json:3-6`), but the build is broken because `tsconfig.json:8` includes `drizzle.config.ts` while `rootDir` is `src` (`tsconfig.json:4`).
- Error handling and logging are global but incorrect for expected 4xx failures; expected validation, authentication and rate-limit errors are converted to `500` (`src/app.ts:41-69`).
- Graceful shutdown is implemented (`src/server.ts:4`, `src/app.ts:107-109`), and the health endpoint actually probes the database (`src/app.ts:70-88`).
- The schema can support additional competitions and seasons through foreign keys, but the application cannot support the intended workflows without adding service layers, authorization, transactions, validation, migrations and tests. Adding competitions is feasible; adding a correct match engine, registration workflow, standings and disciplinary system is not a small extension of the current code.

### Security posture

Authentication fundamentals are mixed-positive:

- **Positive:** Argon2id hashing; observed hash parameters `$argon2id$v=19$m=65536,t=3,p=4`. Minimum password length is 12 (`src/modules/auth/routes.ts:2`). Registration strips/inhibits role self-assignment: a request containing `role: "super_admin"` created a user with only `registered_user` (verified).
- **Positive:** Refresh tokens are 48 random bytes, stored only as SHA-256 hashes, rotated on use, and sequential reuse revokes the family (`src/modules/auth/service.ts:8,23-24,27-39`).
- **Negative:** There is no authorization layer at all. Every current read endpoint is public, including draft/private competitions, unpublished fixtures and draft lineups.
- **Negative:** Logout does not revoke access tokens; a deactivated user's existing access token continued to work. There is no logout-all or session revocation.
- **Negative:** The WebSocket endpoint accepts unauthenticated connections and does not authorize subscriptions.
- **Negative:** Expected client errors (validation, missing/invalid JWT, malformed JSON, oversized body, rate limit) are returned as `500`.
- **Negative:** Login is vulnerable to account enumeration through a large timing difference and through registration's `409 EMAIL_EXISTS`.
- **Negative:** No password reset, email verification or account lockout exists.

### Database integrity

The schema is a reasonable relational foundation: UUID primary keys, `timestamptz` timestamps, foreign keys, `ON DELETE restrict` on historical entities, and several useful unique indexes (team per season, lineup per match/team, event client ID per match). Those positives are real and were verified.

However, the database is **not a reliable integrity boundary**:

- No migrations are committed. `pnpm db:migrate` against an empty database exited 0 and created **zero tables**, because the migrator found no migration files. This is a silent deployment failure.
- There are no `CHECK` constraints anywhere. Negative scores, negative match minutes, arbitrary event types, arbitrary lineup roles, coordinates outside 0–100 and multiple captains are all accepted.
- A player can be registered to multiple team registrations in the same season, including with the same matriculation number. The unique index is scoped to one team entry, not to a season.
- Duplicate fixtures, self-fixtures, cross-season fixtures and fixtures assigned to a group from another season are accepted.
- Match events can reference a player registration from a different team than the event team, with no validation.
- Lineup players can belong to the opposing team; lineup roles are free text; coordinate range is unconstrained.
- `user_roles.competition_id` is a non-null UUID with a magic all-zero default and no foreign key.
- Deleting a competition group silently sets historical fixture/team-registration group references to `NULL`.
- There is no transaction or row locking anywhere. Registration and refresh-token rotation have real race failures, demonstrated below.

### API readiness

Not ready for frontend integration. The frontend currently runs entirely on mock services (`frontend/src/services/index.ts:8`), and the real API client is unused. Even if it were wired up, the backend is missing the endpoints and shapes required by the existing frontend contracts:

- No `/leagues`, `/teams`, `/teams/:id`, `/players`, `/players/:id`, `/search`, `/standings` or `/news/:id`.
- Competition, season, match, event, lineup, announcement, user and audit shapes do not match the frontend types.
- Match statuses use underscores (`first_half`) while the frontend uses hyphens (`first-half`).
- Match events use `eventType`/`playerRegistrationId`; the frontend expects a discriminated union with `type`/`playerId` and `syncState`.
- Lineup coordinates are returned as strings from PostgreSQL `numeric`, not numbers.
- The frontend's `apiRequest` does not attach a bearer token, while `/auth/me` requires `Authorization: Bearer` and returns `500` when it is absent.
- `NEXT_PUBLIC_API_BASE_URL` is unset in the frontend environment files.

### Production readiness

**Not production ready.** The build fails, migrations are absent, there are no tests, no authorization, no match engine, no standings, no disciplinary/dispute systems, no file storage and no audit writes. The README's own statement that most workflows remain planned confirms that the brief has not been implemented.

### Top blockers

1. Build/typecheck failure and a silent no-op migration path.
2. No authorization or permission enforcement; private/draft data is publicly readable.
3. No committed migrations or schema integrity constraints.
4. No match engine, fixture generation, standings, lineups writes, disciplinary or dispute systems.
5. No access-token revocation; logout/deactivation does not end sessions.
6. Expected 4xx errors returned as 500, including unauthenticated access to `/auth/me`.
7. API shapes and endpoint coverage incompatible with the frontend.
8. No tests, no lint, no CI.

---

## B. Requirement Coverage

| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| Authentication | **PARTIAL** | `src/modules/auth/routes.ts:2-8`, `src/modules/auth/service.ts:8-40`; bind-mounted PostgreSQL verification | Argon2id, hashed rotating refresh tokens, family reuse detection and basic `/me` work. Missing password reset, email verification, logout-all, session listing/revocation, CSRF token and lockout. Access tokens survive logout/deactivation. Expected auth errors return 500. |
| Authorization | **FAIL** | `src/app.ts:89-97`; `src/modules/competitions/routes.ts:7-10`; `src/modules/matches/routes.ts:7-10`; `src/modules/announcements/routes.ts:2`; `docs/authorization.md` | No route or service checks roles/permissions. Only `/auth/me` is protected. Role/permission tables are seeded but never queried by request handling. Draft/private competitions, unpublished fixtures and draft lineups are public. |
| Competitions | **PARTIAL** | `src/modules/competitions/routes.ts:7-10`; `src/database/schema/index.ts:11-14`; `docs/competitions.md:3` | Read-only list/detail/seasons/groups. No create/update, season lifecycle, rules editing, registration periods, structure validation or visibility filtering. |
| Teams | **FAIL** | `src/database/schema/index.ts:15-16`; no team module files | Only `teams` and `team_registrations` tables. No list/detail/registration/approval/membership/transfer endpoints. Match detail embeds team names but there is no team service. |
| Players | **FAIL** | `src/database/schema/index.ts:17-18`; no player module files | Only tables. No player list/detail/registration/approval/transfer endpoints and no eligibility service. |
| Fixtures | **FAIL** | `src/modules/matches/routes.ts:7`; `src/database/schema/index.ts:19`; `docs/competitions.md:3` | A public `GET /fixtures?seasonId=` exists, but there is no round-robin/knockout generation, preview/publish workflow, rescheduling, postponement, cancellation, duplicate prevention or venue/rest constraints. Duplicate/self/cross-season fixtures are accepted by the schema. |
| Match engine | **FAIL** | `src/modules/matches/routes.ts:8-10`; `src/database/schema/index.ts:20-21`; `docs/matches.md:3-5` | Read-only match/event/lineup endpoints. No event writes, state transitions, official assignments, score calculation, own-goal attribution, transactional score updates, confirmation, correction or audit. Scores are freely writable at DB level and can be negative. |
| Lineups | **FAIL** | `src/modules/matches/routes.ts:10`; `src/database/schema/index.ts:22-23`; `docs/lineups.md` | Read-only. No creation/update/approval. Eligibility is not enforced; the schema permits players from another team, arbitrary roles, multiple captains, coordinates outside 0–100 and unlimited starters/subs. |
| Standings | **FAIL** | `src/database/schema/index.ts:24`; no standings module | Only an unvalidated `standings_snapshots` JSON table. No calculation, confirmed-result filtering, tie-break logic, group tables, correction rebuild or endpoint. The frontend computes standings client-side from mock data. |
| Disciplinary | **FAIL** | No tables/modules; only permission keys in `src/database/seed/run.ts:2` | No bookings/suspensions tables, no case workflow, no second-yellow/red handling, no suspension expiry/appeals, no eligibility enforcement. |
| Disputes | **FAIL** | No tables/modules; only permission keys in `src/database/seed/run.ts:2` | No protests, evidence, review, decision, internal notes, history or access control. |
| Realtime | **FAIL** | `src/app.ts:98-106`; `docs/realtime.md` | Unauthenticated `/ws/matches/:id` sends one `connection.ready` message. No authentication, subscription authorization, event broadcast, post-commit ordering, disconnect handling, reconnection recovery or heartbeat. |
| Offline sync | **FAIL** | `src/database/schema/index.ts:21`; `docs/offline-sync.md` | Unique `(match_id, client_event_id)` is a useful foundation, but there is no write endpoint, no accepted/already-processed/conflict response, no ordering validation and no official-assignment check. A naive insert would surface a duplicate as a 500. |
| File storage | **FAIL** | `src/database/schema/index.ts:27`; `docs/file-storage.md` | Metadata table only. No storage adapter, upload/download route, MIME sniffing, size enforcement, private access control, signed URL or deletion policy. |
| Audit logging | **FAIL** | `src/database/schema/index.ts:26`; no usage in `src/` | Table exists but is never written to, has no route and no immutability trigger. Auth events, approvals, result corrections and disciplinary decisions are not audited. |
| Documentation | **PARTIAL** | `backend/docs/*.md`, `backend/README.md:23` | Documentation is unusually candid about missing features and is useful. However, it claims events are immutable and that historical event deletion is restricted, which is not enforced; deployment instructions assume migrations that do not exist; OpenAPI documentation has no schemas/security. |
| Build / typecheck | **FAIL** | `tsconfig.json:4,8`; `package.json:6-14` | `pnpm typecheck` and `pnpm build` fail with TS6059. After generated output was removed, `pnpm start` failed because `dist/server.js` was absent; `tsc` may emit files despite the failed exit code, but that output is not a supported release artifact. |
| Database migrations | **FAIL** | `drizzle/` contains only `README.md`; `src/database/migrate.ts:3` | No SQL migrations or journal are committed. `pnpm db:migrate` on an empty database exited 0 and created no tables. |
| OpenAPI contract | **PARTIAL** | `src/app.ts:30-40`; `/docs/json` | 15 paths are generated, but `components.schemas` is empty, no security schemes exist, request bodies/responses/query parameters are undocumented, and every operation only declares a `200` default response. |
| Frontend integration | **FAIL** | `frontend/src/services/index.ts:8`; `frontend/src/services/contracts.ts:30-101`; `frontend/src/types/*` | Mock services remain the active implementation. Missing endpoints and incompatible shapes prevent replacing the mock with the backend. |
| Error contract | **FAIL** | `src/app.ts:41-69`; `src/modules/auth/routes.ts:8` | Validation, JWT, malformed JSON, 413, 429 and invalid-UUID failures return 500. Fastify's default 404 shape differs from the documented `{success:false,error:{...}}` shape. |
| Configuration | **PARTIAL** | `src/config/env.ts:2-3`; `src/modules/auth/service.ts:22,24,37`; `src/modules/auth/routes.ts:3,5,6` | Zod validates some environment variables, but `.env` is never loaded and token/cookie code reads `process.env` directly, bypassing validation. |
| Performance | **PARTIAL** | `src/modules/matches/routes.ts:8-10`; `src/modules/competitions/routes.ts:7-10` | No pagination, no query limits, no projections; sequential N+1 queries in match detail and lineups; announcements are fetched then filtered in JS. |
| Graceful shutdown | **PASS** | `src/server.ts:4`; `src/app.ts:107-109` | SIGINT/SIGTERM close the Fastify app and end the postgres.js pool. Not load-tested. |
| Health check | **PASS** | `src/app.ts:70-88` | Executes `select 1`; returned 200 with database up and 503 with database down. |
| Seed | **PASS** | `src/database/seed/run.ts:2-3` | Idempotent; verified 6 roles, 24 permissions, 28 grants after two runs. Competitions/teams intentionally not seeded. |
| Tests | **FAIL** | No `*.test.*`/`*.spec.*` files; `package.json:31-36` | Vitest is declared but unused. `pnpm test` produced no output and ran nothing. `pnpm lint` fails because no lint script exists. |

**Coverage summary:** none of the 16 core requirement rows is fully satisfied. Authentication, Competitions and Documentation are partial (3); the other 13 are failures.

---

## C. Detailed Findings

### Critical

#### CRIT-01 — The build, start and migration path is non-functional

- **Severity:** CRITICAL
- **Module:** build / database / deployment
- **Files:** `tsconfig.json:4,8`, `package.json:6-14`, `drizzle/README.md`, `src/database/migrate.ts:3`
- **What is wrong:** The project cannot be built or started from a clean checkout, and the documented migration command silently succeeds without creating any schema.
- **Evidence:**
  - `pnpm typecheck` exits 2:
    `error TS6059: File '.../drizzle.config.ts' is not under 'rootDir' '.../src'.`
  - `pnpm build` exits 2 with the same error.
  - After cleanup, `pnpm start` exits 1 because `dist/server.js` does not exist. (`tsc` may emit files despite its error exit, so relying on the emitted `dist/` is unsafe and unsupported.)
  - `drizzle/` contains only `README.md`; there are no `.sql` files and no `drizzle/meta/_journal.json` in the repository.
  - Running `pnpm db:migrate` against a freshly created `touchline_empty` database printed no error, exited 0, and `\dt` reported “Did not find any relations.” In other words, a fresh deployment believes migration succeeded while the database is empty.
  - Schema SQL generation does work when run manually in a temporary copy: `drizzle-kit generate` produced `0000_big_ironclad.sql`, so the schema itself is syntactically viable. It is simply not committed or enforced by the migration command.
- **Impact:** A production deployment cannot build; if the build is fixed independently, a fresh database remains empty and every domain request fails. The silent exit-0 behavior hides the failure from deployment automation. This is a release blocker independent of the missing business features.
- **Recommended fix:** Split the Drizzle config out of the application `tsconfig` (or add a separate `tsconfig.build.json`), commit the generated migration and journal, and make `db:migrate` assert that expected tables exist after migration. Add CI that runs install, typecheck, build, migration against a disposable PostgreSQL instance, and a smoke test.

#### CRIT-02 — Authorization is entirely absent and non-public data is exposed

- **Severity:** CRITICAL
- **Module:** authorization / competitions / matches / announcements
- **Files:** `src/app.ts:89-97`, `src/modules/competitions/routes.ts:7-10`, `src/modules/matches/routes.ts:7-10`, `src/modules/announcements/routes.ts:2`, `src/database/seed/run.ts:2`, `docs/authorization.md`
- **What is wrong:** There is no authentication or permission check on any read route except `GET /auth/me`. The seeded roles, permissions, role-permissions and user-roles tables are never consulted by request handling. There is no ownership check, competition scoping, visibility filter or publication filter.
- **Evidence:**
  - Every route is registered with a plain handler; only `/auth/me` has a `preHandler` (`src/modules/auth/routes.ts:8`).
  - With only the seed data plus test rows, `GET /api/v1/competitions` returned a competition with `status: "draft"` and `visibility: "private"`.
  - `GET /api/v1/fixtures?seasonId=...` returned fixtures with `publishedAt: null`.
  - `GET /api/v1/matches/:id/lineups` returned a lineup with `status: "draft"` and its players.
  - The authorization document itself states: “A centralized permission enforcement layer and ownership checks must be completed before adding privileged mutation routes.”
- **Impact:** Visitors can read data that was intended to be private or unpublished: draft/private competitions, draft fixtures and draft lineups. More importantly, there is no authorization foundation for the intended write surface. When registration approval, match reporting, result confirmation, disciplinary decisions or dispute review are added, every one of them will be unprotected unless the design is changed first.
- **Recommended fix:** Add a central authentication decorator and permission guard that loads the authenticated user, resolves roles/permissions from the database (with competition scope), and enforces them per route and per resource. Add explicit visibility/publication filters to all public reads. Add ownership checks for captain/team operations and resource scoping for competition administrators. Add authorization tests for every role and cross-resource scenario.

### High

#### HIGH-01 — Database invariants are not enforced; corrupt records are accepted

- **Severity:** HIGH
- **Module:** database / competitions / teams / players / fixtures / matches / lineups
- **Files:** `src/database/schema/index.ts:16-24`
- **What is wrong:** The schema contains useful foreign keys and a few unique indexes, but it does not enforce the invariants the business rules depend on. There are no `CHECK` constraints, no composite foreign keys for season/group/team consistency, and several uniqueness constraints are scoped incorrectly.
- **Evidence (all inserts/updates accepted by PostgreSQL 16 against the generated schema):**
  - A player (`Player One`) was registered to two different team registrations in the same season, with the same matriculation number `MAT-001`. Both rows were accepted, although the same player should not be able to represent conflicting teams.
  - A duplicate fixture with the same season, group, home team, away team and round was accepted.
  - A fixture with `home_team_registration_id = away_team_registration_id` (self-match) was accepted.
  - A fixture whose `season_id` was S1 but whose away team registration belonged to S2 was accepted.
  - A fixture whose group belonged to S2 but whose season was S1 was accepted.
  - A team registration was updated to a group belonging to another season.
  - `matches.home_score = -5, away_score = -2` was accepted and later returned by the API.
  - A match event with `event_type = 'not-a-football-event'`, `minute = -42`, and a player registration from the opposing team was accepted.
  - A lineup player from the opposing team was accepted; a lineup role `'wizard'` and coordinates `x=999, y=-50` were accepted; two players were marked captain.
  - Two identical standings snapshots for the same season/group were accepted.
  - `CAPTAIN@EXAMPLE.TEST` was accepted as a second user while `captain@example.test` already existed, because the unique index is case-sensitive.
  - A `user_roles` row was accepted with `competition_id = 'deadbeef-dead-beef-dead-beefdeadbeef'` although no such competition exists.
- **Working constraints (for balance):** Team per season, lineup per match/team, lineup player per lineup, and match event client ID per match are correctly rejected by unique indexes. `ON DELETE restrict` correctly blocked deleting a team or season referenced by history.
- **Impact:** The database can hold contradictory competition, fixture, match and lineup data. Once write endpoints exist, application bugs or concurrent requests will create records that cannot be safely used by standings, eligibility or disciplinary logic. The missing season/group/team consistency is especially dangerous because it can make a fixture appear in the wrong competition or a team appear in the wrong group.
- **Recommended fix:** Add explicit check constraints (scores >= 0, minute range, coordinates 0–100, shirt-number range, home != away, points non-negative), composite foreign keys for `(group_id, season_id)` and `(team_registration_id, season_id)`, a unique fixture key (season, home, away, round), a season-scoped player registration uniqueness rule, and validation of event/lineup cross-entity relationships. Prefer database constraints plus service validation, not service validation alone.

#### HIGH-02 — The match engine does not exist

- **Severity:** HIGH
- **Module:** matches
- **Files:** `src/modules/matches/routes.ts:8-10`, `src/database/schema/index.ts:20-21`, `docs/matches.md:3-5`
- **What is wrong:** The “match engine” is a read-only endpoint. There is no route to start a match, change status, create events, confirm a result or correct a result. There is no state machine, no official-assignment table, no event validation, no score derivation and no audit of corrections. Scores are stored directly on `matches` with no relationship to events.
- **Evidence:**
  - The match module contains only `GET /matches/:id`, `GET /matches/:id/events` and `GET /matches/:id/lineups` (`src/modules/matches/routes.ts:8-10`).
  - `matches` stores `home_score`/`away_score` with defaults of 0, plus a free-form status enum; there is no `match_officials` table.
  - A negative score inserted directly into the database was returned by `GET /matches/:id`.
  - No `db.transaction` or score-update code exists anywhere in `src/`.
  - The documentation states that “Match writes, valid status transitions, event transactional score updates, official assignments, confirmation/correction and broadcasts are pending.”
- **Impact:** The core business function of the product cannot be performed. There is no way to report a goal, card or substitution; no way to confirm a result; no way to correct a result with a reason; and no way to prove who changed what. A stored score cannot be trusted because it is not derived from events and is not tied to an authorized official.
- **Recommended fix:** Implement a match service with an explicit state machine and transition table; assign officials to matches; validate event type/minute/player/team against the match and lineup; derive scores from confirmed goal/own-goal events inside a single transaction with row locking; require an assigned official for reporting; require a reason and audit record for confirmation/correction; reject writes after confirmation except through a correction workflow.

#### HIGH-03 — Fixture generation and scheduling are absent

- **Severity:** HIGH
- **Module:** fixtures / competitions
- **Files:** `src/modules/matches/routes.ts:7`, `src/database/schema/index.ts:19`, `docs/competitions.md:3`
- **What is wrong:** There is no fixture-generation implementation at all. The only fixture endpoint is an unbounded public read. There is no round-robin or group scheduling, no home/away assignment, no knockout bracket, no preview/publish, no rescheduling, postponement or cancellation, no rest-period/venue constraint and no duplicate prevention.
- **Evidence:**
  - `GET /fixtures?seasonId=` is the only fixture route (`src/modules/matches/routes.ts:7`).
  - The schema has no unique fixture constraint; duplicate, self and cross-season fixtures were accepted (HIGH-01).
  - `publishedAt` exists but the read endpoint does not filter on it; unpublished fixtures were returned.
  - The frontend's fixture generation is mock/client-side; no backend implementation exists.
- **Impact:** Administrators cannot create a valid schedule. If fixtures are inserted manually, duplicates and invalid pairings are possible, and draft fixtures leak to the public. “Round-robin scheduling” and “knockout scheduling” from the brief are not implemented.
- **Recommended fix:** Implement a scheduling service that supports configured formats, group membership, odd team counts, byes, double round-robin, home/away balance, duplicate detection, rest constraints and venue constraints. Store a preview/draft state, publish atomically, and support reschedule/postpone/cancel with audit records. Add a database uniqueness constraint for the same pairing/round and validate that both registrations belong to the fixture season.

#### HIGH-04 — Lineups are read-only and eligibility is unenforced

- **Severity:** HIGH
- **Module:** lineups / players
- **Files:** `src/modules/matches/routes.ts:10`, `src/database/schema/index.ts:22-23`, `docs/lineups.md`
- **What is wrong:** There is no lineup write path, no eligibility service and no formation/starting-XI/substitute validation. The schema allows a player registration from an opposing team, arbitrary roles, arbitrary coordinates and multiple captains.
- **Evidence:**
  - Only `GET /matches/:id/lineups` exists (`src/modules/matches/routes.ts:10`).
  - Direct inserts accepted a player from the opposing team, role `'wizard'`, `x=999`, `y=-50`, and two `is_captain = true` rows. The API returned these values (`x`/`y` as strings `"999.00"` and `"-50.00"`).
  - No code checks `player_registrations.status`, `eligibility_approved`, team registration membership, suspension, registration window or duplicate selection.
  - The documentation admits that eligibility validation, formation templates, squad rules, writes and approval remain to be implemented.
- **Impact:** A captain or official could select ineligible, suspended or opposing players if a write endpoint is added without a central service. Formation and squad rules cannot be trusted. The client-side formation/eligibility helpers in the frontend are not a security boundary.
- **Recommended fix:** Create a centralized eligibility service used by every lineup write path. Validate approved/eligible registration, same team and season, not suspended, no duplicate player, valid formation, starting XI/substitute limits, one captain, shirt-number uniqueness and coordinate range. Enforce the core cross-entity checks in the database where possible and add lineup approval with audit.

#### HIGH-05 — Standings and statistics are not implemented

- **Severity:** HIGH
- **Module:** standings / statistics
- **Files:** `src/database/schema/index.ts:24`, no standings/statistics module
- **What is wrong:** Standings are not calculated or served by the backend. There is only a `standings_snapshots` table containing unvalidated JSON. There is no confirmed-result filter, no points/tie-break logic, no group-specific table, no recalculation after correction and no statistics service for goals, assists, appearances, cards, clean sheets or minutes.
- **Evidence:**
  - No route in `src/` references `standingsSnapshots`.
  - The table has no unique constraint on `(season_id, group_id)`; duplicate snapshots were accepted.
  - The frontend computes standings client-side from mock matches (`frontend/src/features/standings/lib/computeStandings.ts`) and filters matches itself.
  - The documentation says the confirmed-result-only calculation/rebuild workflow is not implemented.
- **Impact:** The public standings page cannot be backed by the API. If snapshots are written manually, they can disagree with match results, include unconfirmed results, or contain malformed rows. There is no way to prove that a result correction was reflected in standings.
- **Recommended fix:** Implement a standings service that reads only confirmed results, applies configured points and ordered tie-breakers, scopes by season/group, and rebuilds transactionally after confirmation/correction. Prefer derived queries or versioned snapshots with a unique `(season_id, group_id, version)` key. Implement statistics from immutable match events and lineups, with explicit “unknown” semantics rather than forcing zero.

#### HIGH-06 — Disciplinary and dispute systems are completely absent

- **Severity:** HIGH
- **Module:** disciplinary / disputes
- **Files:** `src/database/seed/run.ts:2`; no tables or modules
- **What is wrong:** The schema has no disciplinary cases, suspensions, appeals, protests, dispute evidence or internal notes. The only trace of these features is a list of permission keys in the seed that no code enforces.
- **Evidence:**
  - `find src` shows no disciplinary or dispute module.
  - The schema has no `suspensions`, `disciplinary_cases`, `protests`, `dispute_evidence` or `dispute_notes` tables.
  - Seed permissions include `disciplinary:manage`, `dispute:create`, `dispute:review` and `dispute:resolve`, but no route consumes them.
- **Impact:** Booking accumulation, second-yellow/red handling, suspension creation/expiry, appeals, evidence access, review decisions and dispute history are impossible. Unused permission strings create a false impression that the features exist.
- **Recommended fix:** Add explicit case/suspension/protest/evidence tables with state transitions and history; implement captain submission, official/admin review, private evidence access, internal notes separated from public decisions, decision records with reasons, and audit logging. Enforce suspension eligibility in the centralized eligibility service.

#### HIGH-07 — Audit logging is a table with no writes

- **Severity:** HIGH
- **Module:** audit
- **Files:** `src/database/schema/index.ts:26`, no audit service
- **What is wrong:** `audit_logs` exists but is never written to. There is no audit endpoint, no actor/request capture, no immutability trigger and no audit of authentication, approvals, result confirmations or disciplinary decisions.
- **Evidence:**
  - `grep` for `auditLogs` finds only the schema definition; no module imports it.
  - The table has `before`/`after` JSON and `reason`, but nothing enforces that a reason is supplied or that rows cannot be updated/deleted.
  - `docs/architecture.md` states “audit rows have no ordinary delete endpoint”, which is true only because no endpoint exists; the database still permits direct updates/deletes.
- **Impact:** Confirmed results, registration approvals and disciplinary decisions cannot be reconstructed. The brief explicitly requires audit history for corrections; that requirement is unmet.
- **Recommended fix:** Add an audit service called inside the same transaction as every privileged mutation, capturing actor, action, entity, before/after, reason and request ID. Add a read endpoint restricted to `audit:read`. Protect audit rows with database privileges or triggers that reject updates/deletes.

#### HIGH-08 — Registration and competition workflows are read-only

- **Severity:** HIGH
- **Module:** competitions / teams / players
- **Files:** `src/modules/competitions/routes.ts:7-10`, `src/database/schema/index.ts:11-18`
- **What is wrong:** Competition creation, season management, group management, team registration, team approval, player registration, player approval, membership, transfers, registration windows and roster locking have no endpoints or services.
- **Evidence:**
  - The competition module only lists competitions, gets one, lists seasons and gets a season with groups.
  - There is no team or player module.
  - Schema fields such as `status`, `submittedAt`, `reviewedBy`, `reviewNote` and `eligibilityApproved` exist, but nothing writes or validates state transitions.
  - No registration-window or transfer tables exist.
- **Impact:** The registration lifecycle cannot be performed through the API. The unique team-per-season constraint is the only enforced registration invariant; player multi-team registration, approval bypass and invalid group assignment are possible at DB level.
- **Recommended fix:** Implement explicit workflows with allowed transitions (draft → submitted → under review → approved/rejected/withdrawn), authorization for captains vs competition admins, registration windows, roster locking, transfer records and audit. Validate group/season/competition consistency and player season eligibility.

#### HIGH-09 — File storage is a metadata placeholder

- **Severity:** HIGH
- **Module:** files
- **Files:** `src/database/schema/index.ts:27`, `docs/file-storage.md`
- **What is wrong:** No storage adapter, upload/download route, MIME verification, size enforcement, private access control, signed URL or deletion policy exists. The `uploaded_files` table only stores metadata and an opaque key.
- **Evidence:**
  - No file module exists.
  - No route reads or writes `uploadedFiles`.
  - The documentation explicitly says S3-compatible/local adapters, upload routes, content sniffing, access control, URL signing and cleanup are not implemented.
- **Impact:** Team crests, player photos, dispute evidence and other documents cannot be uploaded or served. Private evidence cannot be protected because there is no access path to protect. If a future implementation derives keys from client paths, path traversal is a risk.
- **Recommended fix:** Implement a storage abstraction with server-generated keys, content sniffing, allowlist, size limits, checksum, authorization before signed URL issuance, and private/public access policies. Store only metadata in PostgreSQL and never trust client MIME/path input.

#### HIGH-10 — Access tokens survive logout and account deactivation

- **Severity:** HIGH
- **Module:** authentication / session management
- **Files:** `src/modules/auth/service.ts:22-24,40`, `src/modules/auth/routes.ts:7-8`
- **What is wrong:** Access tokens are stateless JWTs with no session identifier or token version and no revocation check. Logout revokes only the refresh token. `GET /auth/me` does not check `isActive` after verifying the JWT. There is no logout-all or session revocation.
- **Evidence:**
  - After a successful login, `POST /auth/logout` returned `{ loggedOut: true }`; the same access token still returned `200` from `GET /auth/me`.
  - After setting `users.is_active = false`, the existing access token still returned `200`; only a new login was rejected with `401`.
  - The JWT payload contains only `sub`, `email`, `iat`, `exp`; there is no `jti`, session ID or role/version claim.
  - `docs/authentication.md` admits `logout-all`, persisted session listing/revocation remain pending.
- **Impact:** A stolen access token remains usable for its full lifetime even after the user logs out or is suspended/deactivated. An administrator cannot terminate a compromised session. This directly fails the brief's session-revocation requirement.
- **Recommended fix:** Add a session record (or token version/`jti` denylist) checked on every authenticated request, revoke sessions on logout/logout-all/password change/deactivation, and keep access-token lifetimes short. Add tests for revocation after logout, deactivation and password change.

#### HIGH-11 — Multi-record operations are not transactional and have demonstrated races

- **Severity:** HIGH
- **Module:** authentication / database
- **Files:** `src/modules/auth/service.ts:11-18,27-39`
- **What is wrong:** There is no use of `db.transaction`, no `SELECT … FOR UPDATE`, no unique-violation mapping and no row version/optimistic locking anywhere in `src/`. Registration writes a user and then a role in separate statements; refresh revokes a token and inserts a new one in separate statements.
- **Evidence:**
  - Five concurrent registrations for the same new email produced **one 201 and four 500s** instead of one success and four `409` responses. The unique constraint rejected the losers, but the application surfaced them as internal errors.
  - Ten concurrent refreshes with the same refresh cookie produced **one 200 and nine 401s**, and the database showed **zero active refresh tokens** for that family. The one “successful” response returned a token that had already been revoked by the other requests' reuse detection. A legitimate parallel refresh (multiple tabs/devices) therefore logs the user out.
  - The refresh flow reads the token, checks revocation, updates it and inserts a successor without a transaction or lock; the same TOCTOU window could, under different scheduling, permit more than one successor or fail to revoke a successor inserted concurrently.
- **Impact:** Concurrent client behavior can destroy sessions and produce misleading success responses. Future write workflows (registrations, match events, result confirmation, standings rebuild) will be even more vulnerable because they span multiple records.
- **Recommended fix:** Wrap multi-record operations in transactions; perform conditional updates (`UPDATE … WHERE revoked_at IS NULL RETURNING …`) or row locks for rotation; map unique violations to stable 409 responses; add integration tests with parallel requests. For match/standings writes, use serializable transactions or explicit row locks and idempotency keys.

#### HIGH-12 — Expected client errors are returned as HTTP 500

- **Severity:** HIGH
- **Module:** HTTP / error handling
- **Files:** `src/app.ts:41-69`, `src/modules/auth/routes.ts:4-8`
- **What is wrong:** The global error handler recognizes only `AppError` and Fastify's `error.validation` property. Zod errors, JWT errors, malformed JSON, unsupported content types, payload-too-large and rate-limit errors fall through to the generic `500 INTERNAL_ERROR` branch.
- **Evidence:**
  - Invalid registration body (bad email/short password) → `500`.
  - Malformed JSON body → `500`.
  - `text/plain` request body → `500`.
  - Oversized body (1.2 MB against a 1 MB limit) → `500`.
  - `GET /auth/me` without an Authorization header → `500` instead of `401`.
  - `Authorization: Bearer garbage` → `500` instead of `401`.
  - A correctly signed JWT with a non-UUID `sub` → `500` from the UUID cast.
  - `GET /competitions/not-a-uuid` and `GET /fixtures?seasonId=not-a-uuid` → `500`.
  - Rate-limited registration requests returned `500` even though the server logged `statusCode: 429`; the response body was `INTERNAL_ERROR`.
  - Fastify's default 404 body (`{"message":"Route … not found","error":"Not Found","statusCode":404}`) is inconsistent with the documented `{success:false,error:{...}}` contract.
- **Impact:** Clients cannot distinguish authentication failure, validation failure, throttling, missing resources or server faults. Clients may retry non-retryable errors, monitoring will report false outages, and the documented API contract is wrong. Unauthenticated access to a protected endpoint looks like a server bug rather than a 401.
- **Recommended fix:** Add explicit handling for `ZodError`, Fastify JWT errors, `FST_ERR_CTP_*`, payload-too-large, rate-limit and Postgres constraint errors; preserve status codes; add a custom not-found handler; validate UUID/path/query parameters with Fastify schemas or a shared Zod validator; log expected 4xx at `warn`/`info`, not `error`.

#### HIGH-13 — The WebSocket endpoint is unauthenticated and non-functional

- **Severity:** HIGH
- **Module:** realtime
- **Files:** `src/app.ts:98-106`, `docs/realtime.md`
- **What is wrong:** `/ws/matches/:id` accepts any connection with no credentials, origin check or authorization. It sends one `connection.ready` message and has no handlers for messages, subscriptions, close, ping/pong or broadcasting.
- **Evidence:**
  - A Node `WebSocket` client connected without cookies or tokens and received:
    `{"type":"connection.ready","matchId":"eeee…","at":"…"}`.
  - The handler sends a message and returns; no `on('message')`, `on('close')` or heartbeat exists.
  - No code broadcasts match events, status changes or standings updates.
  - The documentation says authenticated subscriptions, authorization, outbox, post-commit publishing and reconnect recovery are not implemented.
- **Impact:** Any website can open a connection to any match ID. Today the endpoint leaks little beyond echoing the requested match ID, but it is the intended realtime channel for live match data and will become a direct data leak/integrity risk once broadcasting is added. Idle unauthenticated connections are also an availability risk.
- **Recommended fix:** Authenticate during the upgrade (short-lived WS ticket or validated access token), authorize the specific match/competition, verify Origin, implement subscription messages and server-side fan-out after transaction commit, add heartbeat/connection limits and reconnect/replay via a durable outbox or REST recovery.

#### HIGH-14 — The backend cannot satisfy the existing frontend contract

- **Severity:** HIGH
- **Module:** API contract / frontend integration
- **Files:** `frontend/src/services/contracts.ts:30-101`, `frontend/src/services/index.ts:8`, `frontend/src/lib/api-client.ts:11,13-26`, `frontend/src/types/competition.ts:36-60`, `frontend/src/types/match.ts:42-106`
- **What is wrong:** The frontend's active services are still mocks. The backend exposes only a subset of the required endpoints and returns database rows rather than the frontend domain shapes.
- **Evidence:**
  - `frontend/src/services/index.ts:8` sets `services = mockServices`; the REST client is not used.
  - `NEXT_PUBLIC_API_BASE_URL` is not set in `.env.development` or `.env.example`.
  - Missing endpoints: leagues, team list/detail/statistics, player list/detail/statistics, search, announcement detail, standings, registration, fixture preview/publish, disciplinary, dispute and audit.
  - Shape mismatches include competition `shortName/currentSeasonId/timeZone/pointsSystem/tieBreakers/rules/ruleNotes`, season `startDate/endDate` vs backend `startsOn/endsOn`, match `score` vs `homeScore/awayScore`, event `type/playerId/syncState` vs `eventType/playerRegistrationId`, lineup `teamId/playerId/slot` vs `teamRegistrationId/playerRegistrationId/x/y`, and announcement `category/summary/author/status` which do not exist.
  - `/auth/me` returns no `roles`, while the frontend `User` type requires `roles`. Login returns an access token in JSON; the frontend `apiRequest` never attaches it, and the backend does not accept the access token from a cookie.
- **Impact:** Switching the frontend from mock data to the real backend is not possible without a significant backend expansion and a mapping layer. The public pages would break on missing fields and enums even for the endpoints that exist.
- **Recommended fix:** Define a shared API contract (OpenAPI or shared types), implement the missing endpoints, map database rows to frontend shapes with explicit null/unknown semantics, standardize enums, and write an integration adapter in the frontend behind the existing service interfaces. Add contract tests.

#### HIGH-15 — There are no tests and no quality gate

- **Severity:** HIGH
- **Module:** testing / delivery
- **Files:** `package.json:6-14,31-36`; repository has no test files
- **What is wrong:** Vitest is a dev dependency but no test files, test script, lint script or CI configuration exist. The only executable commands are build/typecheck, and both fail.
- **Evidence:**
  - `find . -name '*.test.*' -o -name '*.spec.*'` (excluding `node_modules`) returned nothing.
  - `pnpm test` exited 0 with no output and ran no tests.
  - `pnpm lint` exited 1: `Command "lint" not found`.
  - No CI configuration was found.
- **Impact:** There is no regression protection for authentication, authorization, database constraints or future match logic. The existing defects (500s, races, missing constraints) would all pass an empty test suite.
- **Recommended fix:** Add a real test script and integration harness using Vitest + a disposable PostgreSQL database. Cover auth flows/reuse/revocation, authorization for every role, DB constraints, concurrency races, match state transitions, score derivation, standings rebuild, eligibility and idempotent offline events. Add lint and CI gates.

### Medium

#### MED-01 — Refresh rotation has a race that invalidates legitimate sessions

- **Severity:** MEDIUM
- **Module:** authentication
- **Files:** `src/modules/auth/service.ts:27-39`
- **What is wrong:** Rotation is a read-check-update-insert sequence with no transaction or row lock. Reuse detection is applied globally to the family, so parallel legitimate refreshes are indistinguishable from replay.
- **Evidence:** Ten concurrent refresh requests with one cookie: one `200`, nine `401 REFRESH_REUSE_DETECTED`; database showed zero active tokens in the family. The single 200 response returned a token that was already revoked.
- **Impact:** A user with multiple tabs, a retrying client or a flaky network can be logged out. Under different scheduling, the same TOCTOU window may permit multiple successors. This undermines the otherwise-good reuse-detection design.
- **Recommended fix:** Rotate atomically: `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING …`, then insert the successor in the same transaction. Add a short grace window or idempotent rotation keyed by the old token for legitimate parallel requests. Never revoke a family merely because a request lost this race.

#### MED-02 — Cookie lifetime ignores configuration and sessions can slide indefinitely

- **Severity:** MEDIUM
- **Module:** authentication / configuration
- **Files:** `src/modules/auth/routes.ts:3,5,6`, `src/modules/auth/service.ts:22,24,37`
- **What is wrong:** The refresh cookie's `maxAge` is hardcoded to `30 * 86400`, while the database expiry uses `process.env.REFRESH_TOKEN_DAYS`. `ACCESS_TOKEN_TTL` is also read raw from `process.env` rather than the validated `env`. There is no absolute session lifetime or family maximum age.
- **Evidence:** Login set `Max-Age=2592000` (30 days). The documented environment variable `REFRESH_TOKEN_DAYS` therefore cannot shorten or lengthen the browser cookie. Each refresh creates a new 30-day token, so a continuously active user never re-authenticates.
- **Impact:** Configuration changes can produce cookies that outlive or expire before the server token. There is no enforced maximum session lifetime, which weakens session security and makes incident response harder.
- **Recommended fix:** Use the validated `env` values consistently; set `maxAge` from `REFRESH_TOKEN_DAYS`; add an absolute family expiry and re-authentication policy; use `Cache-Control: no-store` on auth responses.

#### MED-03 — Account enumeration through timing and registration responses

- **Severity:** MEDIUM
- **Module:** authentication
- **Files:** `src/modules/auth/service.ts:12-13,20-21`
- **What is wrong:** Login short-circuits when the user does not exist, skipping Argon2 verification. Registration returns a distinct `409 EMAIL_EXISTS`.
- **Evidence:** Wrong-password login for an existing account took 0.224–0.286 s; the same request for a non-existent account took 0.009–0.011 s across repeated measurements. Registration for an existing email returned `409 EMAIL_EXISTS`.
- **Impact:** An attacker can enumerate valid accounts and focus credential stuffing or phishing. Rate limiting reduces but does not eliminate the issue across distributed sources.
- **Recommended fix:** Perform a dummy Argon2 verification for unknown users, keep response bodies and status timing uniform, and use an email-verification flow that does not disclose whether an address is registered. Add per-account throttling.

#### MED-04 — Password reset, email verification and account lockout are absent

- **Severity:** MEDIUM
- **Module:** authentication / account lifecycle
- **Files:** `docs/authentication.md:5`; no implementation
- **What is wrong:** There is no forgot/reset password flow, no email verification, no account lockout/progressive delay and no session/device management.
- **Evidence:** Documentation explicitly says the email service and forgot/reset flows are not implemented; no routes or tables for reset/verification exist. Login is protected only by an 8/min per-IP rate limit.
- **Impact:** Users cannot recover accounts. Anyone can register with an email they do not own, which matters if email later becomes an identity/notification channel. Credential stuffing is only weakly throttled.
- **Recommended fix:** Add single-use, expiring, hashed reset/verification tokens; invalidate sessions on password change; add per-account lockout/progressive delays; add email delivery with a real provider or explicitly document the unsupported state.

#### MED-05 — JWT and token transport are not hardened

- **Severity:** MEDIUM
- **Module:** authentication
- **Files:** `src/app.ts:27`, `src/modules/auth/service.ts:22`, `src/modules/auth/routes.ts:5`
- **What is wrong:** The JWT secret is only length-checked (32+ characters), so a predictable 32-character string or the example placeholder is accepted. Tokens have no `iss`, `aud` or `jti`; they are returned in JSON and expected as a bearer header, while the frontend comment says tokens must come from httpOnly cookies. There is no explicit algorithm allowlist.
- **Evidence:** A user can sign tokens with any 32-character secret; the example value is a human-readable placeholder. Login response includes the full access token; `/auth/me` requires `Authorization: Bearer`. The frontend `apiRequest` never sets it. No `Cache-Control: no-store` header is set on login.
- **Impact:** Weak secrets permit token forgery. Tokens exposed to JavaScript are vulnerable to XSS. The transport contract is inconsistent with the frontend and with the security documentation.
- **Recommended fix:** Require high-entropy secrets (reject known placeholders), pin HS256 or use asymmetric keys, add issuer/audience, rotate secrets, set `Cache-Control: no-store`, and choose one transport model (prefer short-lived access token plus httpOnly refresh cookie, with a tested refresh/interceptor path). If tokens are in JSON, document and test the XSS trade-off.

#### MED-06 — CSRF protection relies only on SameSite=Lax

- **Severity:** MEDIUM
- **Module:** authentication / HTTP security
- **Files:** `src/modules/auth/routes.ts:3-7`, `src/app.ts:24-28`
- **What is wrong:** Refresh and logout are cookie-authenticated POST endpoints with no CSRF token, Origin/Referer check or custom header requirement. `SameSite=Lax` is the only defense.
- **Evidence:** Cookie is `HttpOnly; SameSite=Lax; Path=/api/v1/auth`; no CSRF middleware or Origin validation exists. CORS does not prevent simple cross-site form submissions.
- **Impact:** SameSite=Lax mitigates most cross-site POSTs, but same-site subdomain compromise, older clients and future cookie-policy changes can reopen CSRF. Logout CSRF and login CSRF are low-impact today but the pattern will matter when cookie-authenticated writes are added.
- **Recommended fix:** Add an Origin/Referer allowlist check for state-changing requests and a double-submit CSRF token (or require a custom header). Keep SameSite and `Secure` in production. Document the chosen deployment topology.

#### MED-07 — Rate limiting exists but is misreported and incomplete

- **Severity:** MEDIUM
- **Module:** HTTP / rate limiting
- **Files:** `src/app.ts:28`, `src/modules/auth/routes.ts:4-5`
- **What is wrong:** The global limiter and per-route auth limits are configured, but 429 responses are converted to 500 by the error handler. Refresh, logout and WebSocket connections are not limited. The default store is in-memory and per-process.
- **Evidence:** After exceeding the register limit, responses were `500` while the server log recorded `statusCode: 429`; `x-ratelimit-*` headers were present. No limiter is attached to `/auth/refresh`, `/auth/logout` or `/ws/matches/:id`.
- **Impact:** Clients and monitors see server errors instead of throttling; refresh/WS abuse can consume resources; horizontal scaling would make limits inconsistent. In-memory storage is acceptable for a single instance but must be documented.
- **Recommended fix:** Preserve 429 status and add `Retry-After`; add limits to refresh/WS and consider per-account keys; document the single-instance store or use a shared store only if scale requires it.

#### MED-08 — OpenAPI is structurally present but semantically empty

- **Severity:** MEDIUM
- **Module:** API documentation
- **Files:** `src/app.ts:30-40`
- **What is wrong:** Swagger generates paths from route registration, but there are no request/response schemas, security schemes, error responses, query parameters or examples.
- **Evidence:** `/docs/json` contained 15 paths, `components.schemas` was `{}`, `security` was `undefined`, and operations only declared a generic `200` response. `POST /auth/register` is documented as 200 even though it returns 201. Query parameters such as `seasonId` and `competitionId` are not documented.
- **Impact:** The OpenAPI document cannot be used to generate a reliable client or validate the frontend contract. It advertises auth endpoints without security requirements. This directly fails the OpenAPI requirement.
- **Recommended fix:** Define Fastify JSON schemas or a Zod-to-OpenAPI type provider for every route, including bodies, params, query, success/error envelopes, status codes and security schemes. Add examples and contract tests against the generated document.

#### MED-09 — Query efficiency, pagination and N+1 problems

- **Severity:** MEDIUM
- **Module:** performance
- **Files:** `src/modules/matches/routes.ts:8-10`, `src/modules/competitions/routes.ts:7-10`, `src/modules/announcements/routes.ts:2`
- **What is wrong:** Public list endpoints return unbounded result sets. Match detail performs sequential queries for match, fixture, home registration, away registration, home team, away team, events and lineups. The lineups endpoint performs one query per lineup. Announcements fetches all matching rows and filters audience in JavaScript.
- **Evidence:** Code inspection shows no `limit`/`offset` or pagination parameters. `GET /fixtures` returned every row for a season. No joins are used.
- **Impact:** Response time and memory grow linearly with data. Several concurrent match views multiply round trips. The `announcements` audience filter is applied after fetching non-public rows, so a bug could expose them if the filter changes. There is no stable pagination contract for clients.
- **Recommended fix:** Add limit/offset or cursor pagination with caps, select only needed columns, use joins/`inArray` for related records, filter announcements in SQL, and add indexes for actual filter/sort paths. Measure with `EXPLAIN` on realistic data.

#### MED-10 — Role model is inconsistent and not hierarchical

- **Severity:** MEDIUM
- **Module:** authorization / seed
- **Files:** `src/database/seed/run.ts:2`; `frontend/src/types/admin.ts:3-9`
- **What is wrong:** Database role names (`registered_user`, `team_captain`, `match_official`, `competition_admin`, `super_admin`) differ from the frontend's `user`, `captain`, `match-official`, `competition-admin`, `super-admin`. `super_admin` is not a superset: it receives only `users:manage`, `roles:manage`, `competition:manage`, `season:manage`, `audit:read`, while `competition_admin` has team/player approval and match create/update/publish. Permission keys omit many operations the brief requires.
- **Evidence:** Seed grants are visible in `src/database/seed/run.ts:2`; 6 roles, 24 permissions and 28 grants were verified. There is no role hierarchy or wildcard. No role resolution code exists.
- **Impact:** If a permission layer is added naively, a super administrator cannot approve teams or confirm matches unless also assigned competition-admin, and the frontend cannot map role names reliably. The permission set gives a misleading impression of completeness.
- **Recommended fix:** Define a canonical role/permission model shared with the frontend, make super-admin a true superset (or implement inheritance), add missing permissions for every workflow, and add tests that assert each role's allowed operations.

#### MED-11 — `user_roles` competition scope uses a magic UUID and has no foreign key

- **Severity:** MEDIUM
- **Module:** database / authorization
- **Files:** `src/database/schema/index.ts:9`
- **What is wrong:** `user_roles.competition_id` is `NOT NULL` with default `00000000-0000-0000-0000-000000000000` and no foreign key to `competitions`. The all-zero value is an undocumented sentinel for “global”, and any other UUID is accepted even if no competition exists.
- **Evidence:** A `user_roles` row with `competition_id = 'deadbeef-dead-beef-dead-beefdeadbeef'` was accepted. Registration inserts `registered_user` without specifying competition, using the zero UUID. No code interprets the scope.
- **Impact:** Role assignments can reference nonexistent competitions or silently become global. Competition-scoped authorization cannot be implemented safely on this shape.
- **Recommended fix:** Make `competition_id` nullable with `REFERENCES competitions(id)`, define the global/competition-scoped semantics explicitly, use partial unique indexes for global roles, and validate scope before inserting assignments.

#### MED-12 — Deleting a group silently removes historical context

- **Severity:** MEDIUM
- **Module:** database / competitions
- **Files:** `src/database/schema/index.ts:13,16,19,24`
- **What is wrong:** `team_registrations.group_id`, `fixtures.group_id` and `standings_snapshots.group_id` use `ON DELETE SET NULL`. Deleting a group is allowed and silently nulls references, losing which group a historical fixture/team belonged to.
- **Evidence:** In a transaction, deleting a group set its fixture and team-registration `group_id` values to `NULL` while the rows remained. Team and season deletion were correctly restricted in contrast.
- **Impact:** Historical standings/fixtures become ambiguous, and a deleted group can make results impossible to reconstruct. This contradicts the stated historical-preservation goal.
- **Recommended fix:** Use `ON DELETE RESTRICT` or soft-delete/archive groups, disallow deletion once referenced, and preserve group identity in historical snapshots.

#### MED-13 — Score and result semantics are ambiguous and unsafe

- **Severity:** MEDIUM
- **Module:** database / matches
- **Files:** `src/database/schema/index.ts:20`, `src/modules/matches/routes.ts:8`
- **What is wrong:** `matches.home_score`/`away_score` default to 0, so a scheduled match is indistinguishable from a real 0–0. There is no constraint that scores are non-negative or consistent with events. `result_confirmed_at` is independent of the match status and has no reason/audit. The API returns both scores and status without a `resultConfirmed` boolean.
- **Evidence:** `GET /matches/:id` returned `status: "scheduled"`, `homeScore: -5`, `awayScore: -2`. The frontend `Match` type expects `score: Score | null` and `resultConfirmed: boolean`.
- **Impact:** Clients can display a false 0–0 for unplayed matches and cannot know whether a result is confirmed. Corrections can overwrite scores without history. Negative values corrupt standings.
- **Recommended fix:** Make scores nullable until recorded, add check constraints, derive scores from confirmed events for engine-managed matches, expose `resultConfirmed`, and store confirmation/correction metadata and audit history.

#### MED-14 — API semantics are inconsistent for missing resources and invalid inputs

- **Severity:** MEDIUM
- **Module:** API contract
- **Files:** `src/modules/matches/routes.ts:7-10`, `src/modules/competitions/routes.ts:9-10`
- **What is wrong:** Sub-resources of a nonexistent parent return `200 []` instead of `404`; invalid UUIDs return `500`; list endpoints have no pagination metadata; not-found responses use Fastify's default shape.
- **Evidence:** `GET /matches/<random-valid-uuid>/events` → `200 {"data":[]}`; `.../lineups` → `200 []`; `GET /competitions/<random-uuid>/seasons` → `200 []`; `GET /competitions/not-a-uuid` → `500`; `GET /api/v1/teams` → Fastify default 404 body.
- **Impact:** Clients cannot distinguish “match does not exist” from “match has no events”. Invalid IDs appear as server failures. The documented error envelope is not universal.
- **Recommended fix:** Validate UUID params, return 404 for missing parent resources, standardize the error envelope via `setNotFoundHandler`, and add pagination metadata (`items`, `total`, cursor/limit) consistently.

#### MED-15 — `.env` is not loaded and configuration is bypassed

- **Severity:** MEDIUM
- **Module:** configuration / operations
- **Files:** `src/config/env.ts:2-3`, `src/modules/auth/service.ts:22,24,37`, `src/modules/auth/routes.ts:3,5,6`, `README.md:5`
- **What is wrong:** The documented setup says to copy `.env.example` to `.env`, but the application never loads `.env` (no dotenv and no Node `--env-file`). The Zod schema validates only `process.env`; token lifetimes and cookie security are read directly from `process.env`, bypassing validation.
- **Evidence:** In a temporary copy with a valid `.env` and no exported variables, importing `src/config/env.ts` failed with “Invalid input: expected string, received undefined.” The service uses raw `process.env.ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_DAYS`; the route uses raw `COOKIE_SECURE`.
- **Impact:** Following the README without exporting variables produces a startup failure. Invalid TTLs bypass validation and can cause runtime 500s. Operators may believe a setting is validated when it is not.
- **Recommended fix:** Load `.env` explicitly in development (`node --env-file=.env` or dotenv), or remove `.env` from the setup instructions and require exported variables. Read every setting through the validated `env` object and validate TTL formats.

#### MED-16 — Logging can expose PII and SQL parameters

- **Severity:** MEDIUM
- **Module:** logging
- **Files:** `src/app.ts:19,41-43`
- **What is wrong:** Every error, including expected 4xx errors, is logged at `error` with the full error object. Drizzle/Postgres errors include SQL text and parameters; Zod errors include input values in some cases. There is no redaction configuration.
- **Evidence:** Server logs included full SQL queries with email parameters, full Zod issue lists and stack traces for `401`/`409` responses. No PII redaction is configured. Client responses themselves are generic, so stack traces do not leak to clients.
- **Impact:** Auth-related emails and internal identifiers can accumulate in logs; expected client errors create noise that obscures real incidents. If query parameters ever contain tokens or secrets, they will be logged.
- **Recommended fix:** Configure pino redaction, log expected 4xx at `warn`/`info` without sensitive params, log SQL parameters only in controlled debug mode, and centralize audit logging separately from operational logs.

### Low

#### LOW-01 — Documentation contains inaccurate security/integrity claims

- **Severity:** LOW
- **Module:** documentation
- **Files:** `docs/matches.md:3`, `docs/database-schema.md:5`, `docs/deployment.md:3`
- **What is wrong:** The documentation states that event rows are immutable and that deleting a historical event is restricted. In the schema, `match_events` is an ordinary table with `updated_at` and no immutability trigger or incoming foreign key; direct updates/deletes are allowed. Deployment instructions assume reviewed migrations that are not present. OpenAPI is described as an API contract despite lacking schemas/security.
- **Evidence:** `match_events` has no trigger; `DELETE FROM match_events` succeeds; `drizzle/` has no SQL. Docs are otherwise candid about missing features.
- **Impact:** Operators and integrators may rely on guarantees that do not exist. This is documentation accuracy, not a runtime defect by itself.
- **Recommended fix:** Correct the claims or implement the guarantees; make docs generated/validated against the schema and OpenAPI where possible.

#### LOW-02 — Schema hygiene issues

- **Severity:** LOW
- **Module:** database
- **Files:** `src/database/schema/index.ts` (throughout)
- **What is wrong:** `updated_at` has a default but no trigger, so future writes must remember to update it. A generated foreign-key name is truncated to 63 characters (`player_registrations_team_registration_id_team_registrations_id`), producing a migration warning. Enum-like fields are free `varchar` (`competitions.status/format/visibility`, `seasons.status`, `competition_groups.kind`, `lineups.status`, `announcements.audience`, `event_type`). `teams.logo_file_id` and `players.photo_file_id` are UUIDs without foreign keys to `uploaded_files`.
- **Evidence:** `drizzle-kit generate` emitted the identifier-truncation notice. Direct inserts with arbitrary audience/status/event values succeeded.
- **Impact:** Drift, invalid states, orphan file references and fragile migration names.
- **Recommended fix:** Add enum/check constraints, an `updated_at` trigger or application-level update helper, shorter explicit constraint names, and foreign keys for file references.

#### LOW-03 — Operational hardening gaps

- **Severity:** LOW
- **Module:** HTTP / operations
- **Files:** `src/app.ts:19-28,98-106`
- **What is wrong:** Helmet emits HSTS even in development over HTTP; `/docs` is public; auth responses lack `Cache-Control: no-store`; there is no request/connection timeout, WebSocket heartbeat or connection cap; `void db` is a no-op import suppression (`src/app.ts:110`). The code is heavily minified into long lines, which makes review harder.
- **Evidence:** Health responses included `Strict-Transport-Security` over plain HTTP. No timeout/heartbeat/limit configuration exists.
- **Impact:** Minor security/ops hygiene; potential resource exhaustion via idle WS connections; maintainability.
- **Recommended fix:** Make HSTS production-only (or ensure HTTPS), protect/disable docs in production, add `no-store` to auth responses, configure timeouts and WS heartbeat/limits, remove dead code and format consistently.

#### LOW-04 — No lint/format/CI configuration

- **Severity:** LOW
- **Module:** delivery
- **Files:** `package.json`, repository root
- **What is wrong:** No ESLint/Prettier configuration or lint script exists, and no CI workflow is present. Combined with the build failure, this means there is no automated gate at all.
- **Evidence:** `pnpm lint` → “Command 'lint' not found”; no CI files found.
- **Impact:** Style and correctness drift; defects merge unnoticed.
- **Recommended fix:** Add lint/format scripts and a CI workflow running install, typecheck, build, migration and tests.

---

## D. Security Findings

This section summarizes security-relevant results. Detailed evidence is in Section C.

| ID | Severity | Finding | Evidence / status |
|---|---|---|---|
| SEC-01 | CRITICAL | No authorization or permission enforcement; private/draft data publicly readable | CRIT-02. Every read route except `/auth/me` is public; seeded permissions are unused. |
| SEC-02 | HIGH | Access tokens survive logout and account deactivation; no session revocation | HIGH-10. Verified `200` after logout and after `is_active=false`. |
| SEC-03 | HIGH | WebSocket connections are unauthenticated and unauthorized | HIGH-13. Connected with no credentials and received `connection.ready`. |
| SEC-04 | HIGH | Database permits invalid/contradictory security-sensitive data | HIGH-01. Player multi-team registration, cross-team lineup players, arbitrary event types. |
| SEC-05 | MEDIUM | Refresh-token race can revoke a legitimate session | MED-01. Ten parallel refreshes: one 200, nine 401, zero active tokens. |
| SEC-06 | MEDIUM | Account enumeration by timing and registration response | MED-03. Existing account 224–286 ms vs unknown 9–11 ms; `409 EMAIL_EXISTS`. |
| SEC-07 | MEDIUM | No password reset/email verification/lockout | MED-04. Not implemented; documented as pending. |
| SEC-08 | MEDIUM | JWT secret strength/claims/transport are weak or inconsistent | MED-05. Length-only secret check; no `jti`/issuer/audience; token returned in JSON. |
| SEC-09 | MEDIUM | CSRF protection is only SameSite=Lax | MED-06. No CSRF token or Origin check. |
| SEC-10 | MEDIUM | Rate limiting returns 500 and omits refresh/WS | MED-07. 429 logged, 500 returned; no refresh/WS limiter. |
| SEC-11 | MEDIUM | Logs can contain PII and SQL parameters | MED-16. Full SQL/email params logged on errors. |
| SEC-12 | LOW | No `Cache-Control: no-store` on auth responses | LOW-03. Tokens/user data could be cached by intermediaries. |
| SEC-13 | LOW | HSTS sent over HTTP in development | LOW-03. Helmet default. |
| SEC-14 | INFO | No SQL injection was demonstrated | Drizzle parameterizes queries; error logs showed `$1` parameters. Not an exhaustive injection test. |
| SEC-15 | INFO | Password hashing is sound but not explicitly tuned/rehashed | Argon2id observed `m=65536,t=3,p=4`; no rehash-on-login or configurable policy. |
| SEC-16 | INFO | Role self-assignment is blocked in registration | A request containing `role: "super_admin"` created only a `registered_user` assignment; unknown keys are stripped. |
| SEC-17 | INFO | Sequential refresh-token reuse detection works | Reusing an old token returned `401 REFRESH_REUSE_DETECTED` and revoked the family. |
| SEC-18 | INFO | CORS allowlist behaves as configured for tested origins | Allowed origin received `Access-Control-Allow-Origin`; disallowed origin did not. |
| SEC-19 | INFO | Security headers are present | Helmet headers observed (CSP, HSTS, nosniff, frame options, etc.). |
| SEC-20 | BLOCKED | File upload/content-type/path traversal controls cannot be assessed | No storage implementation or file routes exist. |
| SEC-21 | BLOCKED | Dispute evidence privacy cannot be assessed | No dispute/evidence implementation exists. |

**Security conclusion:** The authentication primitive is a reasonable start, but the system is not secure as a whole. The absence of authorization is the dominant issue; session revocation, unauthenticated WebSocket access, exposed draft data and permissive database invariants are the next most serious. No evidence of SQL injection or password-hash exposure was found, and role injection through registration was blocked.

---

## E. Database Findings

The generated schema (from a temporary copy, using `drizzle-kit generate`) is syntactically valid and contains useful relational structure. The findings below are about what the schema does **not** enforce, plus operational gaps.

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| DB-01 | CRITICAL | No migrations committed; migrate is a silent no-op on an empty database | `drizzle/` contains only README; `pnpm db:migrate` exited 0 with no tables. |
| DB-02 | HIGH | No `CHECK` constraints for scores, minutes, coordinates, shirt numbers, points, dates or enums | Negative scores/minute, `x=999`, `y=-50`, arbitrary roles/types accepted. |
| DB-03 | HIGH | Player can be registered to multiple teams in one season; matriculation uniqueness is per team, not per season | Same player and `MAT-001` accepted in two team registrations in the same season. |
| DB-04 | HIGH | Fixture uniqueness/self-match/season consistency not enforced | Duplicate, self, cross-season and cross-season-group fixtures accepted. |
| DB-05 | HIGH | No transactions or row locks; race conditions demonstrated | Registration 1×201 + 4×500; refresh 1×200 + 9×401 with zero active tokens. |
| DB-06 | HIGH | Match event cross-entity integrity not enforced | Event team/player can disagree; arbitrary type/minute accepted; no event sequencing. |
| DB-07 | HIGH | Lineup cross-entity integrity not enforced | Opposing-team player, arbitrary role, out-of-range coordinates, multiple captains accepted. |
| DB-08 | HIGH | No audit write path or immutability | `audit_logs` unused; direct updates/deletes possible. |
| DB-09 | MEDIUM | `user_roles.competition_id` magic zero UUID with no foreign key | Nonexistent competition UUID accepted; global sentinel undocumented. |
| DB-10 | MEDIUM | Group deletion silently nulls historical references | Deleting group set fixture/team-registration `group_id` to `NULL`. |
| DB-11 | MEDIUM | Score defaults hide “not recorded” state and can be negative | Scheduled match returns 0–0; negative scores accepted and returned. |
| DB-12 | MEDIUM | Standings snapshots have no uniqueness/validation | Duplicate identical snapshots accepted; JSON rows unvalidated. |
| DB-13 | MEDIUM | Missing indexes for common access paths | No index on `refresh_tokens.family_id`/`user_id`, `standings_snapshots(season_id, group_id)`, `announcements(competition_id)`, `uploaded_files(uploaded_by)`. |
| DB-14 | MEDIUM | Soft deletion is inconsistent | `teams`, `players`, `uploaded_files` have archive timestamps but no API/filter; competitions use status; groups can be hard-deleted. |
| DB-15 | LOW | Case-sensitive unique email can create duplicates or lock out mixed-case rows | `CAPTAIN@EXAMPLE.TEST` and `captain@example.test` coexist. |
| DB-16 | LOW | File references are not foreign keys | `teams.logo_file_id` and `players.photo_file_id` can reference missing files. |
| DB-17 | LOW | `updated_at` is not maintained automatically | Default only; future writes must set it manually. |
| DB-18 | LOW | Free-form `varchar` replaces enums for several state fields | Competition/season/group/lineup statuses and event/audience values are unconstrained. |
| DB-19 | LOW | Generated FK name is truncated | Migration warning for `player_registrations_team_registration_id_team_registrations_id_fk`; potential naming collisions. |
| DB-20 | INFO | UUIDs, `timestamptz`, FKs and several unique constraints are used correctly | Positive: team per season, lineup per match/team, event client ID per match, restrict on historical team/season deletion. |
| DB-21 | INFO | Seed is repeatable | Two runs produced 6 roles, 24 permissions, 28 grants with no duplicates. |

**Database conclusion:** This is a reasonable first-draft schema, not an integrity boundary. The most dangerous gaps are season/group/team consistency, player multi-team registration, fixture duplication, event/lineup cross-entity checks, free scores and the absence of transactions. These must be fixed before any write endpoint is exposed.

---

## F. API Compatibility

### Current frontend state

The frontend currently uses mock services:

- `frontend/src/services/index.ts:8` — `export const services: Services = mockServices;`
- `frontend/src/lib/api-client.ts:11` — `BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? ''`
- `.env.development` sets only `NEXT_PUBLIC_TOUCHLINE_DATA=demo`; `.env.example` does not set an API URL.
- `apiRequest()` adds cookies and an optional `Idempotency-Key`, but no bearer token; it is not used by the mock.

Therefore no end-to-end frontend/backend integration exists, and the backend cannot be validated against real frontend calls.

### Endpoint coverage

| Frontend service contract | Required operations | Backend status |
|---|---|---|
| `CompetitionService` | `list`, `get`, `listSeasons`, `listLeagues` | Partial: list/get/seasons exist; no leagues endpoint. Raw rows do not match `Competition`/`Season`/`League`. |
| `TeamService` | `listEntries`, `get`, `statistics` | Missing entirely. No team routes. |
| `PlayerService` | `list`, `get`, `statistics` | Missing entirely. No player routes. |
| `MatchService` | `list`, `get` | Partial: `GET /matches/:id` and `GET /fixtures` exist, but no match list by competition/season/team/league and shapes differ. |
| `AnnouncementService` | `list`, `get` | Partial: list exists; detail is missing; shape differs. |
| `SearchService` | `search` | Missing entirely. |
| `AuthService` (contract) | `currentUser`, `signIn`, `signOut` | Partial: backend auth exists, but transport and user shape differ; no roles in `/auth/me`. |
| `RegistrationService` (contract only) | team/player submission | Missing. |
| `FixtureService` (contract only) | preview/publish | Missing. |
| `DisciplinaryService` (contract only) | cases/suspensions | Missing. |
| `DisputeService` (contract only) | protests | Missing. |
| `AuditService` (contract only) | audit list | Missing. |

### Shape incompatibilities

| Frontend type | Expected fields | Backend reality |
|---|---|---|
| `Competition` (`frontend/src/types/competition.ts:36-60`) | `shortName`, `logoUrl`, `status`, `currentSeasonId`, `format`, `timeZone`, `pointsSystem`, `tieBreakers`, `rules`, `ruleNotes` | Only `slug`, `name`, `description`, `status`, `format`, `visibility`, timestamps. No current season, timezone, points, tie-breakers or rule notes. `status` is free text. |
| `Season` | `startDate`, `endDate` | `startsOn`, `endsOn`. No mapping. |
| `League` | `competitionId`, `seasonId`, `name`, `kind` | Groups have `seasonId`, `name`, `kind` but no `competitionId`; no `/leagues` endpoint. |
| `TeamEntry` | `{team, registration}` with `registration.competitionId`, `leagueId` | No team endpoint. Team registration has `groupId`, not `leagueId`, and no `competitionId`. |
| `Player` | `teamId`, `squadStatus`, `shirtNumber`, `photoUrl` | No player endpoint; shirt number belongs to player registration, not the player. |
| `Match` | `competitionId`, `seasonId`, `leagueId`, `score: {home,away} | null`, `resultConfirmed`, `homeTeamId`, `awayTeamId` | Server returns `homeScore`/`awayScore` (default 0), no competition/season/league IDs, no `resultConfirmed`, and nested team rows. |
| `MatchStatus` | `first-half`, `half-time`, `second-half`, `full-time`, etc. | Database enum uses `first_half`, `half_time`, `second_half`, `full_time`, plus `live`. |
| `MatchEvent` | Discriminated `type` union, `teamId`, `playerId`, `syncState`, substitution `playerOffId`/`playerOnId` | `eventType` string, `teamRegistrationId`, `playerRegistrationId`, `secondaryPlayerRegistrationId`, no `syncState`, no typed substitution fields. |
| `MatchLineup` / `LineupPlayer` | `teamId`, `playerId`, `slot {x,y}`, role `starter/substitute/unavailable` | `teamRegistrationId`, `playerRegistrationId`, `x`/`y` numeric strings, free-text role; no slot object. |
| `Announcement` | `category`, `summary`, `author`, `status`, `publishedAt`, `featured`, related IDs | Only `title`, `body`, `audience`, `publishedAt`, archive timestamp. No category/summary/author/status/featured/relations. |
| `User` | `roles: RoleName[]` | `/auth/me` returns only `id`, `email`, `displayName`; login user has the same three fields. |
| `AuditLog` | `actorId`, `targetType`, `targetId`, `at`, `previousValue`, `newValue` | Table uses `actorUserId`, `entityType`, `entityId`, `createdAt`, `before`, `after`; no endpoint. |
| `DisciplinaryCase`, `Suspension`, `Protest`, `DisputeEvidence` | Full domain objects | No tables or endpoints. |

### Authentication/transport incompatibility

- The frontend comment says auth tokens must come from httpOnly cookies (`frontend/src/lib/api-client.ts:1-4`).
- The backend returns the access token in JSON and requires `Authorization: Bearer` for `/auth/me`.
- `apiRequest()` uses `credentials: 'include'` but never attaches a bearer token.
- The refresh cookie is path-scoped to `/api/v1/auth`; the frontend must call that exact origin/path.
- There is no refresh interceptor, no access-token cookie and no roles in `/auth/me`.

### Required additions for the current frontend

At minimum:

1. `GET /api/v1/leagues?competitionId=&seasonId=` or include leagues in the season response.
2. `GET /api/v1/teams?competitionId=&seasonId=`, `GET /api/v1/teams/:id`, team statistics.
3. `GET /api/v1/players?teamId=&competitionId=`, `GET /api/v1/players/:id`, player statistics.
4. `GET /api/v1/matches?competitionId=&seasonId=&teamId=&leagueId=`.
5. `GET /api/v1/announcements/:id` and the missing announcement fields.
6. `GET /api/v1/search?q=` with typed results.
7. Consistent competition/season/match/event/lineup DTOs and enums.
8. A working access-token transport or refresh-based session for `/auth/me` and future writes.
9. Pagination/filtering/sorting and stable error codes.

Until these are implemented and mapped by a real service adapter, the frontend must remain on mock data.

---

## G. Verification Results

### Environment

- Node.js **24.21.0**
- pnpm **12.6.0**
- PostgreSQL **16** in an ephemeral Docker container (`postgres:16`) on port `55432`
- The repository was not a Git checkout; no commit hash was available.
- Migration generation and all schema/API experiments were run against a temporary copy at `/tmp/touchline-audit` and the ephemeral database. The backend source tree was not edited. Temporary build artifacts and an empty journal created by verification commands were removed; the final source tree is unchanged.

### Commands and results

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| TypeScript check | `pnpm typecheck` | **FAILED (exit 2)** | `error TS6059: File '.../drizzle.config.ts' is not under 'rootDir' '.../src'.` |
| Production build | `pnpm build` | **FAILED (exit 2)** | Same TS6059 error; `tsc` may emit partial output despite the error, but the build exit is non-zero and the emitted artifacts were removed. |
| Production start | `pnpm start` | **FAILED (exit 1)** | `Cannot find module .../dist/server.js` (tested after removing emitted artifacts; the failed build is not a reliable start path). |
| Migration journal check | `pnpm db:check` | **PASSED, but meaningless** | Exit 0 with an empty migration set; it does not validate any migration SQL. It created an empty journal during the run (removed afterwards). |
| Generate schema SQL | `drizzle-kit generate` in `/tmp` copy | **PASSED** | Produced `0000_big_ironclad.sql` for all 23 tables; one identifier-truncation warning. |
| Migrate empty database (repo) | `pnpm db:migrate` against new `touchline_empty` DB | **FAILED SILENTLY** | Exit 0; `\dt` reported “Did not find any relations.” No tables created. |
| Migrate with generated migration (temp copy) | `tsx src/database/migrate.ts` in `/tmp/touchline-audit` | **PASSED** | Schema created in the ephemeral DB; one FK-name truncation notice. |
| Seed | `pnpm db:seed` twice | **PASSED** | 6 roles, 24 permissions, 28 grants; no duplicates on second run. |
| Health with database | `GET /health` | **PASSED** | `200 {"success":true,"data":{"status":"ok","database":"ok"}}` |
| Health without database | `GET /health` with unreachable DB | **PASSED** | `503 DATABASE_UNAVAILABLE` |
| Register | valid body | **PASSED** | `201` with id/email/displayName |
| Duplicate register (sequential) | same email | **PASSED** | `409 EMAIL_EXISTS` |
| Concurrent duplicate register | 5 parallel requests, same new email | **FAILED** | `1×201`, `4×500` instead of 1×201 + 4×409 |
| Login | valid / invalid password | **PASSED** | `200` with access token + refresh cookie; `401 INVALID_CREDENTIALS` |
| Login user enumeration timing | existing vs nonexistent email, wrong password | **FAILED (security)** | Existing: 0.224–0.286 s; nonexistent: 0.009–0.011 s |
| Refresh rotation | cookie-based refresh | **PASSED** | New access token and rotated refresh cookie |
| Sequential refresh reuse | reuse old cookie | **PASSED** | `401 REFRESH_REUSE_DETECTED`; family revoked; new token also rejected |
| Concurrent refresh | 10 parallel refreshes with one cookie | **FAILED** | `1×200`, `9×401`, zero active tokens in the family; the 200 token was already revoked |
| Logout | `POST /auth/logout` then reuse access token | **FAILED (security)** | `200` after logout with the same access token; refresh token correctly rejected |
| Deactivation | set `is_active=false`, reuse access token | **FAILED (security)** | Existing access token still `200`; new login `401` |
| `/auth/me` without token | no Authorization header | **FAILED (contract)** | `500 INTERNAL_ERROR`, expected `401` |
| `/auth/me` invalid token | `Bearer garbage` | **FAILED (contract)** | `500 INTERNAL_ERROR`, expected `401` |
| Non-UUID JWT subject | correctly signed token with `sub=not-a-uuid` | **FAILED (contract)** | `500` from UUID cast |
| Role injection | register body including `role`/`roles` | **PASSED (positive)** | `201`; only `registered_user` assigned |
| Cookie flags | inspect `set-cookie` | **PARTIAL** | `HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age=2592000`; `Secure` absent by default (expected in dev config but must be enabled in production) |
| Cookie lifetime config | set/observe `REFRESH_TOKEN_DAYS` | **FAILED (config)** | Cookie max-age is hardcoded 30 days; server expiry uses env independently |
| CORS allowed origin | preflight `Origin: http://localhost:3000` | **PASSED** | `204`, `Access-Control-Allow-Origin: http://localhost:3000`, credentials true |
| CORS disallowed origin | preflight `Origin: http://evil.example` | **PASSED (no reflection)** | No `Access-Control-Allow-Origin` header |
| Rate limiting | exceed register limit | **FAILED (contract)** | Responses were `500`; server logged `statusCode:429` |
| Malformed JSON | `{bad` body | **FAILED (contract)** | `500`, expected `400` |
| Unsupported content type | `text/plain` body | **FAILED (contract)** | `500`, expected `415` |
| Oversized body | 1.2 MB against 1 MB limit | **FAILED (contract)** | `500`, expected `413` |
| Zod validation | invalid register body | **FAILED (contract)** | `500`, expected `400` |
| Invalid UUID path/query | `/competitions/not-a-uuid`, `?seasonId=not-a-uuid` | **FAILED (contract)** | `500`, expected `400` |
| 404 envelope | `GET /api/v1/teams` | **FAILED (contract)** | Fastify default `{message,error,statusCode}`, not the documented envelope |
| Private competition read | insert `status=draft`, `visibility=private`; GET list | **FAILED (security)** | Draft/private row returned to anonymous caller |
| Unpublished fixture read | insert `publishedAt=null`; GET fixtures | **FAILED (security)** | Unpublished fixture returned |
| Draft lineup read | insert lineup `status=draft`; GET lineups | **FAILED (security)** | Draft lineup and players returned; also cross-team player/out-of-range coordinates |
| Announcement audience filter | public + internal + draft + archived rows | **PASSED (limited)** | Only published public row returned; filtering occurs in JS after fetching all rows |
| Missing-parent subresources | random valid UUID for events/lineups/seasons | **FAILED (contract)** | `200 []` instead of `404` |
| DB: player multi-team | insert same player/matriculation into two teams | **FAILED (integrity)** | Both rows accepted |
| DB: duplicate/self/cross-season fixtures | direct inserts | **FAILED (integrity)** | All accepted |
| DB: cross-season group assignment | update team registration group | **FAILED (integrity)** | Accepted |
| DB: negative scores | update match | **FAILED (integrity)** | Accepted and returned by API |
| DB: arbitrary event/foreign player | direct insert | **FAILED (integrity)** | `event_type='not-a-football-event'`, `minute=-42`, opposing player accepted |
| DB: invalid lineup | direct inserts | **FAILED (integrity)** | Opposing player, role `wizard`, `x=999`, `y=-50`, two captains accepted |
| DB: duplicate standings snapshots | two identical inserts | **FAILED (integrity)** | Both accepted |
| DB: role scope nonexistent competition | insert `user_roles` | **FAILED (integrity)** | Accepted; no FK |
| DB: case-variant email | insert uppercase variant | **FAILED (integrity)** | Accepted alongside lowercase row |
| DB: historical delete restrictions | delete team/season referenced by history | **PASSED (positive)** | `ON DELETE restrict` blocked deletion |
| DB: group deletion | delete referenced group in transaction | **FAILED (integrity)** | Fixture/team group IDs silently set to `NULL` |
| DB: working unique constraints | duplicate event client ID, lineup, team registration | **PASSED (positive)** | All rejected with unique violations |
| WebSocket unauthenticated | connect without cookies/token | **FAILED (security)** | Connection opened; received `connection.ready` for arbitrary match ID |
| OpenAPI generation | `GET /docs/json` | **PARTIAL** | 15 paths, `components.schemas = {}`, no security schemes, only default 200 responses, missing query parameters |
| Tests | `pnpm test` | **NOT RUN / EMPTY** | No test files; command produced no output and executed nothing. |
| Lint | `pnpm lint` | **FAILED** | `Command "lint" not found` |
| Frontend type/browser integration | not attempted | **NOT RUN** | Frontend still uses mock services; no API URL configured |
| Load/performance testing | not attempted | **NOT RUN** | No realistic dataset or benchmark was available |
| TLS/proxy/real deployment | not attempted | **NOT RUN** | Local HTTP only |
| Password reset/email verification | not attempted | **BLOCKED** | Not implemented |
| Match engine/standings/disciplinary/disputes/files | not attempted | **BLOCKED** | No endpoints/implementation |

### Checks that could not be performed

- End-to-end browser integration with the Next.js app: the app is wired to mock services and has no API base URL.
- Production-like TLS/proxy behavior: local HTTP only.
- Load/concurrency at realistic scale: only small parallel-request races were exercised.
- File upload/private evidence access: no storage implementation.
- Password-reset/email delivery: no implementation.
- Match/standings/disciplinary/dispute workflows: no write endpoints.
- A true production database migration from a prior version: no migration history exists.

No unexecuted check is reported as passing.

---

## H. Production Readiness Verdict

### **NOT APPROVED**

The backend cannot be approved for production, frontend integration or even a staging deployment in its current state.

Reasons, in order of severity:

1. **It does not build or migrate.** `pnpm build` fails; `pnpm start` fails; a fresh `db:migrate` silently leaves the database empty. This alone blocks deployment.
2. **Authorization does not exist.** Any visitor can read draft/private competitions, unpublished fixtures and draft lineups. Seeded roles/permissions are never enforced, so the intended privilege model is not real.
3. **The core business domain is absent.** There is no match engine, no fixture generation, no standings calculation, no lineup workflow, no registration workflow, no disciplinary system, no dispute system, no file storage and no audit writes. The brief's central features are not implemented.
4. **The database is not an integrity boundary.** It accepts contradictory registrations, duplicate/self/cross-season fixtures, negative scores, arbitrary events and invalid lineups. Any future write path will be unsafe without schema hardening.
5. **Session security is incomplete.** Access tokens survive logout and deactivation; logout-all and session revocation do not exist; the WebSocket is unauthenticated.
6. **The API contract is unreliable.** Expected 4xx errors become 500s, OpenAPI is semantically empty, and the existing frontend types/endpoints are not satisfied.
7. **There is no test or quality gate.** The only build command fails, and an empty `pnpm test` creates a false sense of safety.

This is not “approved with conditions” territory because the conditions would amount to building most of the backend: authorization, migrations, core workflows, integrity constraints, tests and the API contract. A conditional approval would misrepresent the current state.

---

## I. Prioritized Remediation Plan

The order below is deliberate: release/security/database foundations must be fixed before feature work, and feature work must be sequenced by dependency. Cosmetic/documentation work is last.

### Phase 0 — Make the project buildable and deployable

1. **Fix the TypeScript build.** Remove `drizzle.config.ts` from the application `tsconfig` (or create a separate build config) so `rootDir: src` is valid. Verify `pnpm typecheck`, `pnpm build` and `pnpm start`.
2. **Commit real migrations.** Generate and review the initial SQL plus `drizzle/meta/_journal.json`; commit them. Add a migration test that applies them to a fresh PostgreSQL database and asserts all expected tables exist.
3. **Make migration failure loud.** After `migrate`, assert the expected schema version/tables; exit non-zero if none exist. Add a deployment smoke check for `/health` and a basic authenticated request.
4. **Load configuration correctly.** Load `.env` in development or remove that instruction; read all settings through the validated `env` object.
5. **Fix the global error handler.** Map Zod, JWT, body-parser, payload-size, rate-limit and Postgres unique/constraint errors to correct 4xx codes; add a consistent not-found handler.
6. **Add CI.** Install, typecheck, build, migrate a disposable PostgreSQL database, run tests, and fail on lint/format errors.

### Phase 1 — Establish security boundaries

7. **Implement central authentication and permission enforcement.** Resolve roles/permissions from the database (with competition scope); add a reusable route guard and service-level checks; deny by default.
8. **Filter public reads.** Enforce competition visibility, fixture `published_at`, lineup status and announcement audience/publish state in SQL. Add tests proving anonymous users cannot see draft/private data.
9. **Implement session revocation.** Add session/token-version state checked on every request; support logout, logout-all, deactivation and password-change revocation; keep access tokens short-lived.
10. **Harden JWTs.** Require high-entropy secrets, reject placeholders, pin/verify algorithms, add issuer/audience/`jti`, and choose/test one token transport (httpOnly refresh + short access token is recommended).
11. **Add CSRF/Origin protection** for cookie-authenticated state-changing requests and document the deployment topology.
12. **Fix rate limiting.** Preserve 429 and `Retry-After`; cover refresh/WS; add per-account throttling; document single-instance storage.
13. **Secure WebSockets.** Authenticate the upgrade, authorize match/competition subscriptions, verify Origin, add heartbeat/connection limits, and broadcast only after commit.
14. **Reduce enumeration/logging exposure.** Dummy Argon2 verification for unknown users, generic registration/verification flow, pino redaction, expected-4xx log levels.

### Phase 2 — Make PostgreSQL enforce the invariants

15. **Add check constraints** for scores (non-negative, nullable until recorded), minutes/added minutes, coordinates 0–100, shirt numbers, points, date ordering and allowed enum/state values.
16. **Add consistency constraints:** composite foreign keys for group/season and team-registration/season; unique fixture key; home != away; same-season participants; case-insensitive email uniqueness.
17. **Fix player registration uniqueness:** one active player registration per season (or an explicit transfer/dual-registration model), season-scoped matriculation uniqueness, and approval/eligibility consistency.
18. **Add event and lineup integrity checks:** event team/player must belong to the match and same team; substitution relationships typed; lineup players must belong to the lineup team and be eligible; one captain, valid roles, formation/squad limits.
19. **Add transaction/row-lock patterns** for registration, refresh rotation, event creation, result confirmation and standings rebuild. Add unique-violation mapping and idempotency keys.
20. **Fix role scope:** nullable competition FK (or explicit scope table), documented global semantics, no magic UUID.
21. **Protect history:** restrict/archive group deletion, add audit immutability, soft-delete filters, `updated_at` maintenance and missing indexes.

### Phase 3 — Build the core domain in dependency order

22. **Competitions, seasons and groups:** create/update, rules, visibility, season lifecycle, group management, validation.
23. **Team and player registration:** submission, review, approval/rejection, membership, transfers, registration windows, roster locking, audit. Enforce the eligibility model centrally.
24. **Fixture generation:** format-aware round-robin/group/knockout scheduling, odd-team byes, home/away balance, duplicate prevention, preview/publish, reschedule/postpone/cancel, rest/venue constraints.
25. **Match engine:** official assignments, state machine, event creation/validation, transactional score derivation, own goals/assists/cards/substitutions, confirmation, correction with reason, immutable event history, audit.
26. **Lineups:** centralized eligibility, formation/starting XI/substitutes, captain, coordinates, submission/approval, all write paths checked.
27. **Standings and statistics:** confirmed-result-only calculation, points/tie-breakers, group tables, correction rebuild, event-derived player/team statistics with explicit unknown values.
28. **Disciplinary and disputes:** cases, suspensions, appeals, protests, evidence, internal notes, decisions, history, access control, audit.
29. **File storage:** real adapter, opaque server-generated keys, MIME sniffing/allowlist, size limits, checksums, private access/signed URLs, cleanup.
30. **Audit service:** transactional writes for every privileged action, read endpoint restricted by permission, immutability protection.

### Phase 4 — Complete the API/frontend contract

31. Define shared DTOs/OpenAPI schemas and stable error codes.
32. Add the missing read endpoints (`leagues`, team/player list/detail/statistics, match list, announcement detail, search, standings).
33. Add pagination/filtering/sorting and response metadata; remove unbounded queries and N+1 patterns.
34. Map database rows to frontend domain types (enums, nullable scores, numeric coordinates, event unions, roles) and implement a real frontend service adapter behind the existing interfaces.
35. Add contract/integration tests against the generated OpenAPI and the frontend types.

### Phase 5 — Verification and hardening

36. Build a comprehensive Vitest integration suite: auth/reuse/revocation, authorization matrix, DB constraints, concurrency, match transitions, score derivation, standings rebuild, eligibility, idempotent offline events, file access.
37. Add load tests for concurrent matches and event writes; inspect `EXPLAIN` plans and add indexes.
38. Correct documentation, generate OpenAPI from schemas, and add deployment/runbook checks.

### Do not do yet

- Do not add Redis, a message broker or microservices. The demonstrated needs are correctness, transactions, constraints and tests, not additional infrastructure.
- Do not build UI-facing admin screens before authorization and the domain services exist.
- Do not seed competition/team names until the organizer naming conflict is resolved (the README's caution is valid).

---

## Appendix — Key source references

- Application bootstrap/plugins/error handler: `backend/src/app.ts:17-112`
- Server/shutdown: `backend/src/server.ts:1-5`
- Environment: `backend/src/config/env.ts:2-3`
- Database client/migrator: `backend/src/database/client.ts:5`, `backend/src/database/migrate.ts:3`
- Schema: `backend/src/database/schema/index.ts:1-27`
- Seed: `backend/src/database/seed/run.ts:1-3`
- Auth routes/service: `backend/src/modules/auth/routes.ts:1-9`, `backend/src/modules/auth/service.ts:1-41`
- Competition reads: `backend/src/modules/competitions/routes.ts:1-11`
- Match reads: `backend/src/modules/matches/routes.ts:1-11`
- Announcement reads: `backend/src/modules/announcements/routes.ts:1-2`
- Shared errors/response: `backend/src/shared/errors.ts:1-6`, `backend/src/shared/response.ts:1-2`
- Frontend contracts/types: `frontend/src/services/contracts.ts`, `frontend/src/types/*.ts`, `frontend/src/services/index.ts:8`, `frontend/src/lib/api-client.ts:11,13-26`

**End of report.**
