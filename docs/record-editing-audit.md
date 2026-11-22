# Record editing audit and implementation checklist

## Audit

| Area | Existing edit/review support | Decision |
| --- | --- | --- |
| Competitions, seasons, groups, rules, administrators | Scoped update operations and admin forms exist | Retain current paths; lifecycle actions stay separate |
| Teams and team entries | Team PATCH; entry PATCH for review/group; captain assignment actions | Retain current paths; role/scope checks in services |
| Player registrations and player profile fields | Create, review, approve, reject, withdraw; no edit route. Submitted player values currently live in the player row | Add separate pending edit proposal with explicit review; apply proposed values only on approval |
| Fixtures | PATCH and publish/unpublish/reschedule/cancel actions exist | Retain lifecycle-gated update path |
| Matches, clocks, events, results | Dedicated official event/clock operations and result confirmation/correction flow | Keep event corrections and result changes in these workflows; no generic status/score update |
| Lineups | PATCH plus submit/confirm/return/withdraw workflow exists | Retain current lifecycle checks; edits after approval require resubmission per service policy |
| Announcements | Update/archive routes and admin interface exist | Retain |
| Disputes, evidence, disciplinary cases | Status transitions and append-only response/evidence/timeline entries | Do not add arbitrary edit; preserve case history |
| Users, permissions, audit records | User administration actions; audit records are immutable | Do not add generic edit |
| Public pages | Read-only | No edit actions |

## Implementation checklist

- [x] Inspect backend modules, schemas, authorization helpers, and frontend workspaces.
- [x] Map existing update endpoints and identify missing player registration editing.
- [x] Keep player edits separate from approved values until an authorized reviewer accepts them.
- [x] Restrict proposal submission to the assigned team captain and review to scoped registration reviewers.
- [x] Preserve proposal and decision details in registration history/audit.
- [x] Add captain-facing edit and review status UI and admin proposal review controls.
- [ ] Run focused typechecks and tests for the changes (package manager unavailable in this environment).
