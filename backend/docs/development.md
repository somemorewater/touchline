# Development

## Requirements

- Node.js 22+
- pnpm 10+
- PostgreSQL 16 (or a compatible supported version)

## Setup

```bash
cd backend
pnpm install
cp .env.example .env
# edit DATABASE_URL and JWT_ACCESS_SECRET
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The server loads `.env` from the current working directory when present. Variables already set in the shell take precedence over `.env`, which is useful for one-off environments. `.env` is ignored by Git.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `test` or `production` |
| `HOST` | no | `0.0.0.0` | Listen address |
| `PORT` | no | `4000` | Integer from 1 to 65535 |
| `DATABASE_URL` | yes | — | Must start with `postgres://` or `postgresql://` |
| `JWT_ACCESS_SECRET` | yes | — | At least 32 characters; must not be the example value |
| `JWT_ISSUER` | no | `touchline-api` | Enforced on access-token verification |
| `JWT_AUDIENCE` | no | `touchline-client` | Enforced on access-token verification |
| `ACCESS_TOKEN_TTL` | no | `15m` | Access token lifetime |
| `REFRESH_TOKEN_DAYS` | no | `30` | Fixed session lifetime, 1–365 days |
| `REFRESH_REUSE_GRACE_SECONDS` | no | `10` | Concurrent-refresh tolerance, 0–300 |
| `COOKIE_SECURE` | no | `false` | Set `true` behind HTTPS |
| `CORS_ORIGINS` | no | `http://localhost:3000` | Comma-separated browser origins; also the WebSocket cookie origin allowlist |
| `TRUST_PROXY` | no | `false` | Enable only behind a trusted proxy |
| `FILE_STORAGE_DIR` | no | `./var/uploads` | Local evidence storage root |
| `FILE_MAX_BYTES` | no | `5242880` | Upload limit, 1 byte – 25 MB |

Configuration is validated before the server starts. Missing or invalid required values print a clear error and exit with a non-zero status. Boolean variables only accept `true` or `false`.

## Database and migrations

Schema definitions live in `src/database/schema/index.ts`. Migrations are committed under `drizzle/` and tracked by Drizzle in the `drizzle.__drizzle_migrations` table.

```bash
pnpm db:generate   # after changing the schema; review the generated SQL
pnpm db:migrate    # validate and apply committed migrations
pnpm db:check      # validate Drizzle migration metadata
pnpm db:seed       # converge roles, permissions and grants
```

`db:migrate` fails with a non-zero exit code when the migrations folder, journal or SQL file is missing, when the journal is invalid, when a migration contains no statements, when the database is unreachable, or when migration tracking is incomplete. Running it twice is safe.

Review generated SQL before committing it. `db:generate` cannot express partial indexes, triggers, SQL functions, preflight blocks or upgrade-safe backfills, and it places `NOT NULL` before the backfill that fills the column. Migrations `0002`, `0003`, `0004` and `0005` are hand-hardened for those reasons. If you edit migration SQL after generation, update the matching `drizzle/meta/000N_snapshot.json` entry so `pnpm db:check` passes and the next `pnpm db:generate` reports no drift.

Migration `0002` runs a read-only preflight for identity and registration invariants. Migration `0003` runs preflights for unsupported season statuses and duplicate active team names. Migration `0004` runs preflights for Phase 5 fixture/match consistency (participants, confirmed-result status, clock ranges, actor references) before adding fixture status, match clock/result and event void/correction columns. Migration `0005` runs preflights for unrecognised lineup statuses and duplicate snapshot versions, then adds lineup review metadata and current-snapshot tracking. If historical rows violate a new rule, the whole migration aborts, reports the offending IDs, and leaves the previous schema untouched. Fix the rows manually, then rerun. Never delete or reassign history to make a constraint pass. See `data-integrity.md` for the backfill and ambiguity policy.

`db:seed` is idempotent and canonical: it upserts the roles/permissions from `src/security/permissions.ts`, replaces each role's grants, and removes permissions no longer in the catalog. Competition and AFIT team data remain intentionally unseeded pending organizer reconciliation.

## Build, type-check and run

