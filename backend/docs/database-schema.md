# Database schema

PostgreSQL is the source of truth. The Drizzle schema in `src/database/schema/index.ts` defines 33 tables and is the source for the committed migrations in `drizzle/`. Phase 3 (`0002_easy_machine_man.sql`) turns business invariants into database constraints and validation triggers. Phase 4 (`0003_absent_beast.sql`) adds competition-management metadata and name uniqueness. Phase 5 (`0004_*`) adds fixture/match-engine state. Phase 6 (`0005_wonderful_galactus.sql`) adds lineup review lifecycle fields and current-snapshot tracking. Phase 7 (`0006_cultured_kat_farrell.sql`) adds administration, disciplinary, dispute, evidence, notification and audit-scope structures.

## Tables

- Identity: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `refresh_tokens`
- Competition: `competitions`, `seasons`, `competition_groups`, `competition_rules`
- Teams and players: `teams`, `team_registrations`, `players`, `player_registrations`
- Match operations: `fixtures`, `matches`, `match_officials`, `match_events`, `lineups`, `lineup_players`
- Administration and supporting systems: `disciplinary_cases`, `disciplinary_case_entries`, `disciplinary_sanctions`, `disputes`, `dispute_entries`, `evidence_files`, `notifications`, `notification_deliveries`
- Reporting and platform: `standings_snapshots`, `announcements`, `uploaded_files`, `audit_logs`

All identity, competition/season/group, team/captain, player-registration, fixture/match/event/result, lineup, statistics/standings, user/role administration, disciplinary, dispute, evidence, announcement, notification and audit-read workflows are implemented.

## Competition-management additions

- `competitions`, `seasons`, `competition_groups`, `teams`, `team_registrations`, `players` and `player_registrations` are the write model. Archived competitions, seasons, groups and teams are read-only in the application; team-entry and captain changes additionally require a `planned` or `active` season, so completed seasons are read-only for those workflows. Historical rows are retained.
- `competition_groups.archived_at` marks a group archived without deleting entries. A group with team entries cannot be archived.
- `team_registrations.reviewed_at` and `player_registrations.reviewed_at` record the final administrative review timestamp; `reviewed_by` records the administrator.
- `season_status_check` restricts seasons to `planned`, `active`, `completed` or `archived`.
- `team_name_lower_uq` is a partial case-insensitive unique index over non-archived team names. Archived teams may be restored only if no active team now uses the name.
- Registration history uses `audit_logs` with `entity_type = 'player_registration'`; no history rows are deleted.

## Identity and sessions

- `users.email` is unique, and `users_email_lower_uq` additionally makes uniqueness case-insensitive. Existing uppercase rows are not rewritten; the migration preflight reports a collision if two rows differ only by case.
- `roles.name` and `permissions.key` are unique. `user_roles.competition_id` is nullable; `NULL` means global scope.
- `sessions.id` is the refresh-token family. `refresh_tokens.family_id` references it with cascade delete, `token_hash` is unique, and only hashes are stored.
- Access tokens carry `sid`; session revocation is authoritative over JWT expiry.

## Registrations

- `team_registrations` is unique per `(team_id, season_id)`; a team enters a season at most once, regardless of status.
- `team_registrations.group_id` and `player_registrations.team_registration_id` are checked against the season through composite foreign keys (`team_registrations_group_season_fk`, `player_registrations_team_season_fk`). A group or team entry from another season is rejected.
- `player_registrations.season_id` is denormalized from the team entry so season-scoped uniqueness is enforceable in one table. It is kept consistent by the composite FK; writers must supply it.
- Active registration statuses are `submitted`, `under_review` and `approved`. Only those are constrained:
  - `player_season_active_uq` — one active registration per player per season.
  - `player_matriculation_active_season_uq` — one active holder of a matriculation number per season.
  - `draft`, `rejected` and `withdrawn` rows remain historical and may repeat, so transfers and resubmissions stay possible.
- `player_team_reg_uq` prevents the same player appearing twice for one team entry, and `shirt_number_team_uq` prevents duplicate shirt numbers within a team entry while allowing `NULL`.
- Shirt numbers are `1..99`; player positions are the detailed roles `GK`, `CB`, `LB`, `RB`, `DM`, `CM`, `RM`, `LM`, `AM`, `LW`, `RW` or `CF`. Legacy `DF`, `MF` and `FW` values remain valid for existing records.

## Fixtures and matches

