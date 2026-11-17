# TOUCHLINE — frontend

Next.js/TypeScript frontend for the TOUCHLINE competition platform. It talks to
the Fastify backend in `../backend` through a single typed API client. No data
is fetched directly inside components.

## Prerequisites

- Node.js 20+ and pnpm
- The backend running locally on `http://localhost:4000`
- PostgreSQL for the backend (see `../backend/.env.example`)

## 1. Start the backend

```bash
cd ../backend
cp .env.example .env          # edit DATABASE_URL and the JWT secrets
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev                      # http://localhost:4000, API at /api/v1
```

`CORS_ORIGINS` must include the frontend origin (`http://localhost:3000` by
default). Cookies are httpOnly; keep `COOKIE_SECURE=false` only for local HTTP.

## 2. Configure the frontend

```bash
cd ../frontend
pnpm install
cp .env.example .env.local    # or edit .env.development
```

| Variable | Purpose | Default in code |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | REST origin including `/api/v1` | `http://localhost:4000/api/v1` |
| `NEXT_PUBLIC_WS_BASE_URL` | WebSocket origin only | derived from the API URL |
| `NEXT_PUBLIC_TOUCHLINE_DATA` | `demo` for offline sample data; anything else uses the API | API |

The WebSocket URL must **not** include `/ws`; the client appends
`/ws/matches/:matchId`.

```bash
pnpm dev                      # http://localhost:3000
```

## 3. Authentication and the first administrator

There is no bootstrap administrator endpoint. Register a normal account, then
grant `super_admin` directly in PostgreSQL:

```sql
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.email = 'you@example.com'
  AND r.name = 'super_admin'
ON CONFLICT DO NOTHING;
```

Sign in at `/login`, then open `/admin`. Competition administrators created
through the admin console are scoped to explicit competitions.

Session behaviour:

- The access token is held in memory only.
- The refresh token stays in the backend's httpOnly cookie, scoped to
  `/api/v1/auth`.
- A page reload calls `POST /auth/refresh` and then `/auth/me`.
- WebSocket authentication uses the access cookie scoped to `/ws`; no token is
  placed in the URL.
- A revoked or expired session clears the cache and returns the UI to the
  signed-out state.

Password minimum length is 12 characters.

## 4. What is integrated

- Public browsing: home, competitions and seasons, teams, players,
  fixtures/matches, match centre, standings, statistics, news.
- Auth: register, login, logout, logout-all, account view.
- Captain workspace: team entries, lineup drafts/submission, player
  registrations.
- Official workspace: assigned matches, verified event reporting, result
  confirmation.
- Admin console (`/admin`): operational overview, competitions/seasons/groups,
  teams and captain assignment, player registration review, fixtures and
  round-robin generation, match lifecycle/events/results/corrections, match
  officials, standings snapshots, users/roles/sessions, administrator accounts,
  announcements, audit log, disciplinary cases/sanctions and disputes/evidence.
- In-app notifications with read state. Notifications are HTTP only; there is
  no notification WebSocket or email delivery.
- Live match updates over `/ws/matches/:id`, with reconnect/backoff and polling
  fallback on the match centre.

Authorization is presentation-only in the browser. Every action is re-checked by
the backend against the caller's roles, competition scope and permissions.

## Data honesty

- Assists and minutes played are not recorded by the backend. They are shown as
  “not recorded”, never as zero.
- Standings come from `/standings` and its published snapshot metadata; they are
  not recomputed in the browser.
- There is no public “squad” endpoint. Public player lists are derived from
  statistics and lineups; staff use the registration endpoints.
- Internal disciplinary notes and internal dispute entries are filtered by the
  server for non-reviewers and are never stored separately in client state.
- Times are displayed in UTC because competitions have no time zone field.

## Demo mode

`NEXT_PUBLIC_TOUCHLINE_DATA=demo` switches to labelled offline sample data. It
is useful for UI work without a backend, but admin, captain and official write
actions require the real API. The demo path is read-only in practice.

## Before shipping

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

Set production API/WS URLs through the environment at build time. The backend
still needs production secrets, `COOKIE_SECURE=true`, a trusted reverse proxy
and a matching `CORS_ORIGINS`.

## Limitations

- Notifications and announcements are not pushed; refresh or polling is needed.
- The WebSocket broadcast is single-instance by design.
- No email, push, password reset or email verification exists.
- No assists/minutes, brackets or payment flows exist.
- Result correction, disputes and disciplinary decisions are separate actions;
  a dispute decision never changes a result automatically.

## Project layout

- `src/lib/api/types.ts` — backend response shapes
- `src/lib/api/client.ts` — base URL, envelope unwrapping, refresh, errors
- `src/lib/api/endpoints.ts` — the typed endpoint surface
- `src/services/` — demo/API switch implementing the existing service contract
- `src/features/` — auth, competitions, matches, lineups, admin, captain,
  official, notifications, account
- `legacy/` — the original static site, untouched

## Security note on the legacy site

`legacy/app.js` contains an admin username and password hash in client-side
JavaScript. It was not carried over. If that password is used anywhere else,
change it.
