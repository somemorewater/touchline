# Disciplinary cases

`modules/disciplinary` implements a controlled case lifecycle, findings, responses, sanctions, appeals, closure and history. It does not mutate registration status, historical matches or match results. Sanctions are records, not automatic enforcement.

## Authorization and visibility

- `disciplinary.manage` in competition scope manages all cases. `super_admin` is global.
- An assigned reviewer may act on their assigned case without global management permission.
- The case creator and the subject (user, team captain or the captain of the subject player's team) may view their case and submit responses/appeals.
- Cases are private by default. A caller who cannot view a case receives `404`; a visible case without the required authority returns `403`.
- Viewing a case does not automatically let a reviewer change sanctions, closure or reviewer assignment; those helpers are checked separately.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/disciplinary-cases` | Open a case |
| GET | `/api/v1/disciplinary-cases` | Paginated list; `competitionId`, `seasonId`, `status`, `subjectType`, `assignedToMe` |
| GET | `/api/v1/disciplinary-cases/:id` | Case, entries and sanctions |
| GET | `/api/v1/disciplinary-cases/:id/history` | Audit history for `disciplinary_case` |
| GET | `/api/v1/disciplinary-cases/:id/sanctions` | Sanctions for the case |
| POST | `/api/v1/disciplinary-cases/:id/reviewer` | Assign an active administrator reviewer |
| POST | `/api/v1/disciplinary-cases/:id/review` | Start review |
| POST | `/api/v1/disciplinary-cases/:id/request-response` | Move to `awaiting_response` |
| POST | `/api/v1/disciplinary-cases/:id/findings` | Record a finding |
| POST | `/api/v1/disciplinary-cases/:id/decision` | Record the decision |
| POST | `/api/v1/disciplinary-cases/:id/appeal` | Appeal a decided case |
| POST | `/api/v1/disciplinary-cases/:id/close` | Close the case |
| POST | `/api/v1/disciplinary-cases/:id/notes` | Internal or shared note |
| POST | `/api/v1/disciplinary-cases/:id/responses` | Subject response |
| POST | `/api/v1/disciplinary-cases/:id/sanctions` | Issue a sanction |
| GET | `/api/v1/disciplinary/eligibility/players/:id` | Explicit future-eligibility check |
| GET | `/api/v1/disciplinary/eligibility/teams/:id` | Explicit future-eligibility check |

## Lifecycle

Statuses: `open → under_review → awaiting_response → decided → appealed → closed`.

| Operation | Allowed from | Result |
|---|---|---|
| reviewer assignment | any non-`closed` case | reviewer stored; status unchanged |
| review start | `open`, `awaiting_response`, `appealed` | `under_review` |
| request response | `under_review` | `awaiting_response` |
| finding | `under_review`, `awaiting_response` | status unchanged |
| decision | `under_review`, `awaiting_response` | `decided` |
| appeal | `decided` | `appealed` |
| close | `open`, `decided`, `appealed` | `closed` |

Reviewer assignment deliberately does not start review. The assigned reviewer starts review with the explicit `/review` operation, avoiding a hidden transition and a lifecycle race. Every transition is validated under `SELECT … FOR UPDATE`, recorded as a case entry and written to `audit_logs` in the same transaction.

## Sanctions

Subject types are `player`, `team`, `official` and `other`. Supported sanction types are:

- `warning`
- `match_suspension`
- `competition_suspension`
- `other`

Fines are deliberately **not** modelled because the competition rules define no monetary framework. A suspension requires either `matchesCount` or `endsAt`; date order is validated. Every sanction stores its case, competition, season, subject, reason, issuing administrator and active status.

Sanctions are historical records. Issuing one never changes `team_registrations.status`, `player_registrations.status`, historical matches or results. A future registration/matches workflow must call the eligibility check explicitly before using a subject.

## Eligibility checks

`GET /disciplinary/eligibility/players/:id` and `/teams/:id` evaluate active `match_suspension` and `competition_suspension` sanctions:

- optional `matchId` — the check is for that match and must belong to the subject's competition;
- optional `at` — evaluate at a specific ISO timestamp, otherwise now;
- `matchesCount` suspensions are considered served once enough confirmed matches after the sanction start have been played (the checked match is excluded).

The response is `{ eligible, reasons, sanctions[], checkedAt }`. These endpoints are the only supported enforcement surface; no lineup, result or registration route silently applies a suspension.

## Notifications and history

Opening a case, requesting a response, deciding, appeal and closure notify the subject when a subject user is known. Appeals notify competition administrators. Notifications are in-app records created in the same transaction.

`GET /:id/history` returns `audit_logs` for the case. Audit snapshots are append-only and sanitized by the audit read layer. Do not put authentication secrets in case text.

## Internal notes

Case notes are stored as `note` entries with `metadata.isInternal` (`true` by default). Both the case detail endpoint and the audit history endpoint enforce visibility server-side:

- A caller who can review the case (`canReviewCase`: the assigned reviewer, a competition administrator in scope, or a super administrator) receives every entry and the full note audit snapshot.
- The case creator and subject viewers (subject user, subject team captain or the captain of the subject player's team) receive only entries whose `metadata.isInternal` is not `true`. Explicitly shared notes (`isInternal: false`) remain visible.
- In the history response, the body of a reviewer-only note is omitted from the `before`/`after` audit snapshot for non-reviewers. The row, its action and the rest of the snapshot remain, and the note body is retained unchanged in `audit_logs` and `disciplinary_case_entries`.
- Callers who cannot view the case at all receive `404`, so note existence is never leaked.