- `fixture_identity_uq` is unique over `(season_id, group_id, home_team_registration_id, away_team_registration_id, round)` with `NULLS NOT DISTINCT`. Reversed home/away legs are distinct rows; an exact duplicate is rejected even when `group_id` or `round` is `NULL`.
- `fixtures.status` is one of `draft`, `scheduled`, `postponed`, `cancelled`, `completed`, `abandoned`, defaulting to `scheduled` for historical/compatibility rows. API-created and generated fixtures explicitly start as `draft`. `fixture_status_check` and `fixture_season_status_idx` back the workflow.
- `fixtures.published_at` records publication independently of `status`, so an unpublished draft keeps a `NULL` timestamp.
- Home and away participants must be different (`fixture_distinct_teams_check`) and must belong to the fixture season (`fixtures_home_team_season_fk`, `fixtures_away_team_season_fk`).
- `fixtures_group_season_fk` prevents a fixture from pointing at a group from another season.
- `round` is either `NULL` or positive.
- `matches.fixture_id` is unique: one match row per fixture.
- Scores are non-negative and an end time cannot precede a start time.
- `matches.status` covers `scheduled`, `first_half`, `live`, `half_time`, `second_half`, `extra_time`, `penalties`, `full_time`, `postponed`, `cancelled` and `abandoned`.
- `matches.current_minute` is `0..150` or `NULL`; `matches.added_minutes` is `0..30` or `NULL` (`match_current_minute_check`, `match_added_minutes_check`). The clock is explicit state, never derived.
- `matches.result_confirmed_at` and `confirmed_by` record result confirmation. `confirmed_by` references `users` and is cleared when a confirmed result is reopened by an event correction.
- `match_result_status_check` prevents a confirmed result from existing on a status other than `full_time`.

## Match events

- `event_type` is restricted to the frontend vocabulary: `goal`, `own-goal`, `yellow-card`, `second-yellow`, `red-card`, `substitution`, `injury`, `penalty-awarded`, `penalty-scored`, `penalty-missed`, `kickoff`, `half-time`, `full-time`.
- `minute` is `0..150`; `added_minutes` is `NULL` or `0..30`. These are sanity bounds, not a half-by-half rule.
- A substitution must name both players, and a player cannot be both sides of one event.
- `match_event_client_id_uq` on `(match_id, client_event_id)` makes offline retries idempotent via `ON CONFLICT DO NOTHING`.
- Trigger `match_events_consistency_trg` verifies that the event team and both players participate in the match, belong to the event team, and belong to the fixture season. These cross-row checks cannot be expressed as foreign keys.
- `match_events.voided_at`, `voided_by` and `void_reason` mark a voided event without deleting it. Voided events are excluded from the derived score.
- `match_events.corrected_at`, `corrected_by` and `correction_reason` mark a corrected event; the original values remain in `audit_logs`.
- `voided_by` and `corrected_by` reference `users`; a voided or corrected row is never hard-deleted through the API.

## Lineups

- One lineup per `(match_id, team_registration_id)`.
- `lineup_status_check` allows `draft`, `submitted`, `published`, `confirmed` and `returned`.
- `confirmed_at`/`confirmed_by` and `returned_at`/`returned_by`/`return_reason` record the review lifecycle; `confirmed_by` and `returned_by` reference `users` with `ON DELETE SET NULL`.
- `lineup_match_status_idx` supports match/status reads.
- `lineup_formation_check` accepts `NULL` or a dash-separated formation with the shape `^[1-9][0-9]*(-[1-9][0-9]*)+$` whose parts total 10 outfield players. The count uses the immutable SQL function `touchline_formation_outfield_count`.
- `lineup_players` carries `match_id` and `team_registration_id` denormalized from the lineup so composite foreign keys can enforce consistency:
  - the player registration belongs to the same team entry as the lineup;
  - the lineup rows agree on match and team.
- `lineup_player_match_uq` prevents one player registration appearing in both lineups of a match.
- `lineup_one_captain_uq` allows at most one captain per lineup.
- Roles are `starter`, `substitute` or `unavailable`. Positions and shirt numbers reuse the player vocabularies.
- `x` and `y` must be both `NULL` or both within `0..100`.
- Trigger `lineups_participant_trg` rejects a lineup for a team that is not playing in the match.

## Standings, announcements and files

