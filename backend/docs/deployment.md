# Deployment

Use a supported Node.js LTS on a Linux VPS and PostgreSQL with private network access. Provide configuration through the process environment or a protected `.env` file in the working directory.

## Build and start

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm start:deploy
```

Run `pnpm start:deploy` under systemd or another process supervisor. It applies the compiled migrations from `dist/database/migrate.js` and only starts `dist/server.js` if they succeed. Keep `NODE_ENV=production`, set `COOKIE_SECURE=true`, use a strong `JWT_ACCESS_SECRET` of at least 32 characters, production database credentials, and exact `CORS_ORIGINS`. Set `TRUST_PROXY=true` only when a trusted reverse proxy forwards client addresses.

The migration runner exits non-zero on an unreachable database, missing/invalid migration metadata, an empty migration, or incomplete tracking, so a failed migration prevents the server from starting. It resolves the committed SQL and journal from `backend/drizzle/` relative to the compiled module, not the process working directory. A PostgreSQL advisory lock serializes concurrent migration attempts across instances. Review generated SQL before deploying it.

## Render

The repository has no root `package.json`, so the backend service must use `backend` as its **Root Directory**. Build output is gitignored, so compilation has to run on every deployment.

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Build Command | `pnpm install --frozen-lockfile --prod=false && pnpm build` |
| Start Command | `pnpm start:deploy` |

`pnpm build` compiles `src/` to `dist/`, including `dist/database/migrate.js`; `pnpm start:deploy` runs that migration runner before `dist/server.js`. `--prod=false` is required because TypeScript is a dev dependency and would otherwise be unavailable to the build on a production install. The committed `drizzle/` directory remains part of the deployed repository and is required at runtime.

The repository root contains a `render.yaml` Blueprint with the same settings. If the service was created manually in the Render dashboard, set the values above there instead. A failed migration exits non-zero, so Render aborts the start and keeps the previous successful deploy running.

Render pre-deploy commands are available only for paid services. On a paid service you may alternatively set the **Pre-Deploy Command** to `pnpm db:migrate:prod` and the **Start Command** to `pnpm start`; migrations then run once per deploy. The checked-in Blueprint uses `pnpm start:deploy` so the same workflow also works on the free plan.

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
