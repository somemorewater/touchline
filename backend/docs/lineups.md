# Lineups

A lineup is one team's selection for one match. Each team registration may have at most one lineup per match; the database also prevents the same player registration appearing in both teams' lineups.

Modules:

- `src/modules/lineups/formations.ts` — data-driven formation catalogue and slot validation.
- `src/modules/lineups/schemas.ts` — request shapes and status vocabulary.
- `src/modules/lineups/visibility.ts` — read scoping and public sanitisation.
- `src/modules/lineups/service.ts` — lifecycle, eligibility, locking, audit and broadcast.
- `src/modules/lineups/routes.ts` — HTTP handlers.

## Status model

| Status | Meaning |
|---|---|
| `draft` | Work in progress; incomplete selections are allowed |
| `submitted` | Complete selection awaiting review |
| `confirmed` | Reviewed and approved; the authoritative lineup for statistics |
| `returned` | Reviewer sent it back; the captain may edit it again |
| `published` | Legacy Phase 3 status, still accepted for compatibility |

Canonical path: `draft → submitted → confirmed`, with `returned` reachable from `submitted` or `confirmed`. Withdrawing any non-draft lineage resets it to `draft`. `published` can be confirmed, matching the Phase 3 vocabulary.

`returned` is a stored status, not a label. A captain editing a returned lineup transitions it back to `draft` and clears the return metadata in the same write.

