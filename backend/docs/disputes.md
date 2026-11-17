# Disputes

`modules/disputes` lets captains dispute matters for their own team and lets administrators open disputes in their competition. Reviews, responses, information requests, decisions and closure are explicit, private and fully audited. A dispute decision **never** changes a match result or event.

## Authorization and visibility

- `disputes.manage` in competition scope manages/reviews all disputes; `super_admin` is global.
- `disputes.submit` lets a captain or scoped administrator submit. A captain must own the `teamRegistrationId`, and a dispute about a match may only reference a match their team played.
- An assigned reviewer may review the assigned dispute.
- Private by default. Visible parties are the submitter, the captain of the referenced team, an assigned reviewer and competition administrators. Everyone else receives `404`.
- A visible dispute without the required authority returns `403`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/disputes` | Create a draft or submitted dispute |
| GET | `/api/v1/disputes` | Paginated list; `competitionId`, `seasonId`, `status`, `subjectType`, `assignedToMe` |
| GET | `/api/v1/disputes/:id` | Dispute with visible entries |
| GET | `/api/v1/disputes/:id/history` | Audit history |
| POST | `/api/v1/disputes/:id/submit` | Draft → submitted |
| POST | `/api/v1/disputes/:id/reviewer` | Assign an active administrator reviewer |
| POST | `/api/v1/disputes/:id/review` | Start review |
| POST | `/api/v1/disputes/:id/responses` | Add a response (internal flag for reviewers) |
| POST | `/api/v1/disputes/:id/request-information` | Request additional information |
| POST | `/api/v1/disputes/:id/information` | Provide requested information |
| POST | `/api/v1/disputes/:id/decision` | Record outcome and decision |
| POST | `/api/v1/disputes/:id/close` | Close a decided dispute |

## Lifecycle

Statuses: `draft → submitted → under_review ⇄ awaiting_information → decided → closed`.

| Operation | Allowed from | Result |
|---|---|---|
| submit | `draft` | `submitted` |
| reviewer assignment | any non-`decided`/`closed` dispute | reviewer stored; status unchanged |
| start review | `submitted` | `under_review` |
| request information | `under_review` | `awaiting_information` |
| provide information | `awaiting_information` | `under_review` |
| decision | `under_review`, `awaiting_information` | `decided` |
| close | `decided` | `closed` |

Responses are rejected on closed disputes. Every transition locks the row, writes a `dispute_entries` row and writes `audit_logs` in one transaction.

Outcomes are `accepted`, `rejected`, `partially_accepted` and `no_action`. Subject types are `match_result`, `match_event`, `player_eligibility`, `team_participation`, `competition_decision` and `other`. Match-related subjects require `matchId`; the match, season and competition consistency is validated.

## Results stay in the match module

A decision records the outcome and reasoning only. It cannot edit `matches`, `match_events` or scores. If a dispute concludes that a result was wrong, an authorized administrator must use the Phase 5 correction flow (`POST /matches/:id/result/correct` or event correction/void) with its own reason and audit trail.

## Internal entries

Reviewers may mark a response `isInternal`. Internal entries are filtered out of the dispute detail for callers who are not reviewers. The audit history is append-only and sanitized of authentication material.

## Notifications

Submission notifies competition administrators (excluding the submitter). Responses, information requests, decisions and reviewer assignment notify the submitter/reviewer as appropriate. Notifications are persisted in-app in the same transaction; no external delivery is attempted.
