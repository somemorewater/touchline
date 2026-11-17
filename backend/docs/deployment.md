# Deployment

Use a supported Node.js LTS on a Linux VPS and PostgreSQL with private network access. Provide configuration through the process environment or a protected `.env` file in the working directory.

## Build and start

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm db:migrate
pnpm start
```

Run `pnpm start` under systemd or another process supervisor. The compiled entry point is `dist/server.js`. Keep `NODE_ENV=production`, set `COOKIE_SECURE=true`, use a strong `JWT_ACCESS_SECRET` of at least 32 characters, production database credentials, and exact `CORS_ORIGINS`. Set `TRUST_PROXY=true` only when a trusted reverse proxy forwards client addresses.

`pnpm db:migrate` is a deployment step, not an application-start side effect. It fails non-zero on an unreachable database, missing/invalid migration metadata, or an empty migration, so a failed migration blocks the release. Review generated SQL before deploying it.

## Health probes

- Liveness: `GET /health/live` — restart the process only when this fails repeatedly.
- Readiness: `GET /health` or `GET /ready` — remove the instance from the load balancer while this returns `503`.

The process intentionally starts while PostgreSQL is unavailable so liveness and readiness remain distinguishable. Readiness recovers when the database reconnects.

## Shutdown

Send `SIGTERM` and allow the process to stop accepting requests, close the HTTP server and end database connections. The included handlers exit with status `0` on a clean shutdown. Configure the supervisor's stop timeout above the longest expected in-flight request.

## Logging and error contract

Expected client errors are logged at warn level with the request ID. Unexpected errors are logged at error level with the request ID and details needed for diagnosis. HTTP responses never include stack traces, SQL, credentials or tokens; they use the common `success:false` error object with `code`, `message`, `statusCode` and `requestId`.

## Reverse proxy and backups

Place a reverse proxy in front of the API, terminate HTTPS there, and forward only from trusted proxy addresses. Back up PostgreSQL regularly with `pg_dump -Fc touchline > touchline.dump`; restore into a new database using `createdb touchline_restore && pg_restore -d touchline_restore touchline.dump`. Test restores and retain encrypted off-host copies. Evidence files are stored under `FILE_STORAGE_DIR` by the local adapter; back up that directory separately and use a shared volume or object store for multi-instance deployments.
