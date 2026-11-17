import type { Id, ISODateTime } from './common';

export type RoleName =
  | 'visitor'
  | 'user'
  | 'captain'
  | 'match-official'
  | 'competition-admin'
  | 'super-admin';

export interface Permission {
  key: string;
  description: string;
}

export interface Role {
  name: RoleName;
  permissions: Permission['key'][];
}

export interface User {
  id: Id;
  displayName: string;
  email?: string;
  roles: RoleName[];
}

export interface MatchOfficial {
  id: Id;
  userId: Id;
  fullName: string;
}

export interface MatchAssignment {
  id: Id;
  matchId: Id;
  officialId: Id;
  duty: 'referee' | 'assistant' | 'reporter';
}

export interface TournamentRound {
  id: Id;
  name: string;
  order: number;
  matchIds: Id[];
}

export interface TournamentBracket {
  id: Id;
  competitionId: Id;
  seasonId: Id;
  rounds: TournamentRound[];
  qualification: 'top-of-group' | 'best-ranked' | 'manual';
}

export type ArticleCategory = 'announcement' | 'match-report' | 'update' | 'team-news' | 'notice';

export type AnnouncementAudience =
  | 'public'
  | 'participants'
  | 'captains'
  | 'officials'
  | 'administrators';

/** Mirrors `/announcements`: no category, summary or author fields exist. */
export interface Announcement {
  id: Id;
  competitionId?: Id;
  seasonId?: Id;
  title: string;
  body: string;
  /** Always present in API responses; demo articles predate audiences. */
  audience?: AnnouncementAudience;
  publishedAt?: ISODateTime;
  archivedAt?: ISODateTime;
  createdAt?: ISODateTime;
  /* Demo-only fields; the backend returns none of them. */
  category?: ArticleCategory;
  summary?: string;
  author?: string;
  status?: 'draft' | 'scheduled' | 'published' | 'archived';
  featured?: boolean;
  relatedMatchIds?: Id[];
  relatedTeamIds?: Id[];
}

export interface AuditLog {
  id: Id;
  actorId: Id;
  action: string;
  targetType: string;
  targetId: Id;
  at: ISODateTime;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
}

