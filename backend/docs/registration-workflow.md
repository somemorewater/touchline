# Player registration workflow

This document describes the Phase 4 player-registration lifecycle. Only a team captain submits; only a competition administrator or super administrator reviews. A player profile alone grants no management rights.

## Data model

- `players` is the global player record: full name, department, date of birth, position, preferred foot, contact email and archival timestamp.
- `player_registrations` links one player to one `team_registrations` entry and one season. The season is denormalized and kept consistent by the composite foreign key `player_registrations_team_season_fk`.
- `matriculation_number`, `shirt_number`, status, submission time, reviewer, review time, review note and eligibility flag live on the registration.
- `audit_logs` with `entity_type = 'player_registration'` is the history stream. Rows are never deleted.

## States and transitions

| State | Meaning |
|---|---|
| `submitted` | Captain has submitted; awaiting administrative review |
| `under_review` | An administrator has opened the registration for review |
| `approved` | Administrator approved after transactional revalidation |
| `rejected` | Administrator rejected with a reason |
| `withdrawn` | Captain withdrew while pending |

Implemented transitions:

```text
captain submit/resubmit ──> submitted ──review──> under_review ──approve──> approved
                                      \──────────approve/reject──────────/
                                      \──────────captain withdraw────────> withdrawn
rejected / withdrawn ──captain resubmit──> submitted
```

Approval and rejection are accepted from `submitted` or `under_review`. Reviewing an already-`under_review` registration returns `409`. A rejected/withdrawn row is reused on resubmission; it is never deleted.

## Submission

`POST /api/v1/player-registrations` requires authentication and a `teamRegistrationId`.

Authorization:

- `team_registrations.captain_user_id` must equal `request.auth.userId`.
- A captain cannot target another team's entry by changing the ID.
- Administrators cannot submit on a captain's behalf.

Eligibility checked before and inside the transaction:

- The team entry exists and belongs to a planned or active season.
- The team entry status is `approved`.
- The team and competition are not archived.
- The player exists and is not archived, or an inline player is created.
- The player has no other active (`submitted`, `under_review`, `approved`) registration in the season.
- The matriculation number is not actively used in the season.
- The shirt number is not already used by the team entry.
- The `(player, team entry)` pair does not already have an active registration.

Provide exactly one of `playerId` or `player`. Inline player fields are the ones already supported by the schema; no new personal-information fields were invented. When a date of birth is supplied, an exact case-insensitive name + date-of-birth match returns `409` with the existing player ID so the caller can reuse it. This is a best-effort identity check because the schema has no global player identity key.

Matriculation and shirt numbers are optional. Empty/whitespace matriculation values become `NULL`. Shirt numbers must be `1..99`.

## Review, approval and rejection

- `POST /player-registrations/:id/review` — requires `registrations.review` in the registration's competition. Sets `under_review`, `reviewed_by` and `reviewed_at`. A captain cannot review their own team.
- `POST /player-registrations/:id/approve` — requires the same permission. Locks the registration and team entry with `FOR UPDATE`, then revalidates all eligibility rules before setting `approved`, `eligibility_approved = true`, the reviewer and timestamp.
- `POST /player-registrations/:id/reject` — requires the same permission and a reason of 3–2000 characters. Stores the reason in `review_note`.
- `POST /player-registrations/:id/withdraw` — requires captain ownership and a pending state. Stores `withdrawn`; the row remains.

Approval revalidation includes:

- Team entry still `approved`; team not archived.
- Season still `planned` or `active`; competition not archived.
- Player still exists and is not archived.
- No other active registration for the player in the season.
- No other active holder of the matriculation number.
- No other holder of the shirt number in the team entry.

If validation fails, the transaction rolls back and the registration keeps its previous state. The captain sees the updated status through the detail/list endpoints.

## Scope and visibility

- Captains see only registrations whose team entry has them as `captain_user_id`.
- Competition administrators see registrations in competitions where they hold `registrations.review`; they cannot approve/reject outside that scope.
- A global super administrator can review anywhere.
- A global `competition_admin` role assignment applies everywhere by the existing `user_roles` null-scope rule. API-created admins are scoped.
- Player registrations are never public.

## Listing, detail and history

- `GET /player-registrations` filters by `competitionId`, `seasonId`, `teamId`, `teamRegistrationId` and `status`.
- `GET /player-registrations/:id` returns the registration with player, team, team entry, season and competition.
- `GET /player-registrations/:id/history` returns `audit_logs` transitions oldest first. Actions include `submitted`, `resubmitted`, `under_review`, `approved`, `rejected` and `withdrawn`.

## Concurrency and integrity

- The team entry is locked during submission so concurrent submissions for one roster serialize.
- Active player, matriculation and shirt-number uniqueness are also enforced by PostgreSQL partial/unique indexes. A race resolves to one winner and one `23505`, mapped to `409 RESOURCE_CONFLICT`.
- Approval locks the registration row; two concurrent approvals produce one `200` and one `409`.
- The decision and its audit row commit in the same transaction.
- Rejected/withdrawn rows preserve history and remain eligible for resubmission.

## Limitations and open rules

- No transfer workflow is defined. A player can have one active registration per season; a rejected/withdrawn row may precede another. Administrators should reject/withdraw the old row before a new team submits.
- Shirt numbers are unique per team entry across all statuses, including historical rejected/withdrawn rows. A new player cannot reuse a number still held by history; resubmitting the same player can update their number.
- There is no password-change or invitation flow for captains. The administrator supplies a temporary password out of band.
- No notification, document upload, eligibility evidence or dispute workflow exists in Phase 4.
