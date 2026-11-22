# Data integrity

Phase 3 makes PostgreSQL enforce the invariants that future domain workflows depend on. Constraints are the primary mechanism; triggers are used only where a rule spans rows that foreign keys cannot compare. Application code validates request shape and authorization, but correctness does not rely on it.

## Principles

1. **The database is the last line of defense.** A write path that bypasses a service, a script, or a future admin endpoint still cannot create an invalid record.
2. **Constraints before triggers.** Most rules are CHECK, UNIQUE or FOREIGN KEY constraints, which are declarative, fast and visible to `\d`.
3. **Triggers only for cross-row rules.** Participant membership and same-team event players cannot be checked by a foreign key; two `BEFORE` triggers cover exactly those cases.
4. **No data invention.** Migrations never guess a missing season, merge duplicate registrations or delete conflicting rows. Invalid history is reported for manual resolution.
5. **Forward-only migrations.** Applied migrations are immutable. Changes ship as new migrations.
6. **Transactions for multi-write operations.** A logical operation either commits completely or not at all.
7. **Database concurrency semantics are the arbiter.** Uniqueness and locking, not a read-then-write check in application code, decide races.

## Invariant catalogue

### Identity and access

| Invariant | Mechanism |
|---|---|
| Email uniqueness, case-insensitive | `users_email_lower_uq` on `lower(email)` |
| Role and permission names unique | `UNIQUE` on `roles.name`, `permissions.key` |
| One role grant per user/role/scope | `user_roles` primary key |
| Refresh token hashes unique; family belongs to a session | `token_hash` unique, `refresh_tokens.family_id` FK |
| Competition status/format/visibility in known sets | `competition_*_check` |
| Season end not before start | `season_dates_check` |
| Season status in the lifecycle | `season_status_check` |
| Season label unique per competition | `season_comp_label_uq` |
| Group name unique per season | `group_season_name_uq` |
| Non-archived team names unique case-insensitively | `team_name_lower_uq` partial unique index |
| Non-negative competition points | `competition_rules_points_check` |

### Teams and players

| Invariant | Mechanism |
|---|---|
| A team enters a season at most once | `team_registration_season_uq` |
| A team entry's group belongs to the same season | `team_registrations_group_season_fk` |
| A player registration's team entry belongs to the same season | `player_registrations_team_season_fk` on `(team_registration_id, season_id)` |
| One active registration per player per season | `player_season_active_uq` partial unique on active statuses |
| One active holder per matriculation number per season | `player_matriculation_active_season_uq` partial unique |
| No duplicate player row for a team entry | `player_team_reg_uq` |
| Shirt numbers unique within a team entry | `shirt_number_team_uq` |
| Shirt numbers `1..99`, detailed positions plus legacy `DF/MF/FW` | `player_registration_shirt_check`, `player_position_check` |

Active statuses are `submitted`, `under_review` and `approved`. `draft`, `rejected` and `withdrawn` are historical and intentionally unconstrained, so a player can be rejected, re-reviewed, transferred or withdrawn without deleting history.

### Fixtures and matches

| Invariant | Mechanism |
|---|---|
| No exact duplicate fixture | `fixture_identity_uq` with `NULLS NOT DISTINCT` on season/group/home/away/round |
| No team plays itself | `fixture_distinct_teams_check` |
| Both participants belong to the fixture season | `fixtures_home_team_season_fk`, `fixtures_away_team_season_fk` |
| Fixture group belongs to the fixture season | `fixtures_group_season_fk` |
| Round positive or unset | `fixture_round_check` |
| Fixture status in the lifecycle | `fixture_status_check` |
| One match per fixture | `UNIQUE (fixture_id)` |
| Scores non-negative | `match_scores_non_negative_check` |
| End time not before start time | `match_times_check` |
| Clock minute `0..150`, added time `0..30` | `match_current_minute_check`, `match_added_minutes_check` |
| A confirmed result only exists at `full_time` | `match_result_status_check` |

### Match events and lineups

