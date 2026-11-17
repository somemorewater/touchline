# Player and team statistics

Statistics are **derived**, never stored as editable aggregates. Every response is computed from confirmed results, confirmed lineups and non-voided match events at read time. There is no statistics table and no way to PATCH a goal or a card.

Module: `src/modules/statistics/`.

- `eligibility.ts` — authoritative match filters and read scopes.
- `service.ts` — player, team, match and ranking derivation.
- `schemas.ts` — filter vocabulary.
- `routes.ts` — HTTP handlers.

## Authoritative inputs

A match is eligible when **all** of the following hold:

1. `matches.status = 'full_time'`;
2. `matches.result_confirmed_at` is set;
3. `fixtures.status = 'completed'`.

Public callers additionally require `fixtures.published_at`. Managers, assigned officials and captains reading a private competition scope see unpublished fixtures inside that scope.

This excludes draft fixtures, unplayed fixtures, postponed/cancelled fixtures, abandoned matches without a confirmed result, and results reopened after an event correction. A fixture that is `completed` but whose result confirmation was cleared is excluded until the result is re-confirmed.

Filters: `competitionId`, `seasonId`, `groupId`, `teamId`/`teamRegistrationId`, `playerId`/`playerRegistrationId`, `matchId`, `from`/`to` (UTC calendar days on `fixtures.scheduled_at`), `limit` (1–500) and `offset`. Passing both a team and a team-registration filter, or both a player and a player-registration filter, is rejected. Conflicting competition/season/match combinations return `400`; unknown or invisible resources return `404`.

## Read access

- Public competition: statistics are public.
- Private competition: a caller needs competition management scope (`matches.manage`/`fixtures.manage`), an assigned match when filtering by that match, or a captaincy in that competition. Otherwise the competition is omitted; an explicit filter returns `404`.
- `GET /statistics/matches/:id` reuses `canReadMatch`, so public matches are readable and private ones require scope/official/captain access.

Responses never include date of birth, contact details, matriculation numbers or registration review metadata. Player identity is limited to `playerId`, `playerName`, team names, season/registration IDs and shirt number.

## Appearances

- A **start** is a `starter` row in a `confirmed` lineup for an eligible match.
- A **substitute appearance** requires a non-voided `substitution` event in that match whose incoming player (`secondaryPlayerRegistrationId`) was a `substitute` in the team's confirmed lineup. Only the first such event per player/match counts.
- Unused substitutes have no appearance.
- A player who appears only through an event (for example a card on a match without a confirmed lineup) contributes event totals but no appearance. This is deliberate: appearance counts require a confirmed lineup.
- Abandoned matches without a confirmed full-time result contribute nothing. A confirmed result is the same state used by standings.

Minutes played are **not** reported: the event model has no reliable substitution minute/period semantics for every case, so deriving minutes would invent data.

## Player statistics

`GET /statistics/players` returns one row per player registration:

| Field | Source |
|---|---|
| `appearances`, `starts`, `substituteAppearances` | confirmed lineup and substitution events |
| `goals` | non-voided `goal` and `penalty-scored` |
| `penaltyGoals` | non-voided `penalty-scored` (also counted in `goals`) |
| `ownGoals` | non-voided `own-goal`; never added to `goals` |
| `yellowCards` | non-voided `yellow-card` |
| `redCards` | non-voided `red-card` and `second-yellow` |
| `substitutionsMade` | outgoing player of a non-voided substitution |
| `substitutionsReceived` | incoming player of a non-voided substitution |
| `cleanSheets` | starting goalkeeper whose team conceded zero and who was not substituted off |

`GET /statistics/players/:id` returns:

```json
{
  "player": { "id": "<uuid>", "fullName": "..." },
  "totals": { "appearances": 0, "goals": 0, "...": 0 },
  "bySeason": [{ "seasonId": "<uuid>", "appearances": 0, "...": 0 }],
  "rows": [{ "playerRegistrationId": "<uuid>", "teamName": "...", "...": 0 }]
}
```

The `rows` array is per team registration and season, so a player who changes teams or seasons gets separate rows. `bySeason` sums those rows per season. Omitting `seasonId` produces a career summary across every readable season; supplying it produces a season summary. Team and competition filters narrow the same base.

Assists and shot/possession statistics are **not implemented**. The event vocabulary has no assist field and no shot/possession events, so returning zeros would be misleading.

## Team statistics

`GET /statistics/teams` returns one row per team registration:

| Field | Source |
|---|---|
| `played`, `won`, `drawn`, `lost`, `goalsFor`, `goalsAgainst`, `goalDifference` | confirmed full-time score |
| `cleanSheets` | confirmed match where the team conceded zero |
| `yellowCards` | non-voided `yellow-card` events charged to the team |
| `redCards` | non-voided `red-card` and `second-yellow` events charged to the team |

Only confirmed results produce W/D/L and goals. Card totals come from non-voided events in eligible matches, so a card on a match without a confirmed result does not appear. Own goals affect the confirmed score (the opposing team is credited) but are not attributed as a goal to any player.

## Match statistics

`GET /statistics/matches/:id` returns the match state and both participants.

- Before confirmation: `confirmed: false`, `score: null`, and empty `teamStatistics`/`playerStatistics`. It does not expose a provisional score as if it were final.
- After confirmation: `confirmed: true`, `score: { homeScore, awayScore }`, plus the team and player aggregates for both sides.

## Rankings

`GET /statistics/rankings/players` aggregates rows by `playerId` (across teams/seasons in the filter) and ranks by one metric: `goals` (default), `appearances`, `yellow_cards`, `red_cards` or `clean_sheets`. Ties are ordered by player name then player ID, so the order is deterministic. Positions are offset-aware. `limit` is 1–100.

## Corrections and invalidation

There is no cache. Correcting or voiding an event, clearing a result confirmation, correcting a lineup or re-confirming a lineup is visible on the next statistics request. No background job or materialised aggregate needs refreshing.

Lineup corrections change appearance/clean-sheet data but not standings, which depend only on confirmed results. See `standings.md` for result-driven snapshot invalidation.

## Out of scope

Assists, minutes played, distance, possession, shots, disciplinary points, player-of-the-match awards, historical per-match snapshots and cross-competition career records beyond the readable filters are not implemented.
