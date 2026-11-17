# Audit log

`audit_logs` is the append-only history for administrative and domain operations. The Phase 7 endpoint exposes filtered, scoped, paginated reads; writes remain inside the business transaction that changed state.

## Endpoint

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/audit-logs` | Filtered audit history |

Query parameters:

| Parameter | Rules |
|---|---|
| `competitionId` | UUID |
| `seasonId` | UUID |
| `actorUserId` | UUID |
| `action` | 1–100 chars, exact match |
| `entityType` | 1–80 chars, exact match |
| `entityId` | UUID |
| `from`, `to` | ISO timestamps with offset; `to >= from` |
| `limit` | `1..100`, default 25 |
| `offset` | `>= 0` |

Results are ordered newest first and returned as `{ items, pagination }`.

## Authorization and scoping

- A global `audit.read` permission (super administrator) reads all rows.
- A competition-scoped `audit.read` grant reads only rows whose `competition_id` is in the caller's scopes.
- No scope → `403 FORBIDDEN`.
- A scoped caller asking for another competition gets an empty page, not another competition's data.

Historical rows are backfilled where the entity relationship is unambiguous (`match`, `season`, `player_registration`, `team_registration`, `fixture`, `lineup`, `announcement`). Rows that cannot be attributed to a competition remain `NULL` and are therefore visible only to global readers. New Phase 5–7 writes include competition/season scope explicitly.

## Sanitization

`before` and `after` are recursively sanitized before serialization. Keys are compared case-insensitively; sensitive keys are removed at any depth:

`password`, `passwordhash`, `token`, `tokenhash`, `accesstoken`, `refreshtoken`, `secret`, `authorization`, `cookie`.

Arrays and nested objects are traversed. Unrelated safe fields are preserved. The raw JSONB remains unchanged in PostgreSQL; sanitization happens on read, so credentials are never returned even if a future write accidentally includes them.

## Append-only enforcement

The application never updates or deletes audit rows. Migration `0006` adds the row-level trigger `audit_logs_append_only`:

```sql
CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION touchline_audit_logs_append_only();
```

Any `UPDATE` or `DELETE` raises `audit_logs is append-only; … is not permitted`. Row-level triggers do not fire for `TRUNCATE`, so disposable test databases can still reset between suites. Production teardown must not rely on truncating audit history.

`actor_user_id`, `competition_id` and `season_id` use `ON DELETE SET NULL`, preserving the audit row when a referenced identity or scope is removed administratively. No ordinary delete route exists for audit data.

## Indexes

| Index | Supports |
|---|---|
| `audit_entity_idx` (`entity_type, entity_id`) | Entity history |
| `audit_actor_idx` (`actor_user_id, created_at`) | Actor activity |
| `audit_entity_created_idx` (`entity_type, entity_id, created_at`) | Entity timeline |
| `audit_competition_created_idx` (`competition_id, created_at`) | Competition scoping |
| `audit_season_created_idx` (`season_id, created_at`) | Season scoping |
| `audit_action_created_idx` (`action, created_at`) | Action filtering |
| `audit_created_idx` (`created_at`) | Global chronological reads |

All list queries are bounded by `limit`; there is no unbounded export.

## Limitations

- Offset pagination can shift if new rows arrive between pages; use `from`/`to` for stable windows.
- Scoped readers cannot see unattributed historical rows.
- There is no retention policy, export endpoint or tamper-evident hash chain. Append-only is enforced by trigger and application contract, not by an external ledger.
