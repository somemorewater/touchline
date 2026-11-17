import type { Competition, League, Season, Team, TeamRegistration } from '@/types';

export const COMPETITION_ID = 'afit-u25-super-league';
export const SEASON_ID = 'afit-u25-2026-27';

export const afitU25: Competition = {
  id: COMPETITION_ID,
  slug: 'afit-u25-super-league',
  name: 'AFIT U25 Super League',
  shortName: 'U25 Super League',
  description:
    'The AFIT departmental football competition for players under 25. Twelve departmental teams play in two leagues of six.',
  logoUrl: '/afit-u25-logo.jpeg',
  status: 'registration',
  currentSeasonId: SEASON_ID,
  format: 'multiple-leagues',
  timeZone: 'Africa/Lagos',
  pointsSystem: { win: 3, draw: 1, loss: 0 },
  // Carried over from the original TOUCHLINE site (points, then goal difference, then goals scored).
  tieBreakers: ['goalDifference', 'goalsFor'],
  rules: {},
  ruleNotes: [
    { rule: 'Points: 3 for a win, 1 for a draw', status: 'temporary-default', note: 'Used by the original site; organisers have not confirmed it.' },
    { rule: 'Tie-breakers: goal difference, then goals scored', status: 'temporary-default', note: 'Head-to-head is not applied until the organisers decide.' },
    { rule: 'Match length, substitutions, squad size, extra time and penalties', status: 'temporary-default', note: 'Not set. Nothing is assumed.' },
  ],
};

export const seasons: Season[] = [{ id: SEASON_ID, competitionId: COMPETITION_ID, label: '2026/2027' }];

export const leagues: League[] = [
  { id: 'league-a', competitionId: COMPETITION_ID, seasonId: SEASON_ID, name: 'League A', kind: 'league' },
  { id: 'league-b', competitionId: COMPETITION_ID, seasonId: SEASON_ID, name: 'League B', kind: 'league' },
];

const LEAGUE_TEAMS: Record<string, string[]> = {
  'league-a': ['AUTOMECH BOIS', 'COMPUTER SCIENCE', 'ICE', 'STAT/MATHS UTD', 'ND CIVIL FC', 'TELECOM FC'],
  'league-b': ['CYBER BOYS', 'PHYSICS/PWE UTD', 'AEROSPACE', 'ND ELECTRICAL', 'MET AND MECH', 'ELECTRICAL AND CHEMISTRY UNITED'],
};

export const teams: Team[] = [];
export const registrations: TeamRegistration[] = [];

for (const [leagueId, names] of Object.entries(LEAGUE_TEAMS)) {
  names.forEach((name, i) => {
    const id = `${leagueId}-${i + 1}`;
    teams.push({ id, name });
    registrations.push({
      id: `reg-${id}`,
      teamId: id,
      competitionId: COMPETITION_ID,
      seasonId: SEASON_ID,
      leagueId,
      // The brief lists these as the registered teams, so they are shown as approved entries.
      status: 'approved',
    });
  });
}
