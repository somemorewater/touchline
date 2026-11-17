import type { League, Team } from '@/types';
import type { StandingsMetaDto } from '@/lib/api/types';

/** One table row. The backend computes position, points and goal difference. */
export interface StandingRow {
  teamId: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** The backend does not expose recent form, so this stays undefined. */
  form?: ('W' | 'D' | 'L')[];
}

export interface LeagueTable {
  league: League;
  teams: Map<string, Team>;
  rows: StandingRow[];
  meta?: StandingsMetaDto;
}