## Endpoints

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/lineups/formations` | public (optional auth) |
| GET | `/api/v1/lineups` | authenticated; filters by match/team/season/competition/status |
| POST | `/api/v1/matches/:id/lineups` | captain of the team, or competition administrator |
| GET | `/api/v1/matches/:id/lineups` | lineup readers (both teams) |
| GET | `/api/v1/lineups/:id` | lineup readers |
| PATCH | `/api/v1/lineups/:id` | captain before kickoff, or competition administrator |
| POST | `/api/v1/lineups/:id/submit` | captain, or competition administrator; no body required (`reason` may be supplied as an object field) |
| POST | `/api/v1/lineups/:id/confirm` | competition administrator only |
| POST | `/api/v1/lineups/:id/return` | competition administrator only; `reason` required |
| POST | `/api/v1/lineups/:id/withdraw` | captain, or competition administrator |
| GET | `/api/v1/team-entries/:id/lineups` | owning captain or scoped administrator |

`GET /matches/:id` embeds the same visible lineups; the standalone match-lineup route is the only match-lineup list endpoint.

## Creation and draft rules

`POST /matches/:id/lineups` accepts `teamRegistrationId`, an optional `formation` and up to 40 player rows. A draft may contain zero players, an incomplete defence, or no captain. If a formation is supplied it must be one of the supported formations.

Creation requires:

- the team entry is one of the match participants and belongs to the fixture season;
- the team entry status is `approved`;
- the caller captains that team entry or manages the competition;
- the fixture is not `cancelled` or `abandoned`, and the match has not kicked off.

Every player row carries `playerRegistrationId`, `role` (`starter`/`substitute`), `position` (`GK`/`DF`/`MF`/`FW`), `shirtNumber`, optional `x`/`y` and optional `isCaptain`. Lineup positions remain the broad formation lines; a player's detailed profile position is mapped to one of them.

## Validation

The service validates the full selection on every write. A complete lineup additionally satisfies the starting-XI rules.

All writes:

- no player registration appears twice in the lineup;
- shirt numbers are unique within the lineup;
- `x` and `y` are supplied together and lie in `0..100`;
- every starter has pitch coordinates;
- a substitute cannot be the captain;
- every player registration exists, belongs to the lineup's team entry and season, is `approved` with `eligibilityApproved`, and its player is not archived;
- the team entry is approved;
- when the registration has a shirt number, the lineup shirt number matches it.

Complete lineups (`submitted`, `confirmed`, `published`, or confirmation revalidation):

- a supported formation is set;
- exactly eleven starters;
- exactly one goalkeeper among the starters;
- exactly one captain, and the captain is a starter;
- all ten outfield starters occupy formation slots exactly once;
- substitutes do not exceed the season limit (see below).

Incomplete drafts are therefore allowed, but submission always revalidates eligibility and completeness. Confirmation revalidates again, so a registration withdrawn between submission and review blocks confirmation with `409`.

Two captains in one lineup are rejected by the partial unique index `lineup_one_captain_uq`; the API maps the database conflict to `409 RESOURCE_CONFLICT`.

## Formations and pitch coordinates

Formations are data-driven in `formations.ts`. Supported formations:

| Formation | Segments (defence → attack) |
|---|---|
| `4-3-3` | 4-3-3 |
| `4-4-2` | 4-4-2 |
| `4-2-3-1` | 4-2-3-1 |
| `3-5-2` | 3-5-2 |
| `3-4-3` | 3-4-3 |
| `4-1-4-1` | 4-1-4-1 |
| `5-3-2` | 5-3-2 |

Slots are generated deterministically from the dash pattern; they are not free-form client coordinates:

- the first line is `DF`, the last is `FW`, and middle lines are `MF`;
- slot keys are `DF1…`, `MF1…`, `FW1…`;
- depth `y` runs `15 → 85` from defence to attack (`20/40/60/80` for 4-2-3-1, `15/38.33/61.67/85` for 4-1-4-1);
- lateral `x` is centred on `50` with a total spread of `60` across each line, rounded to two decimals;
- the goalkeeper slot is `{ x: 50, y: 5 }`.

`GET /lineups/formations` returns the segments, the goalkeeper slot and every outfield slot so a client can place players without guessing. Submitting coordinates that do not match an available slot for the declared position returns `400`.

Coordinates are persisted as `numeric(5,2)`; comparison uses a `0.01` tolerance. Unknown formation strings are rejected even if they total ten, so arbitrary shapes cannot bypass the catalogue.

## Substitute limit

Lineups allow **0–11 substitutes**. `competition_rules.rules.maxSubstitutes` can set a lower non-negative season limit; larger configured values are capped at 11. An absent or malformed value uses the platform maximum of 11. The limit is checked for draft writes and again during submission/review validation.

## Editing and kickoff

`hasKickedOff` is true when the match has a `started_at`, its status is outside `scheduled`/`postponed`, or the fixture is `completed`/`cancelled`/`abandoned`.

- Captains may edit or submit only `draft`/`returned` lineups before kickoff.
- A captain cannot edit a `submitted` or `confirmed` lineup.
- Administrators may edit lineups before kickoff; after kickoff or on a `confirmed`/`published` lineup every administrative edit is a **correction**, requires an explicit `reason`, and is audited as `lineup.corrected`.
- Administrators cannot edit, confirm, return or withdraw lineups for a `cancelled` or `abandoned` fixture.
- Review (confirm/return) is only possible before kickoff.

A correction does not silently rewrite history: the audit row keeps the previous lineup and roster, the new values and the reason. Confirmed lineups are never deleted.

## Review actions

- **Submit** (`draft`/`returned → submitted`) accepts no body (or an optional `{ "reason": "..." }` object), revalidates the persisted complete XI and eligibility, sets `submitted_at`, and audits `lineup.submitted`.
- **Confirm** (`submitted`/`published → confirmed`) revalidates the complete XI and eligibility, stamps `confirmed_at`/`confirmed_by`, clears return metadata, audits `lineup.confirmed`, and broadcasts `lineup.update` after commit.
- **Return** (`submitted`/`confirmed → returned`) requires a reason, stamps `returned_at`/`returned_by`/`return_reason`, clears confirmation metadata, and audits `lineup.returned`.
- **Withdraw** (any non-draft → `draft`) clears submission, confirmation and return metadata and audits `lineup.withdrawn`. A withdrawal is not a deletion; the audit history remains.

Only competition administrators may confirm or return. The authority is `matches.manage` or `fixtures.manage` in competition scope, deliberately **not** `lineups.manage`, because match officials also hold `lineups.manage` for their assigned matches and must not gain competition-wide review power. Match officials can read all lineups for matches they are assigned to.

## Read visibility

`resolveLineupVisibility` combines:

- `all` — a caller who may read the private match (scoped manager) or is an assigned match official;
- `ownedTeamIds` — participating team entries the caller captains;
- `publicMatch` — the fixture/competition is public;
- `reviewer` — may confirm, return or administratively correct.

Rules:

- Callers with `all` see both lineups in every status.
- Captains see their own team's lineup in every status.
- On a public match, anyone sees `confirmed`/`published` lineups.
- Everything else returns `404` rather than leaking a draft.

Public responses omit `returnedBy`; `returnedAt`/`return_reason` are included only for managers, officials and reviewers. `confirmedBy` is never returned. Player responses contain registration ID, role, shirt number, position, coordinates and captain flag; private player records (date of birth, contact details, matriculation data) are not joined into lineup responses.

## History

`GET /lineups` requires at least one of `matchId`, `teamRegistrationId`, `seasonId` or `competitionId`, and accepts `status`, `limit` (1–100) and `offset`. `matchId` and `teamRegistrationId` are mutually exclusive. A team-entry query resolves the entry's competition and allows the owning captain or a scoped administrator; otherwise it returns `404`.

`GET /team-entries/:id/lineups` is the same history scoped to one entry and also accepts `seasonId`, `status`, `limit` and `offset`.

## Audit and realtime

Lineup audit actions (entity type `lineup`): `lineup.created`, `lineup.updated`, `lineup.corrected`, `lineup.submitted`, `lineup.confirmed`, `lineup.returned`, `lineup.withdrawn`. Before/after snapshots and the reason are stored in `audit_logs`; no audit row is deleted.

Only confirmed lineups are broadcast, as a sanitised `lineup.update` frame on the match channel, after the transaction commits. Draft rosters never reach public subscribers. See `realtime.md`.

## Concurrency

Creation and every transition lock the fixture row then the match row (`lockMatch`, the Phase 5 order) and lock the lineup row with `SELECT … FOR UPDATE`. Concurrent creation for the same team/match therefore yields one `201` and one conflict, and concurrent transitions produce one winner. Database constraints remain the final guard:

- `lineup_match_team_uq` — one lineup per team per match;
- `lineup_player_match_uq` — one player registration per match;
- `lineup_one_captain_uq` — at most one captain;
- composite foreign keys — player belongs to the lineup's team, match and season.

## Out of scope

Shirt-number changes, squad-number conflicts across a season and injury-driven automatic substitutions are not implemented. Disciplinary cases, disputes and their sanctions live in separate modules; lineup confirm/return now creates in-app captain notifications.