| Invariant | Mechanism |
|---|---|
| Event type in the frontend vocabulary | `match_event_type_check` |
| Minute `0..150`, added time `0..30` | `match_event_minute_check`, `match_event_added_minutes_check` |
| Substitution names both players | `match_event_substitution_players_check` |
| A player is not both sides of one event | `match_event_distinct_players_check` |
| Offline retries are idempotent | `match_event_client_id_uq` on `(match_id, client_event_id)` |
| Event team/players participate in the match, same team, same season | `match_events_consistency_trg` |
| A voided event is preserved, not deleted | `voided_at`/`voided_by`/`void_reason` plus actor FKs |
| A corrected event keeps its original values in audit history | `corrected_at`/`corrected_by`/`correction_reason` plus `audit_logs` |
| One lineup per team per match | `lineup_match_team_uq` |
| Lineup team participates in the match | `lineups_participant_trg` |
| Formation shape and 10 outfield players | `lineup_formation_check` + `touchline_formation_outfield_count` |
| Lineup player belongs to the lineup team | `lineup_players_player_team_fk` |
| A player appears once per match, not in both lineups | `lineup_player_match_uq` |
| At most one captain per lineup | `lineup_one_captain_uq` |
| Role/position/shirt/coordinates valid | `lineup_player_*_check` |
| Pitch coordinates are both set or both unset, each `0..100` | `lineup_player_coordinates_check` |

### Reporting and platform

| Invariant | Mechanism |
|---|---|
| Standings version positive and unique per season/group | `standings_snapshot_version_check`, `standings_snapshot_version_uq` |
| At most one current snapshot per season/group | `standings_snapshot_current_uq` partial unique with `coalesce(group_id, zero-uuid)` |
| Snapshot group belongs to the snapshot season | `standings_snapshots_group_season_fk` |
| Announcement season belongs to the announcement competition | `announcements_competition_season_fk`, `announcement_season_competition_check` |
| Announcement audience is a controlled value | `announcement_audience_check` |
| Uploaded size non-negative, SHA-256 well formed | `uploaded_file_size_check`, `uploaded_file_sha256_check` |
| User suspension metadata is complete | `users_suspension_check` |
| Storage provider is supported | `uploaded_file_provider_check` |
| Disciplinary/dispute vocabularies | `disciplinary_case_status_check`, `disciplinary_subject_type_check`, `disciplinary_origin_type_check`, `disciplinary_sanction_type_check`, `disciplinary_sanction_status_check`, `dispute_status_check`, `dispute_subject_type_check`, `dispute_outcome_check`, entry-type checks |
| Notification delivery state | `notification_delivery_channel_check`, `notification_delivery_status_check`, `notification_delivery_attempts_check` |
| Notification dedupe per user | `notification_dedupe_uq` partial unique on `(user_id, dedupe_key)` |
| Audit rows cannot be updated/deleted | `audit_logs_append_only` trigger |

## Denormalized columns

Two columns are deliberately denormalized to make cross-table invariants enforceable with composite foreign keys:

- `player_registrations.season_id` — copied from the team entry. The composite FK `(team_registration_id, season_id)` prevents drift, and partial unique indexes can then scope to a season.
- `lineup_players.match_id` and `lineup_players.team_registration_id` — copied from the lineup. `(lineup_id, match_id)` and `(lineup_id, team_registration_id)` guarantee the copies match the parent, and `(player_registration_id, team_registration_id)` guarantees the selected player is registered to that team.

Writers must populate these columns from the parent row in the same statement or transaction. They are not defaults; missing values fail `NOT NULL`.

## Triggers

`touchline_validate_lineup` and `touchline_validate_match_event` run `BEFORE INSERT OR UPDATE` on the columns that can change membership. They raise SQLSTATE `23514` for a rule violation and `23503` for a missing match, so the API error mapping stays uniform.

They query parent rows without locking them. This is sufficient because the referenced match, fixture and registration rows are append-only in practice; a future workflow that moves a fixture between participants must revalidate affected rows in the same transaction.

`touchline_assert_match_team` is a shared helper. `touchline_formation_outfield_count` is `IMMUTABLE`, `STRICT` and `PARALLEL SAFE`, so it is safe in a CHECK constraint.

## Transactions

Multi-write operations use `db.transaction(...)` and pass `tx` to every statement:

