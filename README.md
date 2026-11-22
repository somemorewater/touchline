# TOUCHLINE

TOUCHLINE is a football competition platform for running a U25 league: teams and
player registrations, fixtures and results, live match updates, lineups,
standings, officials, disciplinary cases, disputes, announcements and
notifications. Access is role-based (super admin, competition admin, team
captain, match official, registered user) and the backend is the authority for
every permission check.

## Architecture

- **`frontend/`** — Next.js 15 (App Router), React 19 and TypeScript. Data is
  fetched through a typed API client in `src/lib/api/` and surfaced to existing
  view components via `src/services/`. Styling uses CSS modules and shared CSS
  utilities; no UI framework is required. An optional labelled demo dataset can
  be enabled with `NEXT_PUBLIC_TOUCHLINE_DATA=demo`.
- **`backend/`** — Fastify 5 modular monolith using Drizzle ORM and PostgreSQL.
  It provides Argon2id password hashing, session-bound JWT access tokens with
  httpOnly refresh cookies, role and competition-scope authorization, validated
  request contracts, committed SQL migrations, and an authenticated WebSocket
  channel for match updates. Swagger UI is available at `/docs`.
- **`docs/`** — additional project documentation and review notes.

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker Engine with the Docker Compose plugin

## Local setup

Start PostgreSQL 16. Data is stored in the named `touchline_postgres-data`
volume and survives container restarts and recreation:

```bash
docker compose up -d postgres
docker compose exec postgres pg_isready -U touchline -d touchline
```

Wait until `pg_isready` reports that the server is accepting connections. The
Compose defaults are database `touchline`, user `touchline` on
`localhost:5432`; set `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` in
a local `.env` to override them. Port `55433` is also published for compatibility
with existing local `DATABASE_URL` files.

Backend:

```bash
cd backend
cp .env.example .env          # set DATABASE_URL to match Compose and set a private JWT_ACCESS_SECRET (32+ chars)
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev                      # API at http://localhost:4000/api/v1
```

Frontend (second terminal):

```bash
cd frontend
cp .env.example .env.local    # point at your backend; WS URL is the origin only
pnpm install
pnpm dev                      # http://localhost:3000
```

The frontend defaults to `http://localhost:4000/api/v1` and
`ws://localhost:4000`. `CORS_ORIGINS` must include the frontend origin.

### Local PostgreSQL lifecycle

```bash
docker compose stop postgres   # stop PostgreSQL; data is kept
docker compose down            # remove containers and network; named volumes are kept
docker compose down -v         # WARNING: permanently deletes the local database volume
```

`docker compose down -v` and `docker volume rm touchline_postgres-data` both
permanently delete local database data; `down -v` also removes pgAdmin state.
Use them only when you intend to start from an empty database.

Database migrations are committed under `backend/drizzle/`. Use
`pnpm db:generate` after a schema change, review the generated SQL and commit it
with `drizzle/meta/`. `pnpm db:check` validates the migration journal.

Detailed setup, authentication bootstrap, API contracts and limits are in:

- `frontend/README.md`
- `backend/README.md`
- `backend/docs/api.md`
- `backend/docs/development.md`

## Repository layout

```
backend/    Fastify API, Drizzle schema and migrations, tests, API docs
frontend/   Next.js application, typed API layer, services and demo data
docs/       Additional review/architecture notes
```

Local-only environment files, generated build output, dependencies, databases,
uploads, Docker Compose helpers and the old static prototype are intentionally
not committed.
