# Standings and snapshots

Standings are calculated from confirmed full-time results. Live standings are always derived on read; snapshots are immutable, versioned publications of a calculation at a point in time.

Module: `src/modules/standings/`.

- `calculator.ts` — eligible entries/results, points, tie-breakers and fingerprint.
- `service.ts` — live read, preview, publication, recalculation and history.
- `invalidation.ts` — result-driven de-publication.
- `schemas.ts` / `routes.ts` — requests and HTTP handlers.

## Eligibility

A fixture contributes only when:

- `matches.status = 'full_time'`;
- `matches.result_confirmed_at` is set;
- `fixtures.status = 'completed'`.

Draft, scheduled, postponed, cancelled, abandoned, unplayed and reopened results are excluded. A completed fixture whose confirmation was cleared by an event correction stops contributing immediately.

Entries are approved `team_registrations` in the season whose team is not archived. A match counts only when both participants are eligible entries in the calculated scope, so a result cannot leak points to a team outside the table.

## Scope

`GET /standings?seasonId=<uuid>&groupId=<uuid>`:

- If the season has **no** groups, standings are season-level and `groupId` must be omitted.
- If the season has groups, `groupId` is **mandatory** and the table is isolated to that group.
- A group from another season returns `400`.

Group isolation applies to entries and to fixtures: group tables use `fixtures.group_id` and `team_registrations.group_id`, and season-level calculation excludes rows carrying a group.

## Points

Points come from `competition_rules` for the season:

- `points_win` (default 3);
- `points_draw` (default 1);
- `points_loss` (default 0).

The calculator never invents a different scoring system. Competition administrators configure the rule row; standings read it.

## Ranking

Baseline order, applied to every calculation:

1. points (descending);
2. goal difference (descending);
3. goals for (descending).

Configured `competition_rules.tie_breakers` may add, in order:

- `wins` — more wins first;
- `head_to_head` — a mini-table among the still-tied teams using the same points values, then mini-table goal difference, then mini-table goals for.

The final deterministic order is case-insensitive team name, then team-registration ID. `meta.tieBreakers` records the effective order; `meta.ignoredTieBreakers` records recognised-but-unsupported or unknown entries. Unknown tie-breakers are **ignored and reported**, never guessed. `head_to_head` is recalculated only inside the tied block, so it cannot reorder teams outside that block.

`meta` also records the points values, scope, group, match IDs, match count and a SHA-256 fingerprint over the sorted match set (`id|home|away|homeScore|awayScore|confirmedAt`).

## Live standings

`GET /standings` returns:

- `rows` — the freshly calculated table;
- `meta` — the calculation metadata above;
- `snapshot` — the current published snapshot metadata, or `null`, with `stale` set when the snapshot's stored fingerprint differs from the live calculation.

The live rows are always authoritative. A snapshot is never substituted for an unplayed or corrected result. If a result changes and the current snapshot is invalidated, `snapshot` becomes `null` until an administrator publishes a new version.

No background job or scheduled recalculation exists. Recalculation is an explicit, audited action, and reads are live.

## Snapshots

Snapshots live in `standings_snapshots` (season, optional group, version, `is_current`, `calculated_at`, `meta`, `rows`).

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/standings` | standings readers |
| POST | `/api/v1/standings/calculate` | `standings.manage`; preview, writes nothing |
| POST | `/api/v1/standings/snapshots` | `standings.manage`; publishes version |
| POST | `/api/v1/standings/recalculate` | `standings.manage`; requires a reason |
| GET | `/api/v1/standings/snapshots` | standings readers; history newest first |
| GET | `/api/v1/standings/snapshots/:id` | standings readers; one version |

Publication is transactional and locked:

1. lock the `seasons` row (`SELECT … FOR UPDATE`);
2. recalculate inside the transaction;
3. find the previous current snapshot for that season/group;
4. allocate `version = max(version) + 1`;
5. clear `is_current` on the previous current row;
6. insert the new row with `is_current = true` and `meta.snapshotType`/`generatedAt`;
7. write an audit row (`standings.snapshot.published` or `.recalculated`) with the replaced snapshot ID.

Historical rows are never updated except for the `is_current` flag on the previous current row, and never deleted. A version collision fails with `409` rather than overwriting another calculation.

## Current selection and staleness

- A partial unique index (`standings_snapshot_current_uq`, keyed on season and `coalesce(group_id, zero-uuid)`) permits at most one current snapshot per season/group.
- "Current" means the most recently published or recalculated version that has not been invalidated.
- History lists every version, including invalidated ones, marked with `isCurrent`.
- `stale` compares the current snapshot's stored fingerprint with the live one. A stale snapshot can only occur if a result changed without invalidation; invalidation is the primary mechanism.

## Invalidation

Result changes de-publicate the season's current snapshots:

- `POST /matches/:id/report` (result submitted) — `standings.snapshot.invalidated`;
- `POST /matches/:id/result/correct` — invalidated;
- event correction or void on a confirmed result → `match.result.reopened` → invalidated.

Invalidation clears `is_current` for every current snapshot in the season (all groups, since the result could affect any table) and appends an audit row with the invalidated snapshot IDs and the match. The history row itself is preserved and remains addressable by version.

Lineup or appearance corrections do **not** invalidate standings: the table depends on confirmed results, not on lineups. Those corrections are reflected immediately in statistics, which are live queries.

## Read access

Standings reads use the same competition visibility as statistics: public competitions are public; private ones require management scope, an assigned match (for match-scoped routes) or captaincy. Snapshot publication and recalculation require `standings.manage` in competition scope. Super admins hold it globally. Competition administrators hold it scoped. Match officials and captains do not.

A caller who can manage lineups but lacks `standings.manage` receives `403` when the season is visible; a caller with no visibility receives `404`.

## Audit actions

- `standings.snapshot.published`
- `standings.snapshot.recalculated`
- `standings.snapshot.invalidated`

Audit entries record the actor, season, before/after snapshot metadata and the reason where supplied. Snapshots and audit rows are never deleted.

## Out of scope

Automatic publication on every result, scheduled/background recalculation, cross-season or all-competition tables, promotion/relegation rules, points deductions, forfeits and disciplinary adjustments are not implemented.
