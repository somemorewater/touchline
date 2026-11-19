# Competition management

Phase 4 implements the administrative workflows around competitions, seasons, groups, teams, season participation and captain accounts. It does not implement fixtures, matches, lineups, standings, discipline or uploads.

## Authority model

| Actor | Scope | Can do |
|---|---|---|
| `super_admin` | global | Create competitions and administrator accounts, assign competition admins, manage every competition resource, review registrations globally |
| `competition_admin` | competitions explicitly assigned in `user_roles` | Manage competition/season/group/team/captain resources and review registrations only in those competitions |
| `team_captain` | team entries where `captain_user_id` is the account | View the assigned team, submit/withdraw player registrations, view their statuses |
| `registered_user` | none | Public/registered reads only; a player profile grants no management rights |

A global `competition_admin` assignment would apply everywhere by the existing `user_roles.competition_id IS NULL` rule. Accounts created by the Phase 4 API are always scoped to explicit competitions. Only a global `super_admin` can create another administrator or grant `super_admin`.

## Competition lifecycle

| From | Action | To |
|---|---|---|
| `draft` | publish | `published` |
| `published` | unpublish | `draft` |
| any non-archived | archive | `archived` |

Archived competitions are read-only: they cannot be updated, published, receive seasons/groups/team entries, or have registrations approved. Historical rows remain. There is no delete endpoint.

Competition creation is super-admin only and requires a unique lowercase hyphenated slug, a name and optional description/format/visibility. New competitions start as `draft`.

## Season lifecycle

| From | Action | To |
|---|---|---|
| `planned` | activate | `active` |
| `planned` or `active` | close | `completed` |
| `planned`, `active` or `completed` | archive | `archived` |

A season belongs to exactly one competition. Its date range is optional, but an end date cannot precede the start. Season labels are unique per competition. Seasons cannot be moved between competitions; create a new season instead.

Groups require a `planned` or `active` season. Group names are unique per season and a group cannot move between seasons. A group can be archived only when no team entry references it.

## Team entity versus season participation

- `teams` is the global team entity (name, short name, department, archival).
- `team_registrations` is that team's participation in one season. It carries the group, captain binding and participation status.
- A team can have at most one entry per season, but may enter many seasons or competitions without duplicating the team entity.

Creating a team with `seasonId` creates the entity and its `draft` entry in one transaction. A scoped administrator must supply `seasonId` to prove scope. A super admin may create a standalone team entity with no entry.

Team names are unique case-insensitively among non-archived teams. Archived teams may be restored only if their name is still free. Archiving is blocked while the team has a submitted, under-review or approved entry in a planned/active season.

Team-entry statuses use the shared `registration_status` vocabulary. The application allows:

| From | Allowed to |
|---|---|
| `draft` | `submitted`, `under_review`, `approved`, `rejected` |
| `submitted` | `under_review`, `approved`, `rejected`, `withdrawn` |
| `under_review` | `approved`, `rejected`, `withdrawn` |
| `approved` | `rejected`, `withdrawn` only when no active player registration remains |
| `rejected` / `withdrawn` | `submitted` |

Approval/rejection records `reviewed_by` and `reviewed_at`; rejection requires a reason.

Team-entry status/group changes and captain changes require a `planned` or `active` season. A `completed` or `archived` season is read-only for those workflows; historical entries and bindings remain visible but cannot be modified.

## Captain accounts

`POST /api/v1/captains` is the only provisioning path. The request carries email, display name, a temporary password of 8–128 characters, and a `teamRegistrationId`.

The service:

1. Resolves the team entry's competition and requires `captains.manage` there.
2. Rejects archived competitions and completed/archived seasons, and an entry that already has a captain.
3. Rejects a duplicate email.
4. Hashes the temporary password with Argon2id.
5. In one transaction: locks the team entry, inserts the user, grants the global `team_captain` role, and sets `team_registrations.captain_user_id`.
6. Returns only safe user fields plus the registration. Passwords and hashes are never returned.

If any step fails, the account insert is rolled back. No shared/default password or email provider is used; the administrator must deliver the temporary password out of band. There is no password-change endpoint in Phase 4.

An existing account can be assigned with `POST /team-entries/:id/captain` if it already holds the global `team_captain` role. Assignment requires a `planned` or `active` season; completed and archived seasons are read-only for captain changes. It must not already captain another team in the same season. Revocation clears `captain_user_id` but does not delete the account.

Captains receive the global `teams.read`, `teams.manage`, `players.read`, `players.manage`, `lineups.read` and `lineups.manage` grants from the existing role model. Every team-write route still verifies `captain_user_id`; global grants do not create cross-team access.

## Endpoint summary

See `api.md` for the full table. Main resources:

- `/competitions` and `/competitions/:id/{publish,unpublish,archive,seasons}`
- `/seasons/:id/{activate,close,archive,groups,team-entries}`
- `/groups/:id`
- `/teams`, `/teams/:id/{archive,restore}`
- `/team-entries/:id` and `/team-entries/:id/captain`
- `/captains` and `/captains/me/teams`

All write routes require `app.authenticate`; visibility is derived from database state, never from client-supplied roles or competition IDs.

## Assumptions and limitations

- Standalone team creation is super-admin only because a team with no entry has no competition scope to authorize against.
- A team entry is approved by an administrator before player registrations can be submitted. This makes participation explicit and gives approval revalidation a stable prerequisite.
- Team entry status changes are exposed through `PATCH /team-entries/:id`; there are no separate action URLs.
- Competition statuses `registration` and `active` exist in the schema but Phase 4 has no dedicated transition endpoints for them. Publish/unpublish and archive are the implemented lifecycle actions.
- Fixture generation, match operations, lineups, standings, discipline, disputes, uploads and notifications remain out of scope.
