# User and role administration

`modules/users` exposes account and role administration on top of the existing identity model. Accounts are never hard-deleted; status changes and role history remain auditable.

## Authorization

- `users.read` reads accounts, role assignments and associations. Super administrators read globally; competition administrators read only users connected to their competition.
- `users.manage` is a **global** permission held by `super_admin`. It gates deactivate, activate, suspend, restore and session revocation. Competition administrators cannot change account status.
- `roles.manage` gates grants and revocations. Super administrators may grant any non-system role globally or in any competition. Competition administrators may grant or revoke only `team_captain` and `match_official` inside a competition where they hold `roles.manage`.

A visible but unauthorized operation returns `403`; a user outside the caller's scope returns `404`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/users` | Paginated list; filters `q`, `status`, `role`, `competitionId` |
| GET | `/api/v1/users/:id` | Account record |
| GET | `/api/v1/users/:id/roles` | Role assignments with competition names |
| GET | `/api/v1/users/:id/associations` | Captain entries, staff roles, official assignments |
| GET | `/api/v1/users/:id/history` | Audit-backed account and role history |
| POST | `/api/v1/users/:id/deactivate` | Disable an active account and revoke sessions |
| POST | `/api/v1/users/:id/activate` | Re-enable a non-suspended account |
| POST | `/api/v1/users/:id/suspend` | Disable with a required reason and revoke sessions |
| POST | `/api/v1/users/:id/restore` | Clear suspension and re-enable |
| POST | `/api/v1/users/:id/sessions/revoke` | Revoke all sessions without changing status |
| POST | `/api/v1/users/:id/roles` | Grant `{ role, competitionId? }` |
| DELETE | `/api/v1/users/:id/roles/:role?competitionId=` | Revoke one assignment |

`limit` is `1..100` (default 25); `offset` is non-negative. List responses use `{ items, pagination }`.

## Status semantics

- `active` — `is_active = true`, no suspension.
- `inactive` — `is_active = false`, no suspension.
- `suspended` — `is_active = false`, `suspended_at`, `suspended_reason` and `suspended_by` set.

Only one of these states is possible; the database check enforces that suspension metadata is complete. `activate` refuses a suspended account and directs the caller to `restore`. Suspending or deactivating revokes every session and closes live WebSocket connections for that user.

The last global `super_admin` cannot be deactivated, suspended or have the global `super_admin` role revoked. Administrators cannot deactivate or suspend their own account.

## Scope rules

A competition administrator sees a user only when the user:

- has a role assignment scoped to that competition,
- captains a team entry in a season of that competition, or
- is assigned as a match official in that competition.

Global role assignments and unrelated users are outside that scope. `competitionId` narrows the same rules further.

## Role grant rules

`assertRoleAssignmentAllowed` centralizes escalation checks:

- no self-assignment;
- `visitor` and `registered_user` cannot be granted through this route;
- competition administrators can only grant/revoke `team_captain` or `match_official` within their permitted competition;
- only a global `super_admin` can grant or revoke `super_admin` and can grant `competition_admin`;
- grants require an active target account.

Role removal deletes the assignment row but leaves the audit trail and the account intact. New operations write `user.*` audit rows in the same transaction, including competition scope where applicable.

## Privacy

Responses expose only `id`, `email`, `displayName`, `isActive`, suspension metadata, timestamps and role/association data. Passwords, password hashes, refresh-token hashes, access tokens and cookies are never selected or serialized. The audit endpoint additionally sanitizes snapshots.
