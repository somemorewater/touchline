# TOUCHLINE API

Fastify modular monolith for TOUCHLINE. PostgreSQL is the source of truth; Drizzle owns schema and migrations. The current implementation provides validated runtime configuration, health/readiness and OpenAPI endpoints, Argon2id authentication with session-bound access tokens, immediate session revocation, centralized RBAC and resource-scope enforcement, the foundational relational schema, and read routes for competitions, seasons, fixtures, match details/events/lineups, and announcements. Private/draft records are filtered at the SQL layer.

## Requirements

- Node.js 22+
- pnpm 10+
- PostgreSQL 16 (or a compatible supported version)

## Setup

1. Create a PostgreSQL database and user.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and a private `JWT_ACCESS_SECRET` of at least 32 characters.
3. Install dependencies and apply the committed migrations:

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The API listens on `:4000` by default, OpenAPI UI is at `/docs`, and routes are under `/api/v1`.

`db:seed` only inserts baseline roles and permissions. It deliberately does not seed AFIT teams or production credentials. `.env` is never committed.

## Scripts

- `pnpm dev`: watch mode
- `pnpm typecheck`: type-check application and tooling TypeScript
- `pnpm build`: compile strict TypeScript to `dist/`
- `pnpm start`: run the compiled server from `dist/`
- `pnpm start:deploy`: apply compiled migrations, seed missing security roles, then start the server (used by Render)
- `pnpm test`: run the Phase 1 error-contract suite and, when `TEST_DATABASE_URL` is set, the real-database security regression suite
- `pnpm db:generate`: generate a new Drizzle migration after a schema change
- `pnpm db:migrate`: validate and apply committed migrations from source
- `pnpm db:migrate:prod`: apply committed migrations from the compiled `dist/`
- `pnpm db:check`: validate Drizzle migration metadata
- `pnpm db:seed`: repeatable canonical role/permission seed (converges grants)
- `pnpm db:seed:prod`: insert-only missing role, permission and grant seed used by deployments

Migrations are committed under `drizzle/`. Run `db:generate`, review the generated SQL, and commit both the SQL file and `drizzle/meta/`. `db:migrate` fails with a non-zero exit code when the journal or SQL is missing or invalid, when a migration is empty, or when the database cannot be reached.

## Health and readiness

- `GET /health/live`: liveness only; returns `200` while the process is running.
- `GET /health`: readiness; checks the database and returns `200` or `503`.
- `GET /ready`: alias of `/health` for orchestrators.

The process starts even when the database is unavailable at boot so that liveness and readiness can be observed separately. Readiness remains `503` until the database recovers.

## Error contract

Failures use one JSON shape:

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

`details` is optional and only contains safe field/message pairs. Internal error responses never include stack traces, SQL, credentials or tokens. The status contract is `400` validation/malformed input/invalid UUID, `401` missing/invalid/expired/revoked authentication, `403` insufficient permission for an authenticated caller, `404` not found or deliberately hidden private resource, `409` conflict, `413` oversized body, `429` rate limit, and `500` unexpected internal failure.

## Security

Authentication is centralized in `src/security/`. Access tokens are bound to a server-side session and stop working immediately after logout, logout-all, deactivation or refresh-token reuse. Roles and permissions are loaded from the database on every request; competition-scoped grants and resource ownership are enforced by shared helpers. Public reads expose only published/public records, while scoped managers, assigned officials and team captains receive the private records they are entitled to. WebSocket connections authenticate before upgrade and authorize each match subscription. See `docs/authentication.md`, `docs/authorization.md` and `docs/realtime.md`.

## Current scope

See `docs/api.md` for routes and limits. The master brief describes additional write workflows (registration review, fixture generation, live event reporting/result confirmation, standings recalculation, disciplinary/dispute/bracket management, file storage and authenticated WebSocket subscriptions). Those remain planned, not represented as finished. No route returns fabricated records. AFIT name mappings remain unresolved: the frontend has two differing lists with only AUTOMECH BOIS, TELECOM FC and AEROSPACE matching exactly. Do not seed either interpretation until organizers decide.
