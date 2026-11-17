# Competitions

Competition rows support format/status/visibility; seasons are unique by competition and label; groups belong to a season; configurable points and tie-break rules belong to a season. Phase 4 implements competition create/update/publish/unpublish/archive, season create/update/activate/close/archive, and group create/update/archive through the `/api/v1` routes. See `competition-management.md` for the authority and lifecycle rules.

AFIT U25 Super League 2026/2027 must remain unseeded pending organizer confirmation. League-group list: AUTOMECH BOIS, COMPUTER SCIENCE, ICE, STAT/MATHS UTD, ND CIVIL FC, TELECOM FC; CYBER BOYS, PHYSICS/PWE UTD, AEROSPACE, ND ELECTRICAL, MET AND MECH, ELECTRICAL AND CHEMISTRY UNITED. The other frontend/legacy list differs in nine names. Only AUTOMECH BOIS, TELECOM FC and AEROSPACE are exact matches.

The schema still reserves `registration` and `active` competition statuses. Phase 4 exposes publish/unpublish (`draft`/`published`) and archive; a future phase can add explicit registration/active transitions.