- `standings_snapshots` has `version >= 1` and is unique over `(season_id, group_id, version)` with `NULLS NOT DISTINCT`. Repeated snapshots require a new version; rows are never overwritten.
- `is_current` marks the current published version. The partial unique index `standings_snapshot_current_uq` keys on `(season_id, coalesce(group_id, zero-uuid))` where `is_current`, so a season/group has at most one current snapshot. `coalesce` works around drizzle-kit's inability to express `NULLS NOT DISTINCT` in a partial index.
- `meta` stores the calculation metadata (points, tie-breakers, match IDs, fingerprint, snapshot type, generation timestamp); `rows` stores the immutable table.
- `announcements` references `(competition_id, season_id)` as a pair, and a season cannot be set without its competition.
- `announcements.audience` is restricted to `public`, `participants`, `captains`, `officials` or `administrators` by `announcement_audience_check`; `announcement_audience_idx` supports audience/competition/publish filters.
- `uploaded_files` rejects negative sizes and malformed SHA-256 values (`^[0-9a-f]{64}$`). `storage_key` is unique, `storage_provider` is currently `local`, and `uploaded_by`/`created_at` are indexed.

## Phase 7 administration and supporting systems

### User administration

- `users.suspended_at`, `suspended_reason` and `suspended_by` record suspension without deleting the account. `users_suspension_check` requires either all suspension fields to be null or a timestamp plus a reason. `users_active_idx` supports status/date filtering.
- Accounts are never hard-deleted through the API. Status changes, role grants/revocations and session revocation are audited.

### Disciplinary cases

- `disciplinary_cases` stores competition/season scope, subject type and optional player/user/team subjects, origin type/match/event, title, description, status, assigned reviewer, creator, lifecycle timestamps and closure reason.
- Statuses are `open`, `under_review`, `awaiting_response`, `decided`, `appealed` and `closed`; subject types are `player`, `team`, `official`, `match` and `other`; origins are `match_event`, `referee_report`, `competition_administration` and `other`.
- `disciplinary_case_entries` is the case timeline (`status_change`, `reviewer_assigned`, `finding`, `response`, `decision`, `appeal`, `note`, `sanction`) with optional before/after status, actor and metadata.
- `disciplinary_sanctions` records subject, type (`warning`, `match_suspension`, `competition_suspension`, `other`), reason, match count, start/end, status and issuer. Fines are intentionally absent.
- Sanctions never change registration status, matches or results. Eligibility is checked explicitly at read time.

### Disputes

- `disputes` stores competition/season, optional match/team, subject type/ref, title, description, status, outcome, decision, submitter and lifecycle timestamps.
- Statuses are `draft`, `submitted`, `under_review`, `awaiting_information`, `decided` and `closed`; outcomes are `accepted`, `rejected`, `partially_accepted` and `no_action`.
- `dispute_entries` records status changes, reviewer assignment, responses, information exchange, decisions and notes. `is_internal` marks reviewer-only entries.
- Dispute decisions never update match results or events; Phase 5 correction endpoints remain the only result-change path.

### Evidence

- `evidence_files` links one `uploaded_files` row to exactly one case or dispute, records the uploader/attacher and supports archival removal (`removed_at`, `removed_by`, `removal_reason`).
- Active evidence is filtered by `removed_at IS NULL`; removed rows remain for history.

### Notifications

- `notifications` stores recipient, type, title, body, optional entity/competition, dedupe key and `read_at`. `notification_user_idx`, `notification_unread_idx` and `notification_competition_idx` back feed, unread-count and scoped reads.
- `notification_dedupe_uq` is a partial unique index on `(user_id, dedupe_key)` where the key is not null.
- `notification_deliveries` separates creation from channel delivery. `(notification_id, channel)` is unique; channels are `in_app`/`email`; statuses are `pending`, `delivered`, `failed` and `skipped`. Only in-app delivery is produced.

### Audit scope

- `audit_logs.competition_id` and `season_id` scope new writes; `audit_competition_created_idx`, `audit_season_created_idx` and existing entity/actor/action indexes back filtered reads.
- Migration `0006` backfills scope only where the entity relationship is unambiguous and leaves unattributable rows `NULL`.
- Trigger `audit_logs_append_only` rejects row `UPDATE`/`DELETE`. It does not fire for `TRUNCATE`.

## Deletion and history

Deleting a season, team entry, fixture, match, event, player or player registration used in history is restricted. Team/player records and files support archival instead. Audit rows have no ordinary delete endpoint.

## Migrations

Migrations are committed in `drizzle/` with `drizzle/meta/_journal.json` and snapshots. Drizzle records applied migrations in `drizzle.__drizzle_migrations`.

