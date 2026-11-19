# Authentication

## Credentials

`POST /api/v1/auth/register` accepts `email`, `displayName` and an 8+ character password. The body is strict: unknown fields such as `role`, `permissions` or `userId` are rejected with `400 VALIDATION_ERROR`. Registration always assigns only the seeded `registered_user` role; it never accepts client-supplied authorization data.

`POST /api/v1/auth/login` verifies the Argon2id password and creates a server-side **session**. It returns an access JWT in JSON and sets two HTTP-only, SameSite=Lax cookies:

| Cookie | Path | Purpose |
|---|---|---|
| `refresh_token` | `/api/v1/auth` | Random 48-byte refresh token; only its SHA-256 hash is stored |
| `access_token` | `/ws` | Browser-only WebSocket credential; never sent to REST routes |

Set `COOKIE_SECURE=true` behind HTTPS. HTTP clients authenticate REST requests with `Authorization: Bearer <accessToken>`.

## Access tokens

Access tokens are JWTs signed with `JWT_ACCESS_SECRET` and bound to a database session through the `sid` claim. Every token also carries `sub` (user ID), `email`, `iss` and `aud`.

- `JWT_ISSUER` defaults to `touchline-api`.
- `JWT_AUDIENCE` defaults to `touchline-client`.
- `ACCESS_TOKEN_TTL` defaults to `15m`.
- Verification enforces the signature, issuer, audience and expiry. `JWT_ACCESS_SECRET` must be at least 32 characters and must not be the `.env.example` placeholder.

A valid signature alone is not sufficient. Every authenticated request loads the session and user and rejects the request when:

- the session does not exist, belongs to another user, is revoked or has expired;
- the user no longer exists or `is_active` is false;
- the token is malformed or its `sid`/`sub` claims are missing.

This database check is what makes revocation immediate instead of waiting for the JWT to expire.

## Session lifecycle

1. **Login** inserts a `sessions` row whose `expires_at` is `now + REFRESH_TOKEN_DAYS` and inserts the first hashed refresh token in that session's family.
2. **Authenticated request** validates the JWT, then validates the session/user/roles in one indexed lookup.
3. **Refresh** locks the refresh-token row and the session row, checks session/user state, revokes the presented token, inserts a new hashed token with the **same fixed session expiry**, and returns a new access token with the same `sid`.
4. **Logout** revokes the current session and every refresh token in its family. This works from the refresh cookie or, for API clients, from the bearer token's `sid`.
5. **Logout-all** revokes every session and refresh token belonging to the user.
6. **Deactivation** revokes every session immediately. Reactivation changes only `is_active`; it never un-revokes a session, so the user must log in again.

Refresh tokens remain random, are stored only as hashes, and are never written to logs. Session expiry is fixed at login rather than sliding indefinitely.

## Password changes

`POST /api/v1/auth/change-password` requires a valid access token. The body is strict and accepts only `currentPassword`, `newPassword` and `confirmPassword`; a client-supplied user ID is rejected with `400 VALIDATION_ERROR`. The user is always taken from the verified token (`sub`), so an account can only change its own password.

The current password is checked with the existing Argon2id verifier. The new password must be 8–128 characters, match the confirmation, and differ from the current password. An incorrect current password returns `400 INVALID_CURRENT_PASSWORD`; the other cases return `400 VALIDATION_ERROR`. None of the responses include password hashes or token material.

On success the service updates the hash with a conditional write against the previously verified hash, so concurrent changes cannot silently overwrite each other. In the same transaction it revokes every session (`revoked_reason = 'password_change'`) and refresh token belonging to that user only; other accounts are unaffected. Live WebSocket connections for the user are closed after the commit, both auth cookies are cleared, and the response is `{ "changed": true }` with `Cache-Control: no-store`. The user must sign in again with the new password.

## Refresh reuse and concurrency

Refresh rotation runs in a database transaction using `SELECT ... FOR UPDATE` on the token and session rows.

- Concurrent refreshes of the same token serialize. One wins; the loser sees the rotated token and receives `401 REFRESH_TOKEN_ROTATED` without revoking the healthy family.
- This tolerance is limited to `REFRESH_REUSE_GRACE_SECONDS` (default `10`, maximum `300`).
- Presentation of a revoked token **outside** that grace window is treated as reuse: the session and the whole token family are revoked, and the caller receives `401 REFRESH_REUSE_DETECTED`.
- Using a token whose session was logged out, deactivated or expired returns `401` and the family stays revoked.

## WebSocket authentication

A browser connects to `/ws/matches/:id` with the `access_token` cookie and an allowlisted `Origin` from `CORS_ORIGINS`. Non-browser clients send `Authorization: Bearer <accessToken>`. Missing, invalid, expired or revoked credentials are rejected during pre-validation, before the protocol upgrade, so unauthenticated clients never receive `connection.ready`. Cookie authentication without an allowlisted origin is rejected to prevent cross-site WebSocket hijacking.

## Not implemented

Email delivery, forgot/reset password, MFA, session listing/revocation UI and a dedicated CSRF token flow remain pending. The current cookies are SameSite=Lax and only used for refresh/logout and the match WebSocket; there is no cookie-authenticated REST mutation surface yet.