- **Auth**: registration, login/session creation, refresh rotation and revocation, logout and logout-all. Refresh rotation locks the session row with `SELECT … FOR UPDATE` before deciding, then revokes or rotates inside the same transaction.
- **Security seed**: role/permission upsert and grant replacement commit together.
- **Team creation**: the team entity and its season entry commit together.
- **Captain provisioning**: the user, global `team_captain` grant and team-entry binding commit together; a failed binding rolls back the account.
- **Registration submission/resubmission**: player creation, registration write and audit transition commit together.
- **Registration review/approval/rejection**: the decision and audit row commit together.
- **Migrations**: Drizzle applies all pending migrations in one transaction, so a preflight failure leaves no partial DDL.
- **Tests and future domain writes**: fixture generation, result confirmation, event batches and lineup submission should follow the same rule — every row a caller can observe together is written together.
- **Fixture writes (Phase 5)**: fixture creation inserts the fixture and its match together; generation inserts every fixture and match pair under a season row lock; postpone/reschedule/cancel update fixture and match together; every lifecycle change writes its audit row in the same transaction.
- **Match writes (Phase 5)**: period transitions, clock updates, official assignment changes, event create/correct/void and result submit/correct all lock the fixture then the match and commit their audit row with the state change.
- **Lineup writes (Phase 6)**: create/update/submit/confirm/return/withdraw lock the fixture then match then lineup, revalidate eligibility and completeness, and commit roster, review metadata and audit in one transaction. Confirmation broadcasts only after commit.
- **Standings publication (Phase 6)**: publishes under a season row lock, allocates the next version, clears the previous current flag, inserts the new current snapshot and writes the audit row atomically.
- **Result invalidation (Phase 6)**: result submission/correction and event-driven reopening clear `is_current` and append `standings.snapshot.invalidated` in the same transaction as the result change.

Single-statement writes do not need an explicit transaction; PostgreSQL wraps them anyway.

Phase 7 writes follow the same rule:

- **User administration**: status changes plus session/refresh-token revocation plus audit commit together; role grants/revocations plus audit (and the recipient notification) commit together.
- **Disciplinary cases**: each lifecycle transition locks the case, writes the case entry and audit row, and creates subject/admin notifications atomically. Reviewer assignment stores the reviewer without changing status.
- **Disputes**: each transition locks the dispute, writes the entry and audit row, and notifies the relevant party. Decisions never write match/event rows.
- **Evidence**: validation happens before storage; the uploaded-file row, evidence link and audit row commit together. If the transaction fails, the stored object is removed.
- **Announcements**: publication writes `published_at`, the audit row and audience notifications in one transaction; failure rolls back publication.
- **Notifications**: each notification and its `in_app` delivery row share the caller's transaction; rollback removes both.
- **Audit reads**: no writes; authorization and `limit` are applied server-side.
- **Extensions to existing flows**: registration approval/rejection, lineup confirm/return, official assignment and match reschedule now create notifications and audit scope inside their existing transactions.

## Concurrency

- **Uniqueness is enforced by indexes**, not by a prior `SELECT`. Two concurrent fixture inserts, registrations or event IDs resolve to one winner and one `23505`, even without a transaction.
- **Session refresh** is the only flow with read-modify-write semantics. It takes a row lock on `sessions.id`, so concurrent refresh attempts serialize; the loser sees a revoked token inside the grace window and is treated as a race, not as token reuse.
- **Team captain assignment** locks the team entry with `SELECT … FOR UPDATE`, so concurrent provisioning cannot bind two captains or leave an orphan account.
- **Registration approval** locks the player-registration row and its team entry, then revalidates team status, season/competition state, player archival, active-season uniqueness, matriculation uniqueness and shirt-number uniqueness. Two concurrent approvals produce one `200` and one `409`.
- **Registration submission** locks the team entry, serializing concurrent submissions for the same roster; active player/matriculation uniqueness is still enforced by partial indexes.
- **No advisory locks or `SERIALIZABLE`** are used. The write paths either target a single row guarded by the row lock or compete on a unique index.
- **Idempotency** for offline events comes from `(match_id, client_event_id)`. A retry should use `INSERT … ON CONFLICT (match_id, client_event_id) DO NOTHING RETURNING id`; an empty result means the event was already accepted. The Phase 5 write path instead selects the existing row under the match lock, replays it when the payload matches (`200`, `created:false`) and returns `409` on a conflicting payload.
- **Match transitions and events** serialize on `SELECT … FOR UPDATE` of the fixture row followed by the match row. The lock order is identical in fixture lifecycle writes and the match engine, so scheduling and in-play traffic cannot deadlock. Concurrent `start` calls yield one `200` and one `409`; concurrent identical event retries yield one `201` and one `200`.
- **Fixture generation** locks the season row, so two concurrent commits for the same season cannot both append a full schedule. The fixture identity index remains the final guard.
- **Official assignment** relies on `UNIQUE (match_id, user_id)` inside a transaction, so duplicate concurrent assignments produce one `201` and one `409`.
- **Standings snapshots** are append-only versions. Concurrent publications lock the `seasons` row, so version allocation serialises per season. The version unique constraint and the current-snapshot partial unique index remain the final guard; a collision fails with `23505` rather than overwriting another snapshot. Only the previous current row's `is_current` flag is updated, never its rows or metadata.
- **Lineup creation and transitions** lock the fixture, match and lineup row, so concurrent creation or confirm/withdraw yields one winner. `lineup_match_team_uq`, `lineup_player_match_uq` and `lineup_one_captain_uq` enforce the invariants even without the locks.

