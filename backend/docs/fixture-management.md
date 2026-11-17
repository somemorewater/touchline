# Fixture management

Fixtures are the scheduling unit. Every fixture belongs to one season and, optionally, one group. Home and away participants are `team_registrations`, not `teams`, so a fixture is always tied to a specific season participation. Creating a fixture also creates its one-to-one `matches` row in the same transaction.

Module: `src/modules/fixtures/` (`schemas.ts`, `routes.ts`, `service.ts`).

## Fixture status

`fixtures.status` is a separate lifecycle from `matches.status`.

| Status | Meaning |
|---|---|
| `draft` | Created but not publicly visible; editable |
| `scheduled` | Published; publicly readable; has a kickoff time |
| `postponed` | Deferred; reopens to `scheduled` on reschedule |
| `cancelled` | Terminal; the match is cancelled too |
| `completed` | Set by the match engine at full time |
| `abandoned` | Set by the match engine when the match is abandoned |

The database default is `scheduled` so that historical rows and direct inserts remain valid. Every fixture created through the API or through generation explicitly starts as `draft`.

```
create → draft
draft → scheduled        (POST /fixtures/:id/publish)
scheduled → draft        (POST /fixtures/:id/unpublish)
scheduled → postponed    (POST /fixtures/:id/postpone)
postponed → scheduled    (POST /fixtures/:id/reschedule)
scheduled | postponed | draft → cancelled   (POST /fixtures/:id/cancel)
scheduled → completed    (POST /matches/:id/end)
in-play → abandoned      (POST /matches/:id/abandon)
```

`completed`, `cancelled` and `abandoned` fixtures are read-only for `PATCH /fixtures/:id`. A completed fixture is never casually reset: the only way back is an administrative result correction, and the fixture status itself is not reopened by that endpoint.

Participant changes are only allowed while the fixture is `draft`, the match is still `scheduled`, and no event exists. Changing participants after kickoff is rejected with `409`.

## Endpoints

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/fixtures` | `fixtures.manage`, `matches.manage` or `competitions.update` in competition scope |
| GET | `/api/v1/fixtures` | public; authorized callers additionally see private/unpublished fixtures |
| POST | `/api/v1/fixtures/generate/preview` | same as create; writes nothing |
| POST | `/api/v1/fixtures/generate` | same as create; transactional commit |
| GET | `/api/v1/fixtures/:id` | public for a published fixture in a public competition; otherwise scope/official/captain |
| PATCH | `/api/v1/fixtures/:id` | fixture manager in scope |
| POST | `/api/v1/fixtures/:id/publish` | fixture manager in scope |
| POST | `/api/v1/fixtures/:id/unpublish` | fixture manager in scope |
| POST | `/api/v1/fixtures/:id/postpone` | fixture manager in scope; optional `reason` |
| POST | `/api/v1/fixtures/:id/reschedule` | fixture manager in scope; requires `scheduledAt`, optional `reason` |
| POST | `/api/v1/fixtures/:id/cancel` | fixture manager in scope; optional `reason` |

All write routes reject archived competitions and seasons that do not accept fixtures. `fixtures.manage`, `matches.manage` and `competitions.update` are interchangeable authority for scheduling; the scope is resolved from the database through `season → competition`.

## List filters

`GET /api/v1/fixtures` accepts `competitionId`, `seasonId`, `groupId`, `teamId`, `teamRegistrationId` and `status`. A `competitionId` or `seasonId` filter verifies read or manage permission first and returns `404` for a private resource the caller cannot see. Scoped administrators see all fixtures in their competitions through a season subquery; captains see their own team's fixtures; anonymous callers only see published fixtures.

## Validation

- Both registrations must exist, be `approved`, and belong to the fixture season.
- A team cannot play itself.
- A fixture may not cross seasons or competitions.
- The optional group must belong to the fixture season, and both participants must be in that group when one is supplied.
- `fixture_identity_uq` rejects an exact duplicate `(season, group, home, away, round)`. Reversed legs (`a vs b` and `b vs a`) are allowed.
- `round` is `NULL` or positive; `scheduledAt` is an ISO timestamp with offset.

## Generation algorithm

Generation uses the circle method (Berger tables). The pure function `buildRoundRobin(teamIds, legs)` in `service.ts` is independent of HTTP, so it can be reused by a script or test.

1. **Collect participants.** Approved, non-archived team registrations in the season; restricted to the group when `groupId` is supplied.
2. **Handle byes.** For an odd number of teams, append a synthetic bye slot. Pairings involving the bye are skipped, so each round has exactly one resting team.
3. **Fix the first slot.** Element 0 stays fixed; the remaining slots rotate one position per round. This guarantees every unordered pair appears exactly once and every team plays once per round.
4. **Alternate home/away.** The `(round + index)` parity flips the orientation so no team gets a pathological run of home games. Reversed legs are permitted by the identity key, so this never conflicts with the duplicate rule.
5. **Double legs.** With `legs = 2`, each first-leg pairing is mirrored with home and away swapped, and the mirrored leg is placed `roundsPerLeg` later.
6. **Round numbering.** The next schedule starts after the highest existing round for that season and group, so an appended schedule never collides with a previous one.
7. **Skip existing pairs.** Existing exact `(home, away)` pairs are removed from the plan. An existing reversed leg does not suppress the new direction.
8. **Preview or commit.** Preview returns the plan plus `teamCount`, `existingFixtureCount` and `startRound` and writes nothing. Commit locks the season row with `FOR UPDATE`, recomputes the plan inside the transaction, inserts `fixtures` (status `draft`) and their `matches` rows, and writes a `fixture.generated` audit entry.

For `n` teams a single leg has `n − 1` rounds (`n` rounds with a bye) and `n(n − 1)/2` fixtures. A double leg doubles both counts.

Commit is all-or-nothing. If no new fixtures remain, the endpoint returns `409` instead of pretending to succeed. Existing fixtures are never deleted, overwritten or reassigned.

Knockout competitions are rejected because a bracket is not a round-robin schedule.

## Transaction and locking

- Fixture writes lock the fixture row (`FOR UPDATE`); lifecycle writes that also touch the match lock the match first and then the fixture, matching the match engine's fixture→match order.
- Generation locks the season row to serialize concurrent generation for the same season.
- Fixture creation inserts fixture and match together; a failure rolls both back.
- Every lifecycle change writes to `audit_logs` with `entity_type = 'fixture'` (generation uses `entity_type = 'season'`) and the before/after snapshot.

## Not implemented

Venue clashes, rest-period constraints, broadcast slots, knockout brackets, group-stage cross-group progression and automatic fixture numbering are out of scope. `round`, `scheduledAt` and `venue` are managed explicitly by an administrator.
