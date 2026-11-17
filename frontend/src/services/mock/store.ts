import type {
  Announcement,
  Match,
  MatchEvent,
  MatchLineup,
  MatchReport,
  MatchStatistics,
  Player,
  PlayerStatistics,
  TeamStatistics,
} from '@/types';
import { IS_DEMO_DATA } from '@/config/data-mode';
import { afitU25, leagues, registrations, seasons, teams } from '@/data/seed/afit-u25';
import { buildDemoData } from '@/data/seed/demo';

const demo = IS_DEMO_DATA ? buildDemoData() : null;

/**
 * In-memory stand-in for the future REST backend. Only the service implementations in this
 * folder may import it; components talk to `services`, never to this file.
 * Real data today: competition, seasons, leagues, teams. In demo mode the store also holds
 * invented players, matches, events, lineups, statistics, reports and news.
 */
export const store = {
  competitions: demo ? [{ ...afitU25, status: 'active' as const }] : [afitU25],
  seasons,
  leagues,
  teams: demo?.teams ?? teams,
  registrations,
  players: demo?.players ?? ([] as Player[]),
  matches: demo?.matches ?? ([] as Match[]),
  events: demo?.events ?? ([] as MatchEvent[]),
  lineups: demo?.lineups ?? ([] as MatchLineup[]),
  matchStatistics: demo?.matchStatistics ?? ([] as MatchStatistics[]),
  reports: demo?.reports ?? ([] as MatchReport[]),
  playerStatistics: demo?.playerStatistics ?? ([] as PlayerStatistics[]),
  teamStatistics: demo?.teamStatistics ?? ([] as TeamStatistics[]),
  announcements: demo?.announcements ?? ([] as Announcement[]),
};
