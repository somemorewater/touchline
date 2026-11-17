import type { Id, ISODate } from './common';

export type CompetitionFormat =
  | 'single-league'
  | 'multiple-leagues'
  | 'group-stage'
  | 'knockout'
  | 'league-then-knockout';

export type CompetitionStatus =
  | 'draft'
  | 'published'
  | 'registration'
  | 'active'
  | 'completed'
  | 'archived';

/**
 * The backend stores no competition time zone. Times are displayed in UTC so
 * the server and client render the same text; the label says so where it matters.
 */
export const DISPLAY_TIME_ZONE = 'UTC';

export interface Season {
  id: Id;
  competitionId: Id;
  label: string;
  startsOn?: ISODate;
  endsOn?: ISODate;
  /** Demo seed omits it; real backend seasons always carry a status. */
  status?: 'planned' | 'active' | 'completed' | 'archived';
}

/**
 * A competition record exactly as `/competitions` returns it. Points and
 * tie-break rules are not stored on the competition: they arrive with the
 * standings response `meta`.
 */
export interface Competition {
  id: Id;
  slug: string;
  name: string;
  description: string;
  status: CompetitionStatus;
  format: CompetitionFormat;
  visibility?: 'public' | 'private';
  /* Demo-only fields retained so the offline sample store still compiles.
     The backend does not return any of these, and production views ignore them. */
  shortName?: string;
  logoUrl?: string;
  currentSeasonId?: Id;
  timeZone?: string;
  pointsSystem?: { win: number; draw: number; loss: number };
  tieBreakers?: string[];
  rules?: { extraTime?: boolean; penaltyShootouts?: boolean; [key: string]: unknown };
  ruleNotes?: { rule: string; status: 'confirmed' | 'temporary-default'; note?: string }[];
}

export type LeagueKind = 'league' | 'group';

export interface League {
  id: Id;
  competitionId: Id;
  seasonId: Id;
  name: string;
  kind: LeagueKind;
  archivedAt?: string | null;
}

export type Group = League;