## Error mapping

`src/app.ts` translates database failures into the stable error envelope:

| SQLSTATE | Meaning | API response |
|---|---|---|
| `23505` | unique/primary-key conflict | `409 RESOURCE_CONFLICT` |
| `23503` | foreign-key violation | `409 RESOURCE_CONFLICT` |
| `23514` | CHECK or trigger rejection | `400 INVALID_INPUT` |
| `23502` | NOT NULL violation | `400 INVALID_INPUT` |
| `22003` | numeric out of range | `400 INVALID_INPUT` |
| `22P02` | invalid text representation | `400 INVALID_INPUT` |

Trigger messages are logged but not returned verbatim; clients receive the generic integrity message. A future endpoint may add field-level detail after mapping known constraint names.

## Migration and backfill policy

- Migrations are forward-only. `0000`–`0005` are immutable once applied.
- New constraints are added only after a preflight and, where needed, a backfill.
- Backfills copy derivable values (`season_id` from the team entry, `match_id`/`team_registration_id` from the lineup). They never invent business data.
- A preflight failure aborts the migration with the offending IDs, for example:

  ```
  Phase 3 data-integrity preflight failed. Resolve the following records manually before applying migration 0002:
  - Players with more than one active registration in a season: <player>@<season>
  - Duplicate active matriculation numbers within a season: <season>:<number>
  ```

- After fixing the rows, rerun `pnpm db:migrate`. The operation is idempotent.
- Generated SQL must be reviewed. `db:generate` cannot express partial indexes with `CASE`, triggers, functions or preflight blocks, and it orders `NOT NULL` columns before backfills. If the SQL is edited by hand, update the matching snapshot so `db:check` and the next `db:generate` stay clean.
- Migration `0003` aborts if an existing season has an unsupported status or two non-archived teams differ only by case. It adds `competition_groups.archived_at`, both registration `reviewed_at` columns, `team_name_lower_uq` and `season_status_check`.
- Migration `0004` aborts if any existing match has a confirmed result outside `full_time`, which the new `match_result_status_check` would reject. It then adds fixture status/check/index, match clock columns and checks, event void/correction columns and their actor foreign keys. Existing fixtures keep `status = 'scheduled'`; no fixture, match or event row is deleted or rewritten.
- Verified upgrade paths: a fresh database applies all 5 migrations; a 4-migration database with existing fixtures upgrades to 5 while preserving the fixture and match counts; a deliberately invalid database fails the preflight, rolls back, stays at 4 migrations and has none of the new columns.
- Migration `0005` aborts if a lineup has an unrecognised status or a season/group has duplicate snapshot versions. It re-adds `lineup_status_check` with `returned`, adds review metadata columns/foreign keys and `lineup_match_status_idx`, then adds `is_current`/`meta` to snapshots, backfills the newest version as current and creates the current-snapshot partial unique index. Verified: fresh application, upgrade from the five-migration Phase 5 state, backfill preserving older versions, and preflight rollback leaving five migrations with no new columns and snapshots unchanged.
- Migration `0006` aborts if an announcement has an unrecognised audience or an uploaded file has a blank storage key. It adds user suspension metadata, announcement audience constraints, file storage metadata, audit competition/season scope and the Phase 7 tables. It backfills audit scope only where the entity relationship is unambiguous and leaves other historical rows untouched. It adds an append-only trigger on `audit_logs`. Verified: fresh application, upgrade from 0000–0005 with seeded history (audit scope backfilled, data preserved), preflight rollback leaving no new tables, and `UPDATE`/`DELETE` rejection.