```bash
pnpm typecheck     # application source + drizzle.config.ts
pnpm build         # emits dist/ and fails without emitting on type errors
pnpm start         # runs node dist/server.js
```

The application compilation boundary is `src/`. `tsconfig.tools.json` separately checks `drizzle.config.ts`, so tooling cannot pull files outside `rootDir` into the application build.

## Tests

```bash
pnpm test
```

Suites:

- `tests/error-handling.test.ts` — Phase 1 error contract; no database required.
- `tests/security.test.ts` — authentication, revocation, refresh concurrency/reuse, RBAC, ownership, publication visibility and WebSocket authorization. It **requires** `TEST_DATABASE_URL` and is skipped otherwise.
- `tests/integrity.test.ts` — Phase 3 constraints, triggers, rollback, idempotency and concurrent uniqueness against real PostgreSQL. It **requires** `TEST_DATABASE_URL` and is skipped otherwise.
- `tests/competition-management.test.ts` — Phase 4 competition/season lifecycle, scoped administrator limits, team/captain provisioning rollback, captain ownership, registration lifecycle/history, approval revalidation and concurrent approval. It **requires** `TEST_DATABASE_URL` and is skipped otherwise.
- `tests/match-engine.test.ts` — Phase 5 fixture creation/validation, publication visibility, round-robin generation (even/odd/double legs, existing fixtures), official assignment/self-assignment, lifecycle and clock state machine, concurrent transitions, event validation/idempotency/conflict races, corrections/voids and score derivation, result submission/correction/history, and post-commit WebSocket delivery. It **requires** `TEST_DATABASE_URL` and is skipped otherwise.
- `tests/phase6.test.ts` — Phase 6 lineup ownership/scope and lifecycle, formation/eligibility/incompleteness rejection, concurrent lineup creation, confirmed-result player/team statistics (own goals, cards, substitutions, clean sheets, unconfirmed exclusion), league and group standings, snapshot versioning/current selection and result-driven invalidation, deterministic tie-breaking and group isolation. It **requires** `TEST_DATABASE_URL` and is skipped otherwise.
- `tests/phase7.test.ts` — Phase 7 user listing/search/pagination/status/role escalation/session revocation/history, scoped competition overview, disciplinary lifecycle/sanctions/eligibility without registration mutation, dispute privacy/decisions without result mutation, evidence validation/storage/access/removal, announcement draft/audience visibility, notification recipient isolation/read state, and scoped/sanitized/append-only audit reads. It **requires** `TEST_DATABASE_URL` and is skipped otherwise.

All database suites apply committed migrations and truncate domain data between tests. They must run against disposable databases, never a shared one. Each suite assumes it owns the database, so run them separately or disable file parallelism when sharing one database:

```bash
docker run -d --name touchline-security-pg \
  -e POSTGRES_PASSWORD=touchline -e POSTGRES_USER=touchline \
  -p 55432:5432 postgres:16
docker exec touchline-security-pg createdb -U touchline touchline_security
docker exec touchline-security-pg createdb -U touchline touchline_integrity

cd backend
TEST_DATABASE_URL='postgres://USER:PASSWORD@127.0.0.1:5432/touchline_security' pnpm test
```

To run every database suite against one database in a single command, add `pnpm exec vitest run --no-file-parallelism`. The integrity suite covers active-registration and matriculation uniqueness, season/group consistency, fixture identity and reversed legs, score and event rules, lineup/formation/coordinate rules, cross-record snapshots and announcements, transaction rollback, offline retry idempotency and concurrent insert races. The match-engine suite covers fixture generation and visibility, official assignment, the period state machine, concurrent transitions, event idempotency/correction/voids, result confirmation and WebSocket delivery. The Phase 6 suite covers lineup lifecycle and authorization, eligibility/formation rejection, concurrent lineup creation, derived player/team statistics, standings calculation, group isolation, snapshot versioning/current selection and invalidation. The Phase 7 suite covers administration, discipline, disputes, evidence, announcements, notifications and audit scope. Current full-suite result: 7 files / 98 tests passing.

## Runtime behavior