```bash
pnpm db:generate   # only after changing the schema; review and hand-harden the SQL
pnpm db:migrate    # validate and apply; non-zero exit on any failure
pnpm db:check      # validate migration metadata
```

`db:migrate` rejects an empty migration set, missing/invalid journal or SQL, and an unreachable database. Applying the same migrations twice is safe and does not duplicate objects. Do not edit an already-applied migration (`0000`–`0006`); create a new one instead.

Migration `0002` is hand-reviewed and forward-only:

1. It creates `touchline_formation_outfield_count`.
2. It runs a read-only preflight that lists offending row IDs and aborts the whole migration if any historical row violates a new constraint.
3. It adds nullable columns, backfills `player_registrations.season_id` and `lineup_players.match_id/team_registration_id`, then sets them `NOT NULL`.
4. It adds composite foreign keys, unique constraints/indexes, checks and triggers in dependency order.

Migration `0003` is also forward-only. Its preflight aborts if any season has an unsupported status or any two non-archived teams differ only by case. It then adds `competition_groups.archived_at`, both `reviewed_at` columns, the `team_name_lower_uq` partial unique index and `season_status_check`. It never rewrites or deletes existing rows.

Migration `0004` adds the Phase 5 fixture and match-engine columns. It is hand-hardened in the same style:

1. A read-only preflight aborts with offending IDs when an existing match has a confirmed result outside `full_time`, which the new `match_result_status_check` would reject.
2. `fixtures.status` is added with default `scheduled` and a CHECK constraint, so existing rows stay valid without a backfill. `fixture_season_status_idx` supports season/status filtering.
3. `matches.current_minute` and `matches.added_minutes` are added with range checks. `started_at`, `ended_at` and the result-confirmation columns already existed from Phase 3.
4. `match_events.voided_at`/`voided_by`/`void_reason` and `corrected_at`/`corrected_by`/`correction_reason` are added with foreign keys to `users`.
5. `match_current_minute_check`, `match_added_minutes_check` and `match_result_status_check` are added after the preflight.
6. A failed preflight rolls back the entire migration; the previous schema and data remain untouched. Verified against a Phase 4 database: migration count stays at 4 and the new columns are absent.

An upgrade with existing fixtures preserves them with `status = 'scheduled'` and their fixture/match counts unchanged.

Migration `0005` is hand-hardened and forward-only:

1. A read-only preflight aborts when an existing lineup has an unrecognised status or when any season/group has duplicate snapshot versions.
2. It replaces `lineup_status_check` to add `returned`, then adds `confirmed_at`, `confirmed_by`, `returned_at`, `returned_by`, `return_reason`, their user foreign keys and `lineup_match_status_idx`.
3. It adds `standings_snapshots.is_current` (default `false`) and `meta` (default `{}`), backfills exactly one current snapshot per season/group from the highest version, and creates `standings_snapshot_current_uq`.
4. Existing snapshots and lineups are preserved; the backfill only marks the newest version, never rewrites or deletes history. A failed preflight rolls back all DDL and the backfill.

Migration `0006` adds Phase 7 and is hand-hardened:

1. A read-only preflight aborts when an existing announcement has an audience outside the controlled vocabulary or an uploaded file has a blank storage key.
2. It adds user suspension columns/check/index, the announcement audience check/index, `uploaded_files.storage_provider` plus uploader metadata/check/index, and `audit_logs.competition_id`/`season_id` plus indexes.
3. It creates the disciplinary, dispute, evidence and notification tables with their foreign keys, CHECK constraints, unique indexes and lookup indexes.
4. It backfills audit competition/season scope from match, season, player-registration, team-registration, fixture, lineup and announcement relationships where unambiguous. Historical rows are otherwise untouched.
5. It adds the `audit_logs_append_only` trigger and function. Verified on disposable databases: fresh 7-migration apply, upgrade from 0000–0005 with seeded historical rows (scope backfilled, data preserved), failed-preflight rollback leaving no new tables, and `UPDATE`/`DELETE` rejection on audit rows.

The preflight never deletes or reassigns data. Invalid rows must be resolved manually, then `pnpm db:migrate` is rerun. Because Drizzle applies pending migrations in one transaction, a preflight failure rolls back the whole migration and leaves the previous schema and data intact.

`pnpm db:seed` inserts only the baseline roles and permission grants. It is repeatable and does not seed competitions, teams or credentials.
