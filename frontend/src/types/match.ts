import type { Id, ISODateTime } from './common';
import type { PlayerPosition } from './player';

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'first-half'
  | 'half-time'
  | 'second-half'
  | 'full-time'
  | 'extra-time'
  | 'penalties'
  | 'postponed'
  | 'cancelled'
  | 'abandoned';

export const LIVE_STATUSES: readonly MatchStatus[] = [
  'live',
  'first-half',
  'half-time',
  'second-half',
  'extra-time',
  'penalties',
];

export interface Score {
  home: number;
  away: number;
}

export interface Match {
  id: Id;
  fixtureId?: Id;
  competitionId: Id;
  seasonId: Id;
  leagueId?: Id;
  round?: number;
  homeTeamId: Id;
  awayTeamId: Id;
  kickoffAt?: ISODateTime;
  venue?: string;
  durationMinutes?: number;
  clockRunningAt?: string | null;
  clockAccumulatedSeconds?: number;
  addedMinutes?: number | null;
  currentMinute?: number | null;
  status: MatchStatus;
  /** Null until a score has been recorded. */
  score: Score | null;
  /** Only confirmed results feed standings and brackets. */
  resultConfirmed: boolean;
}

interface EventBase {
  id: Id;
  matchId: Id;
  /** Match minute; stoppage time as e.g. 45 + 2 */
  minute: number;
  addedMinutes?: number;
  teamId: Id;
  playerId?: Id;
  description?: string;
  /** Local (offline) events are not yet server-confirmed. */
  syncState: 'confirmed' | 'pending' | 'failed' | 'conflict';
}

export type MatchEvent =
  | (EventBase & { type: 'goal'; assistPlayerId?: Id })
  | (EventBase & { type: 'own-goal' })
  | (EventBase & { type: 'yellow-card' | 'second-yellow' | 'red-card' })
  | (EventBase & { type: 'substitution'; playerOffId: Id; playerOnId: Id })
  | (EventBase & { type: 'injury' })
  | (EventBase & { type: 'penalty-awarded' | 'penalty-scored' | 'penalty-missed' })
  | (EventBase & { type: 'kickoff' | 'half-time' | 'full-time' });

export type MatchEventType = MatchEvent['type'];

export interface LineupPlayer {
  playerId: Id;
  role: 'starter' | 'substitute' | 'unavailable';
  shirtNumber?: number;
  position?: PlayerPosition;
  /** Pitch slot for formations, 0-100 on each axis (x across, y up the pitch). */
  slot?: { x: number; y: number };
  isCaptain?: boolean;
  /** Set when role is `unavailable`, e.g. "Injured". */
  unavailableReason?: string;
}

export interface MatchLineup {
  matchId: Id;
  teamId: Id;
  formation?: string;
  submittedAt?: ISODateTime;
  /** Demo lineups omit it; the API adapter always supplies the real status. */
  status?: 'draft' | 'submitted' | 'confirmed' | 'returned' | 'published';
  returnReason?: string;
  players: LineupPlayer[];
}

/** Only fields with real match data are present; absent = not recorded. */
export interface MatchTeamStats {
  possession?: number;
  shots?: number;
  shotsOnTarget?: number;
  corners?: number;
  fouls?: number;
  offsides?: number;
  saves?: number;
  passAccuracy?: number;
}

export interface MatchStatistics {
  matchId: Id;
  home: MatchTeamStats;
  away: MatchTeamStats;
}

export interface MatchReport {
  matchId: Id;
  summary: string;
  publishedAt?: ISODateTime;
  officialId?: Id;
}