- `/health/live` reports process liveness only.
- `/health` and `/ready` check PostgreSQL and return `503` with `DATABASE_UNAVAILABLE` when it is unreachable.
- The server starts even if PostgreSQL is unavailable at boot, so liveness and readiness can be distinguished. Readiness recovers automatically when the database returns.
- `SIGINT`/`SIGTERM` stop accepting requests, close the HTTP server and end the postgres.js pool before exiting.
- WebSocket revocation uses an in-process registry. Single-instance deployments are supported; multi-instance deployments need a shared revocation mechanism.

## Manual verification checklist

1. `pnpm typecheck`, `pnpm build` and `pnpm db:check`.
2. `pnpm db:migrate` against an empty database, then run it again.
3. Confirm all 33 tables exist, the CHECK constraints and validation triggers (lineup, match event and audit append-only) are present, and `drizzle.__drizzle_migrations` has one row per migration.
4. Run `pnpm db:migrate` with an invalid `DATABASE_URL` and with a missing/invalid migration to confirm a non-zero exit.
5. For an upgrade, apply `0000`/`0001` to a scratch database, insert representative history, then apply `0002`. Confirm `player_registrations.season_id` and `lineup_players.match_id/team_registration_id` are backfilled and no rows changed count.
6. Deliberately create a duplicate active registration or matriculation number in the scratch database and confirm `0002` aborts, lists the IDs, and leaves the Phase 2 schema and data untouched.
7. Run `pnpm test` without `TEST_DATABASE_URL` (Phase 1 only), then the database suites against disposable PostgreSQL 16.
8. Start the server with valid configuration, then with a missing required variable.
9. Register, log in, call `/auth/me`, log out and confirm the same access token now returns `401`.
10. Confirm draft competitions and unpublished fixtures are not anonymously visible; grant a scoped admin and confirm they become visible.
11. Connect to `/ws/matches/:id` without credentials (rejected), with a valid token (ready), then log out and confirm the socket closes.
12. Check `/health/live`, `/health` and `/ready`, including with PostgreSQL stopped.
13. Send `SIGTERM` and confirm the process exits cleanly.
14. Create a competition as a super admin, create a scoped competition admin, and confirm the admin can update only assigned competitions and cannot create administrators.
15. Create a season and team entry, provision a captain, and confirm a failed second captain assignment leaves no new `users` row.
16. Submit a player registration as the captain, reject/resubmit it, then approve concurrently from two requests and confirm one `200` and one `409`.
17. Create four team entries and preview a round-robin schedule; confirm `n(n−1)/2` unique pairings, then commit it and confirm a repeat commit returns `409`. Re-run generation after adding a manual fixture and confirm the existing fixture is preserved.
18. Assign an official, start the match, advance half-time/second-half/full-time, and confirm invalid transitions return `409`. Submit the report and confirm the score matches the recorded events.
19. Retry an event with the same `clientEventId` and confirm `200`, `created:false`; reuse it with a different minute and confirm `409`.
20. With a live WebSocket client, trigger a transition and confirm a `match.update` frame arrives after the REST response.
21. Apply `0004` to a Phase 4 database with existing fixtures and confirm the fixture/match counts are unchanged and `status = 'scheduled'`. Deliberately insert a confirmed result on a non-`full_time` match and confirm the migration aborts and rolls back.
22. Run `pnpm db:generate` after migrating and confirm it reports “No schema changes, nothing to migrate”.
23. Create a draft lineup with missing players, submit it and confirm `400`; complete it with a supported formation, eleven starters, one goalkeeper, one captain and matching coordinates, then submit and confirm it. Confirm a second confirm/withdraw race yields one success.
24. Confirm a match official can read a lineup but receives `403` on confirm/return, and that a captain cannot confirm their own lineup.
25. Confirm statistics exclude an unconfirmed result, count only starters as appearances, credit own goals to `ownGoals` (not `goals`), and omit minutes/assists.
26. Publish a standings snapshot, recalculate it and confirm the version advances while the old row is preserved; correct/reopen a result and confirm the current snapshot is cleared and audited.
27. Run `0005` against a five-migration Phase 5 database with existing snapshots and confirm the newest version becomes current, older rows are unchanged, and migration count reaches 6. Deliberately create a duplicate snapshot version and confirm the preflight aborts with no new columns.