## Ambiguities left open

These rules are not enforced because the product has not defined them. Enforcing a guess would be worse than leaving the decision to the domain workflow.

1. **Player transfers across teams in one season.** The schema allows at most one *active* registration per player per season, and a withdrawn/rejected row can precede a new one. Whether a transfer requires withdrawing the old row first, and whether both teams' history must be preserved, is a workflow decision.
2. **Own-goal attribution.** `team_registration_id` for `own-goal` could mean the scoring team or the benefiting team. The constraint only requires the player and team to be consistent, not which convention applies. **Resolved for Phase 5:** the field records the conceding team (the own-goal scorer's team), and the score engine credits the opposing participant. Clients must always send the scorer's own team.
3. **Starting XI and captain requirements.** A formation must total 10 outfield players, but nothing requires exactly 11 starters, a goalkeeper, or a captain. **Resolved for Phase 6:** lineup submission/confirmation requires eleven starters, exactly one goalkeeper, exactly one starting captain, unique players/shirt numbers and coordinates matching a supported formation; drafts remain incomplete. Squad size is not otherwise restricted.
4. **Duplicate fixtures by competition format.** The identity key allows a reversed leg in the same round. It does not model double round-robin rounds, knockout replays or byes; format-specific generation should decide those.
5. **Announcement audience vocabulary.** **Resolved for Phase 7:** the controlled set is `public`, `participants`, `captains`, `officials` and `administrators`, enforced by `announcement_audience_check`. Migration `0006` preflights historical values instead of rewriting them.
6. **Standings version workflow.** Snapshot versions are unique but nothing selects the current one. **Resolved for Phase 6:** `is_current` plus a partial unique index selects one current version per season/group; publication/recalculation switches it transactionally and result changes clear it.
7. **Match-event corrections.** Events are append-only by default, but the void/correction markers now exist. **Resolved for Phase 5:** corrections update the row and preserve the previous values in `audit_logs`; voids set `voided_at` and keep the row. Voided events are excluded from the score, never deleted.
8. **Clock semantics.** Minute bounds are sanity limits, not period rules. **Resolved for Phase 5:** the match engine enforces the period state machine and accepts explicit minute/added-time updates; it floors the clock at period boundaries but never derives it from wall-clock time.
9. **Case-normalized emails.** The unique index prevents new case-variant duplicates but does not rewrite legacy uppercase emails. Normalization needs a dedicated migration decision.
10. **Substitute limit.** Lineups allow 0–11 substitutes. `competition_rules.rules.maxSubstitutes` may define a lower non-negative season limit; larger values are capped at 11. Missing or malformed settings use 11.
11. **Unavailable players and appearance data.** `lineup_players.role` still accepts `unavailable` at the database level, but the lineup API only writes `starter`/`substitute`. Unused substitutes have no appearance, and minutes played/assists are omitted because the event model cannot derive them reliably.

## Known limitations

- Competition, season, group, team, captain, player-registration, fixture, match, official, event, result, lineup, statistics, standings, user/role administration, discipline, disputes, evidence uploads, announcements, notifications and audit-read endpoints now exist.
- Evidence storage uses a local filesystem adapter. Multi-instance/shared-volume deployment is required before uploads are safe across processes; S3-compatible storage is not implemented.
- Notifications are in-app only. There is no email/push provider, retry worker or external-delivery guarantee.
- Disciplinary sanctions are records. No lineup, registration or match workflow applies them automatically; callers must use the explicit eligibility endpoints.
- Audit append-only is enforced by a trigger and application contract, not a cryptographic ledger. Row-level triggers do not fire on `TRUNCATE`.
- Scoped audit readers cannot see historical rows whose competition/season could not be backfilled.
- Statistics are live queries with no cache; very large competitions will trade repeated calculation for always-current results.
- Standings snapshots are published explicitly. A result change clears the current flag but does not automatically publish a replacement version.
- Inline player creation deduplicates exact case-insensitive name + date of birth, but the schema has no global player identity key. Callers should reuse `playerId` when a matching player already exists.
- Triggers validate membership at write time; they do not retroactively fix rows moved by a future administrative operation.
- Application-level validation (Zod) still handles request shape and permission checks; database errors are intentionally generic.
- Multi-instance session revocation and realtime fan-out are not addressed here; see `architecture.md`.
