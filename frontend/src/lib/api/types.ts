/**
 * Backend response shapes used by the frontend.
 *
 * These mirror the actual Fastify module responses in `backend/src/modules`.
 * Keep them structural: only fields the UI consumes are typed, and every
 * optional/nullable field reflects the real contract.
 */

import type { PlayerPosition } from '@/lib/positions';

export type RoleName =
  | 'visitor'
  | 'registered_user'
  | 'team_captain'
  | 'match_official'
  | 'competition_admin'
  | 'super_admin';

export interface RoleAssignment {
  role: string;
  competitionId: string | null;
}

export interface SessionScope {
  competitionId: string;
  permissions: string[];
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
  roles: RoleAssignment[];
  permissions: string[];
  scopes: SessionScope[];
}

export interface CompetitionDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'registration' | 'active' | 'completed' | 'archived';
  format: 'single-league' | 'multiple-leagues' | 'group-stage' | 'knockout' | 'league-then-knockout';
  visibility: 'public' | 'private';
  createdAt: string;
  updatedAt: string;
}

export interface SeasonDto {
  id: string;
  competitionId: string;
  label: string;
  startsOn: string | null;
  endsOn: string | null;
  status: 'planned' | 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface GroupDto {
  id: string;
  seasonId: string;
  name: string;
  kind: 'league' | 'group';
  archivedAt: string | null;
}

export type RegistrationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'withdrawn';
export type RegistrationDisplayStatus = RegistrationStatus | 'pending_changes' | 'rejected_changes';

export interface TeamDto {
  id: string;
  name: string;
  shortName: string | null;
  department: string | null;
  logoFileId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamEntryDto {
  id: string;
  teamId: string;
  seasonId: string;
  groupId: string | null;
  captainUserId: string | null;
  status: RegistrationStatus;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamListEntryDto {
  registration: TeamEntryDto;
  team: TeamDto;
}

export interface TeamDetailDto extends TeamDto {
  entries: {
    registration: TeamEntryDto;
    season: SeasonDto;
    competition: CompetitionDto;
  }[];
}

export interface CaptainTeamDto {
  registration: TeamEntryDto;
  team: TeamDto;
  season: SeasonDto;
  competition: CompetitionDto;
}

export interface PlayerDto {
  id: string;
  fullName: string;
  department: string | null;
  dateOfBirth: string | null;
  position: PlayerPosition | null;
  preferredFoot: 'left' | 'right' | 'both' | null;
  photoFileId: string | null;
  contactEmail: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerRegistrationDto {
  id: string;
  playerId: string;
  teamRegistrationId: string;
  seasonId: string;
  matriculationNumber: string | null;
  shirtNumber: number | null;
  status: RegistrationStatus;
  displayStatus?: RegistrationDisplayStatus;
  eligibilityApproved: boolean;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  player: PlayerDto;
  team: TeamDto;
  teamRegistration: TeamEntryDto;
  season: SeasonDto;
  competition: CompetitionDto;
  pendingEdit?: { id: string; proposedBy: string; proposed: Record<string, unknown>; status: string; createdAt: string } | null;
  latestEdit?: { id: string; proposedBy: string; proposed: Record<string, unknown>; status: string; reviewNote: string | null; createdAt: string } | null;
}

export interface PlayerRegistrationHistoryDto {
  id: string;
  action: string;
  actorUserId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export type FixtureStatus = 'draft' | 'scheduled' | 'postponed' | 'cancelled' | 'completed' | 'abandoned';

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'first_half'
  | 'half_time'
  | 'second_half'
  | 'extra_time'
  | 'penalties'
  | 'full_time'
  | 'postponed'
  | 'cancelled'
  | 'abandoned';

export interface FixtureMatchSummaryDto {
  id: string;
  status: MatchStatus;
  homeScore: number;
  awayScore: number;
  resultConfirmedAt: string | null;
}

export interface FixtureDto {
  id: string;
  seasonId: string;
  groupId: string | null;
  homeTeamRegistrationId: string;
  awayTeamRegistrationId: string;
  round: number | null;
  scheduledAt: string | null;
  venue: string | null;
  status: FixtureStatus;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  match: FixtureMatchSummaryDto | null;
  homeTeam: { id: string; name: string; registrationId: string };
  awayTeam: { id: string; name: string; registrationId: string };
}

export interface FixturePreviewDto {
  rounds: number;
  fixtures: {
    round: number;
    homeTeamRegistrationId: string;
    awayTeamRegistrationId: string;
    homeTeamName: string;
    awayTeamName: string;
    groupId: string | null;
  }[];
  warnings?: string[];
}

export interface MatchEventDto {
  id: string;
  matchId: string;
  clientEventId: string;
  eventType: string;
  teamRegistrationId: string | null;
  playerRegistrationId: string | null;
  secondaryPlayerRegistrationId: string | null;
  minute: number;
  addedMinutes: number | null;
  description: string | null;
  clientTimestamp: string | null;
  receivedAt: string;
  voidedAt: string | null;
  correctedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MatchFixtureSummaryDto {
  id: string;
  seasonId: string;
  groupId: string | null;
  homeTeamRegistrationId: string;
  awayTeamRegistrationId: string;
  round: number | null;
  scheduledAt: string | null;
  venue: string | null;
  status: FixtureStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MatchDetailDto {
  match: {
    id: string;
    fixtureId: string;
    status: MatchStatus;
    homeScore: number;
    awayScore: number;
    resultConfirmedAt: string | null;
    confirmedBy: string | null;
    startedAt: string | null;
    endedAt: string | null;
    currentMinute: number | null;
    addedMinutes: number | null;
    createdAt: string;
    updatedAt: string;
    fixture: MatchFixtureSummaryDto;
    homeTeam: TeamDto | null;
    awayTeam: TeamDto | null;
    homeRegistration: TeamEntryDto | null;
    awayRegistration: TeamEntryDto | null;
  };
  events: MatchEventDto[];
  lineups: LineupDto[];
}

export interface MatchOfficialDto {
  userId: string;
  role: string;
  assignedAt: string;
  assignedBy: string | null;
  displayName: string;
}

export interface MatchResultDto {
  match: {
    id: string;
    status: MatchStatus;
    homeScore: number;
    awayScore: number;
    currentMinute: number | null;
    addedMinutes: number | null;
    startedAt: string | null;
    endedAt: string | null;
    resultConfirmedAt: string | null;
    confirmedBy: string | null;
  };
  fixture: {
    id: string;
    seasonId: string;
    groupId: string | null;
    round: number | null;
    scheduledAt: string | null;
    venue: string | null;
    status: FixtureStatus;
    publishedAt: string | null;
  };
  homeTeam: { teamId: string; name: string; registrationId: string } | null;
  awayTeam: { teamId: string; name: string; registrationId: string } | null;
  score: { homeScore: number; awayScore: number };
  derivedScore: { homeScore: number; awayScore: number };
  events: MatchEventDto[];
}

export type LineupStatus = 'draft' | 'submitted' | 'confirmed' | 'returned' | 'published';
export type LineupPosition = PlayerPosition;

export interface LineupPlayerDto {
  playerRegistrationId: string;
  role: 'starter' | 'substitute' | 'unavailable';
  shirtNumber: number | null;
  position: LineupPosition | null;
  x: number | null;
  y: number | null;
  isCaptain: boolean;
}

export interface LineupDto {
  id: string;
  matchId: string;
  teamRegistrationId: string;
  formation: string | null;
  status: LineupStatus;
  submittedAt: string | null;
  confirmedAt: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  createdAt: string;
  updatedAt: string;
  players: LineupPlayerDto[];
}

export interface FormationDto {
  id: string;
  segments: number[];
  goalkeeper: { x: number; y: number };
  outfieldSlots: { slot: string; position: 'DF' | 'MF' | 'FW'; x: number; y: number }[];
}

export interface PlayerStatisticsRowDto {
  playerRegistrationId: string;
  playerId: string;
  playerName: string;
  teamRegistrationId: string;
  teamId: string;
  teamName: string;
  seasonId: string;
  shirtNumber: number | null;
  appearances: number;
  starts: number;
  substituteAppearances: number;
  goals: number;
  penaltyGoals: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number;
  substitutionsMade: number;
  substitutionsReceived: number;
  cleanSheets: number;
}

export interface PlayerStatisticsDetailDto {
  player: { id: string; fullName: string };
  totals: Omit<
    PlayerStatisticsRowDto,
    'playerRegistrationId' | 'playerId' | 'playerName' | 'teamRegistrationId' | 'teamId' | 'teamName' | 'seasonId' | 'shirtNumber'
  >;
  bySeason: {
    seasonId: string;
    appearances: number;
    starts: number;
    substituteAppearances: number;
    goals: number;
    penaltyGoals: number;
    ownGoals: number;
    yellowCards: number;
    redCards: number;
    substitutionsMade: number;
    substitutionsReceived: number;
    cleanSheets: number;
  }[];
  rows: PlayerStatisticsRowDto[];
}

export interface TeamStatisticsRowDto {
  teamRegistrationId: string;
  teamId: string;
  teamName: string;
  seasonId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  cleanSheets: number;
  yellowCards: number;
  redCards: number;
}

export interface MatchStatisticsDto {
  match: { id: string; status: MatchStatus; resultConfirmedAt: string | null; startedAt: string | null; endedAt: string | null };
  fixture: { id: string; seasonId: string; groupId: string | null };
  homeTeam: { name: string; registrationId: string; teamId: string } | null;
  awayTeam: { name: string; registrationId: string; teamId: string } | null;
  confirmed: boolean;
  score: { homeScore: number; awayScore: number } | null;
  teamStatistics: TeamStatisticsRowDto[];
  playerStatistics: PlayerStatisticsRowDto[];
}

export interface PlayerRankingsDto {
  metric: 'goals' | 'appearances' | 'yellow_cards' | 'red_cards' | 'clean_sheets';
  rows: {
    position: number;
    playerId: string;
    playerName: string;
    metric: string;
    value: number;
    appearances: number;
    goals: number;
    yellowCards: number;
    redCards: number;
    cleanSheets: number;
  }[];
  limit: number;
  offset: number;
}

export interface StandingsRowDto {
  position: number;
  teamId: string;
  teamRegistrationId: string;
  teamName: string;
  groupId: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface StandingsMetaDto {
  competitionId: string;
  seasonId: string;
  groupId: string | null;
  scope: 'season' | 'group';
  points: { win: number; draw: number; loss: number };
  tieBreakers: string[];
  ignoredTieBreakers: string[];
  matchIds: string[];
  matchCount: number;
  fingerprint: string;
}

export interface StandingsSnapshotDto {
  id: string;
  seasonId: string;
  groupId: string | null;
  version: number;
  isCurrent: boolean;
  calculatedAt: string;
  meta: StandingsMetaDto;
  rows: StandingsRowDto[];
  stale?: boolean;
}

export interface StandingsDto {
  rows: StandingsRowDto[];
  meta: StandingsMetaDto;
  snapshot: StandingsSnapshotDto | null;
}

export type AnnouncementAudience = 'public' | 'participants' | 'captains' | 'officials' | 'administrators';

export interface AnnouncementDto {
  id: string;
  competitionId: string | null;
  seasonId: string | null;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  publishedAt: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  competitionId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  pagination: { limit: number; offset: number; returned: number };
}

export interface AuditLogDto {
  id: string;
  actorUserId: string | null;
  competitionId: string | null;
  seasonId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
}

export type DisciplinaryCaseStatus =
  | 'open'
  | 'under_review'
  | 'awaiting_response'
  | 'decided'
  | 'appealed'
  | 'closed';

export interface DisciplinaryCaseDto {
  id: string;
  competitionId: string;
  seasonId: string | null;
  subjectType: 'player' | 'team' | 'official' | 'match' | 'other';
  subjectPlayerRegistrationId: string | null;
  subjectUserId: string | null;
  subjectTeamRegistrationId: string | null;
  originType: 'match_event' | 'referee_report' | 'competition_administration' | 'other';
  originMatchId: string | null;
  title: string;
  description: string;
  status: DisciplinaryCaseStatus;
  assignedReviewerId: string | null;
  createdBy: string | null;
  openedAt: string;
  decidedAt: string | null;
  closedAt: string | null;
  closureReason: string | null;
  createdAt: string;
  updatedAt: string;
  competition?: CompetitionDto;
  season?: SeasonDto | null;
  sanctions?: DisciplinarySanctionDto[];
  entries?: DisciplinaryEntryDto[];
}

export interface DisciplinaryEntryDto {
  id: string;
  caseId: string;
  entryType: string;
  body: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  authorUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DisciplinarySanctionDto {
  id: string;
  caseId: string;
  subjectType: string;
  subjectPlayerRegistrationId: string | null;
  subjectUserId: string | null;
  subjectTeamRegistrationId: string | null;
  sanctionType: 'warning' | 'match_suspension' | 'competition_suspension' | 'other';
  reason: string;
  matchesCount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  liftedAt: string | null;
  createdAt: string;
}

export type DisputeStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'awaiting_information'
  | 'decided'
  | 'closed';

export interface DisputeDto {
  id: string;
  competitionId: string;
  seasonId: string | null;
  matchId: string | null;
  teamRegistrationId: string | null;
  subjectType:
    | 'match_result'
    | 'match_event'
    | 'player_eligibility'
    | 'team_participation'
    | 'competition_decision'
    | 'other';
  subjectRefId: string | null;
  title: string;
  description: string;
  status: DisputeStatus;
  assignedReviewerId: string | null;
  outcome: 'accepted' | 'rejected' | 'partially_accepted' | 'no_action' | null;
  decision: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  closedAt: string | null;
  closureReason: string | null;
  createdAt: string;
  updatedAt: string;
  competition?: CompetitionDto;
  season?: SeasonDto | null;
  entries?: DisputeEntryDto[];
}

export interface DisputeEntryDto {
  id: string;
  disputeId: string;
  entryType: string;
  body: string | null;
  isInternal: boolean;
  fromStatus: string | null;
  toStatus: string | null;
  authorUserId: string | null;
  createdAt: string;
}

export interface EvidenceDto {
  id: string;
  fileId: string;
  caseId: string | null;
  disputeId: string | null;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string | null;
  attachedBy: string | null;
  createdAt: string;
  removedAt: string | null;
  removalReason: string | null;
}

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleDto {
  role: string;
  competitionId: string | null;
  competitionName: string | null;
  assignedAt: string;
}

export interface UserAssociationsDto {
  captaincies: {
    teamRegistrationId: string;
    teamId: string;
    teamName: string;
    seasonId: string;
    seasonLabel: string;
    competitionId: string;
    competitionName: string;
    status: string;
  }[];
  officialAssignments: {
    matchId: string;
    role: string;
    assignedAt: string;
    seasonId: string;
    competitionId: string;
    competitionName: string;
  }[];
}

export interface AdminAccountDto {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  roles: string[];
  competitionIds: string[];
}

export interface AdministrationOverviewDto {
  competition: {
    id: string;
    slug: string;
    name: string;
    status: string;
    visibility: 'public' | 'private';
  };
  seasonId: string | null;
  teams: Record<string, number>;
  playerRegistrations: Record<string, number>;
  fixtures: Record<string, number>;
  matches: Record<string, number>;
  lineups: Record<string, number>;
  standings: { currentSnapshots: number };
  operational: {
    pendingRegistrations: number;
    fullTimeUnconfirmed: number;
    overdueScheduledFixtures: number;
    upcomingMatchesWithoutLineups: number;
  };
  warnings: string[];
}

export interface LiveMatchUpdate {
  type: 'match.update';
  reason: string;
  at: string;
  match: {
    matchId: string;
    status: MatchStatus;
    currentMinute: number | null;
    addedMinutes: number | null;
    homeScore: number;
    awayScore: number;
    resultConfirmedAt: string | null;
  };
  event?: {
    id: string;
    matchId: string;
    eventType: string;
    teamRegistrationId: string | null;
    playerRegistrationId: string | null;
    secondaryPlayerRegistrationId: string | null;
    minute: number;
    addedMinutes: number | null;
    description: string | null;
    voided: boolean;
    corrected: boolean;
  };
}
