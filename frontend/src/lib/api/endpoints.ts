import { downloadAuthenticated, request, requestWithMeta, uploadBinary, type Query } from './client';
import type { PlayerPosition } from '@/lib/positions';
import type {
  AdminAccountDto,
  AdministrationOverviewDto,
  AnnouncementDto,
  AuditLogDto,
  CaptainTeamDto,
  CommentaryEntryDto,
  CompetitionDto,
  CurrentUser,
  DisciplinaryCaseDto,
  DisciplinaryEntryDto,
  DisciplinarySanctionDto,
  DisputeDto,
  DisputeEntryDto,
  EvidenceDto,
  FixtureDto,
  FixturePreviewDto,
  FormationDto,
  GroupDto,
  LineupDto,
  MatchDetailDto,
  MatchEventDto,
  MatchOverviewDto,
  MatchOfficialDto,
  MatchResultDto,
  MatchSquadDto,
  MatchStatisticsDto,
  NotificationDto,
  Paginated,
  PlayerRankingsDto,
  PlayerRegistrationDto,
  PlayerRegistrationHistoryDto,
  PlayerStatisticsDetailDto,
  PlayerStatisticsRowDto,
  SeasonDto,
  StandingsDto,
  StandingsSnapshotDto,
  TeamDetailDto,
  TeamDto,
  TeamEntryDto,
  TeamListEntryDto,
  TeamStatisticsRowDto,
  UserAssociationsDto,
  UserDto,
  UserRoleDto,
} from './types';

/* ------------------------------- auth ---------------------------------- */

export const authApi = {
  async login(email: string, password: string) {
    return request<{ accessToken: string; tokenType: string; expiresIn: number }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
      retryOn401: false,
    });
  },
  async register(input: { email: string; password: string; displayName: string }) {
    return request<{ id: string; email: string; displayName: string }>('/auth/register', {
      method: 'POST',
      body: input,
      auth: false,
      retryOn401: false,
    });
  },
  me() {
    return request<CurrentUser>('/auth/me');
  },
  logout() {
    return request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' });
  },
  logoutAll() {
    return request<{ loggedOutAll: boolean }>('/auth/logout-all', { method: 'POST' });
  },
  changePassword(input: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) {
    return request<{ changed: boolean }>('/auth/change-password', {
      method: 'POST',
      body: input,
    });
  },
};

/* ---------------------------- competitions ------------------------------ */

export const competitionsApi = {
  list() {
    return request<CompetitionDto[]>('/competitions');
  },
  get(id: string) {
    return request<CompetitionDto>(`/competitions/${id}`);
  },
  create(input: { slug: string; name: string; description?: string | null; format?: string; visibility?: string }) {
    return request<CompetitionDto>('/competitions', { method: 'POST', body: input });
  },
  update(id: string, input: { name?: string; description?: string | null; format?: string; visibility?: string }) {
    return request<CompetitionDto>(`/competitions/${id}`, { method: 'PATCH', body: input });
  },
  publish(id: string) {
    return request<CompetitionDto>(`/competitions/${id}/publish`, { method: 'POST' });
  },
  unpublish(id: string) {
    return request<CompetitionDto>(`/competitions/${id}/unpublish`, { method: 'POST' });
  },
  archive(id: string) {
    return request<CompetitionDto>(`/competitions/${id}/archive`, { method: 'POST' });
  },
  seasons(competitionId: string) {
    return request<SeasonDto[]>(`/competitions/${competitionId}/seasons`);
  },
  season(id: string) {
    return request<SeasonDto & { groups: GroupDto[] }>(`/seasons/${id}`);
  },
  createSeason(
    competitionId: string,
    input: { label: string; startsOn?: string | null; endsOn?: string | null },
  ) {
    return request<SeasonDto>(`/competitions/${competitionId}/seasons`, { method: 'POST', body: input });
  },
  updateSeason(id: string, input: { label?: string; startsOn?: string | null; endsOn?: string | null }) {
    return request<SeasonDto>(`/seasons/${id}`, { method: 'PATCH', body: input });
  },
  activateSeason(id: string) {
    return request<SeasonDto>(`/seasons/${id}/activate`, { method: 'POST' });
  },
  closeSeason(id: string) {
    return request<SeasonDto>(`/seasons/${id}/close`, { method: 'POST' });
  },
  archiveSeason(id: string) {
    return request<SeasonDto>(`/seasons/${id}/archive`, { method: 'POST' });
  },
  groups(seasonId: string) {
    return request<GroupDto[]>(`/seasons/${seasonId}/groups`);
  },
  createGroup(seasonId: string, input: { name: string; kind?: 'league' | 'group' }) {
    return request<GroupDto>(`/seasons/${seasonId}/groups`, { method: 'POST', body: input });
  },
  updateGroup(id: string, input: { name?: string }) {
    return request<GroupDto>(`/groups/${id}`, { method: 'PATCH', body: input });
  },
  archiveGroup(id: string) {
    return request<GroupDto>(`/groups/${id}/archive`, { method: 'POST' });
  },
};

/* -------------------------------- teams --------------------------------- */

export const teamsApi = {
  list(query: { competitionId?: string; seasonId?: string } = {}) {
    return request<TeamDto[]>('/teams', { query: query as Query });
  },
  get(id: string) {
    return request<TeamDetailDto>(`/teams/${id}`, {});
  },
  create(input: {
    name: string;
    shortName?: string | null;
    department?: string | null;
    seasonId?: string;
    groupId?: string | null;
  }) {
    return request<TeamDto & { registration: TeamEntryDto | null }>('/teams', { method: 'POST', body: input });
  },
  update(id: string, input: { name?: string; shortName?: string | null; department?: string | null }) {
    return request<TeamDto>(`/teams/${id}`, { method: 'PATCH', body: input });
  },
  archive(id: string) {
    return request<TeamDto>(`/teams/${id}/archive`, { method: 'POST' });
  },
  restore(id: string) {
    return request<TeamDto>(`/teams/${id}/restore`, { method: 'POST' });
  },
  entries(seasonId: string) {
    return request<TeamListEntryDto[]>(`/seasons/${seasonId}/team-entries`, {});
  },
  entry(id: string) {
    return request<TeamEntryDto & { team?: TeamDto; season?: SeasonDto }>(`/team-entries/${id}`, {});
  },
  createEntry(seasonId: string, input: { teamId: string; groupId?: string | null }) {
    return request<{ registration: TeamEntryDto; team: TeamDto }>(`/seasons/${seasonId}/team-entries`, {
      method: 'POST',
      body: input,
    });
  },
  updateEntry(id: string, input: { groupId?: string | null; status?: string; reviewNote?: string | null }) {
    return request<TeamEntryDto>(`/team-entries/${id}`, { method: 'PATCH', body: input });
  },
  captain(entryId: string) {
    return request<{ teamRegistrationId: string; captain: { id: string; email: string; displayName: string } | null }>(
      `/team-entries/${entryId}/captain`,
    );
  },
  assignCaptain(entryId: string, userId: string) {
    return request<unknown>(`/team-entries/${entryId}/captain`, { method: 'POST', body: { userId } });
  },
  revokeCaptain(entryId: string) {
    return request<unknown>(`/team-entries/${entryId}/captain/revoke`, { method: 'POST' });
  },
  provisionCaptain(input: {
    email: string;
    password: string;
    displayName: string;
    teamRegistrationId: string;
  }) {
    return request<unknown>('/captains', { method: 'POST', body: input });
  },
  myCaptainTeams() {
    return request<CaptainTeamDto[]>('/captains/me/teams');
  },
};

/* ---------------------------- registrations ----------------------------- */

export const registrationsApi = {
  list(
    query: {
      competitionId?: string;
      seasonId?: string;
      teamId?: string;
      teamRegistrationId?: string;
      status?: string;
      displayStatus?: string;
    } = {},
  ) {
    return request<PlayerRegistrationDto[]>('/player-registrations', { query: query as Query });
  },
  get(id: string) {
    return request<PlayerRegistrationDto>(`/player-registrations/${id}`);
  },
  history(id: string) {
    return request<PlayerRegistrationHistoryDto[]>(`/player-registrations/${id}/history`);
  },
  submit(input: {
    teamRegistrationId: string;
    playerId?: string;
    player?: {
      fullName: string;
      department?: string | null;
      dateOfBirth?: string | null;
      position?: PlayerPosition | null;
      preferredFoot?: 'left' | 'right' | 'both' | null;
      contactEmail?: string | null;
    };
    matriculationNumber?: string | null;
    shirtNumber?: number | null;
  }) {
    return request<PlayerRegistrationDto>('/player-registrations', { method: 'POST', body: input });
  },
  proposeEdit(id: string, input: { player?: { fullName?: string; department?: string | null; dateOfBirth?: string | null; position?: PlayerPosition | null; preferredFoot?: 'left' | 'right' | 'both' | null; contactEmail?: string | null }; matriculationNumber?: string | null; shirtNumber?: number | null }) {
    return request<{ registration: PlayerRegistrationDto; pendingEdit: { id: string; proposed: Record<string, unknown>; status: string } }>(`/player-registrations/${id}`, { method: 'PATCH', body: input });
  },
  reviewEdit(id: string, editId: string, decision: 'approve' | 'reject', reviewNote?: string | null) {
    return request<unknown>(`/player-registrations/${id}/edits/${editId}/review`, { method: 'POST', body: { decision, reviewNote } });
  },
  review(id: string, reviewNote?: string | null) {
    return request<PlayerRegistrationDto>(`/player-registrations/${id}/review`, {
      method: 'POST',
      body: { reviewNote: reviewNote ?? null },
    });
  },
  approve(id: string, reviewNote?: string | null) {
    return request<PlayerRegistrationDto>(`/player-registrations/${id}/approve`, {
      method: 'POST',
      body: { reviewNote: reviewNote ?? null },
    });
  },
  reject(id: string, reason: string) {
    return request<PlayerRegistrationDto>(`/player-registrations/${id}/reject`, {
      method: 'POST',
      body: { reason },
    });
  },
  withdraw(id: string) {
    return request<PlayerRegistrationDto>(`/player-registrations/${id}/withdraw`, { method: 'POST' });
  },
};

/* ------------------------------- fixtures ------------------------------- */

export const fixturesApi = {
  list(
    query: {
      competitionId?: string;
      seasonId?: string;
      groupId?: string;
      teamId?: string;
      teamRegistrationId?: string;
      status?: string;
    } = {},
  ) {
    return request<FixtureDto[]>('/fixtures', { query: query as Query });
  },
  get(id: string) {
    return request<FixtureDto>(`/fixtures/${id}`, {});
  },
  create(input: {
    seasonId: string;
    groupId?: string | null;
    homeTeamRegistrationId: string;
    awayTeamRegistrationId: string;
    round?: number | null;
    scheduledAt?: string | null;
    venue?: string | null;
    officialUserId?: string | null;
    commentaryUserId?: string | null;
  }) {
    return request<{
      competitionId: string;
      seasonId: string;
      fixture: FixtureDto;
      match: { id: string };
      official: MatchOfficialDto | null;
      commentary: MatchOfficialDto | null;
    }>('/fixtures', { method: 'POST', body: input });
  },
  update(
    id: string,
    input: {
      groupId?: string | null;
      homeTeamRegistrationId?: string;
      awayTeamRegistrationId?: string;
      round?: number | null;
      scheduledAt?: string | null;
      venue?: string | null;
    },
  ) {
    return request<FixtureDto>(`/fixtures/${id}`, { method: 'PATCH', body: input });
  },
  publish(id: string) {
    return request<FixtureDto>(`/fixtures/${id}/publish`, { method: 'POST' });
  },
  unpublish(id: string) {
    return request<FixtureDto>(`/fixtures/${id}/unpublish`, { method: 'POST' });
  },
  postpone(id: string, reason?: string | null) {
    return request<FixtureDto>(`/fixtures/${id}/postpone`, { method: 'POST', body: { reason: reason ?? null } });
  },
  reschedule(id: string, scheduledAt: string, reason?: string | null) {
    return request<FixtureDto>(`/fixtures/${id}/reschedule`, {
      method: 'POST',
      body: { scheduledAt, reason: reason ?? null },
    });
  },
  cancel(id: string, reason?: string | null) {
    return request<FixtureDto>(`/fixtures/${id}/cancel`, { method: 'POST', body: { reason: reason ?? null } });
  },
  previewGeneration(input: { seasonId: string; groupId?: string | null; legs?: 1 | 2 }) {
    return request<FixturePreviewDto>('/fixtures/generate/preview', { method: 'POST', body: input });
  },
  generate(input: { seasonId: string; groupId?: string | null; legs?: 1 | 2 }) {
    return request<{ created: number; fixtures: FixtureDto[] }>('/fixtures/generate', { method: 'POST', body: input });
  },
};

/* -------------------------------- matches -------------------------------- */

export type MatchLifecycleAction =
  | 'start'
  | 'half-time'
  | 'second-half'
  | 'end'
  | 'postpone'
  | 'cancel'
  | 'abandon'
  | 'reinstate';

export const matchesApi = {
  get(id: string) {
    return request<MatchDetailDto>(`/matches/${id}`, {});
  },
  events(id: string) {
    return request<MatchEventDto[]>(`/matches/${id}/events`, {});
  },
  squad(id: string) {
    return request<MatchSquadDto>(`/matches/${id}/squad`);
  },
  createEvent(
    id: string,
    input: {
      clientEventId: string;
      eventType: string;
      teamRegistrationId?: string | null;
      playerRegistrationId?: string | null;
      secondaryPlayerRegistrationId?: string | null;
      minute: number;
      addedMinutes?: number | null;
      description?: string | null;
      clientTimestamp?: string | null;
    },
  ) {
    return request<{ created: boolean; event: MatchEventDto; match: { homeScore: number; awayScore: number } }>(
      `/matches/${id}/events`,
      { method: 'POST', body: input, idempotencyKey: input.clientEventId },
    );
  },
  correctEvent(id: string, eventId: string, input: Record<string, unknown> & { reason: string }) {
    return request<MatchEventDto>(`/matches/${id}/events/${eventId}`, { method: 'PATCH', body: input });
  },
  voidEvent(id: string, eventId: string, reason: string) {
    return request<MatchEventDto>(`/matches/${id}/events/${eventId}/void`, { method: 'POST', body: { reason } });
  },
  officials(id: string) {
    return request<MatchOfficialDto[]>(`/matches/${id}/officials`, {});
  },
  assignOfficial(id: string, userId: string, role: 'official' | 'commentary' = 'official') {
    return request<MatchOfficialDto>(`/matches/${id}/officials`, { method: 'POST', body: { userId, role } });
  },
  replaceOfficial(id: string, role: 'official' | 'commentary', userId: string) {
    return request<MatchOfficialDto>(`/matches/${id}/personnel/${role}`, {
      method: 'PUT', body: { userId },
    });
  },
  removeOfficial(id: string, userId: string) {
    return request<{ removed: boolean; userId: string }>(`/matches/${id}/officials/${userId}`, { method: 'DELETE' });
  },
  myOfficialMatches() {
    return request<
      {
        matchId: string;
        fixtureId: string;
        seasonId: string;
        competitionId: string;
        status: string;
        scheduledAt: string | null;
        homeTeamName: string;
        awayTeamName: string;
      }[]
    >('/officials/me/matches');
  },
  lifecycle(id: string, action: MatchLifecycleAction, reason?: string | null) {
    return request<{ match: MatchResultDto['match'] }>(`/matches/${id}/${action}`, {
      method: 'POST',
      body: { reason: reason ?? null },
    });
  },
  reinstate(id: string) {
    return request<{ match: MatchResultDto['match'] }>(`/matches/${id}/reinstate`, {
      method: 'POST',
      body: {},
    });
  },
  updateVenue(id: string, venue: string | null) {
    return request<{ venue: string | null }>(`/matches/${id}/venue`, {
      method: 'PATCH',
      body: { venue },
    });
  },
  updateDuration(id: string, durationMinutes: number) {
    return request<{ durationMinutes: number }>(`/matches/${id}/duration`, {
      method: 'PATCH',
      body: { durationMinutes },
    });
  },
  reschedule(id: string, scheduledAt: string, reason?: string | null) {
    return request<unknown>(`/matches/${id}/reschedule`, {
      method: 'POST',
      body: { scheduledAt, reason: reason ?? null },
    });
  },
  clock(id: string, minute: number, addedMinutes?: number | null) {
    return request<unknown>(`/matches/${id}/clock`, {
      method: 'PATCH',
      body: { minute, addedMinutes: addedMinutes ?? null },
    });
  },
  result(id: string) {
    return request<MatchResultDto>(`/matches/${id}/result`, {});
  },
  resultHistory(id: string) {
    return request<AuditLogDto[]>(`/matches/${id}/result/history`);
  },
  report(id: string, reason?: string | null) {
    return request<{ match: MatchResultDto['match']; score: MatchResultDto['score']; resultConfirmedAt: string | null }>(
      `/matches/${id}/report`,
      { method: 'POST', body: { reason: reason ?? null } },
    );
  },
  correctResult(id: string, reason: string) {
    return request<{ match: MatchResultDto['match']; score: MatchResultDto['score'] }>(`/matches/${id}/result/correct`, {
      method: 'POST',
      body: { reason },
    });
  },
};

/* -------------------------------- lineups -------------------------------- */

export const lineupsApi = {
  formations() {
    return request<FormationDto[]>('/lineups/formations', {});
  },
  list(query: { matchId?: string; teamRegistrationId?: string; seasonId?: string; competitionId?: string; status?: string }) {
    return request<Paginated<LineupDto>>('/lineups', { query: query as Query });
  },
  forMatch(matchId: string) {
    return request<LineupDto[]>(`/matches/${matchId}/lineups`, {});
  },
  get(id: string) {
    return request<LineupDto>(`/lineups/${id}`, {});
  },
  create(
    matchId: string,
    input: {
      teamRegistrationId: string;
      formation?: string | null;
      players: LineupPlayerInput[];
    },
  ) {
    return request<LineupDto>(`/matches/${matchId}/lineups`, { method: 'POST', body: input });
  },
  update(
    id: string,
    input: {
      formation?: string | null;
      players?: LineupPlayerInput[];
      reason?: string;
    },
  ) {
    return request<LineupDto>(`/lineups/${id}`, { method: 'PATCH', body: input });
  },
  submit(id: string) {
    return request<LineupDto>(`/lineups/${id}/submit`, { method: 'POST' });
  },
  confirm(id: string, reason?: string) {
    return request<LineupDto>(`/lineups/${id}/confirm`, { method: 'POST', body: reason ? { reason } : {} });
  },
  publish(id: string) {
    return request<LineupDto>(`/lineups/${id}/publish`, { method: 'POST' });
  },
  returnLineup(id: string, reason: string) {
    return request<LineupDto>(`/lineups/${id}/return`, { method: 'POST', body: { reason } });
  },
  withdraw(id: string) {
    return request<LineupDto>(`/lineups/${id}/withdraw`, { method: 'POST', body: {} });
  },
  teamHistory(teamRegistrationId: string) {
    return request<Paginated<LineupDto>>(`/team-entries/${teamRegistrationId}/lineups`);
  },
};

/** The write contract accepts only starters and substitutes. */
export interface LineupPlayerInput {
  playerRegistrationId: string;
  role: 'starter' | 'substitute';
  position: PlayerPosition;
  shirtNumber: number;
  x?: number | null;
  y?: number | null;
  isCaptain?: boolean;
}

/* ------------------------------ statistics ------------------------------- */

export const statisticsApi = {
  players(query: { competitionId?: string; seasonId?: string; groupId?: string; teamId?: string; limit?: number; offset?: number }) {
    return request<PlayerStatisticsRowDto[]>('/statistics/players', { query: query as Query });
  },
  player(id: string, query: { competitionId?: string; seasonId?: string } = {}) {
    return request<PlayerStatisticsDetailDto>(`/statistics/players/${id}`, { query: query as Query });
  },
  teams(query: { competitionId?: string; seasonId?: string; groupId?: string }) {
    return request<TeamStatisticsRowDto[]>('/statistics/teams', { query: query as Query });
  },
  match(id: string) {
    return request<MatchStatisticsDto>(`/statistics/matches/${id}`, {});
  },
  rankings(query: { competitionId?: string; seasonId?: string; metric?: string; limit?: number }) {
    return request<PlayerRankingsDto>('/statistics/rankings/players', { query: query as Query });
  },
};

/* ------------------------------- standings ------------------------------- */

export const standingsApi = {
  get(query: { seasonId: string; groupId?: string }) {
    return request<StandingsDto>('/standings', { query: query as Query });
  },
  calculate(input: { seasonId: string; groupId?: string | null }) {
    return request<{ rows: StandingsDto['rows']; meta: StandingsDto['meta'] }>('/standings/calculate', {
      method: 'POST',
      body: input,
    });
  },
  snapshot(input: { seasonId: string; groupId?: string | null; reason?: string }) {
    return request<StandingsSnapshotDto>('/standings/snapshots', { method: 'POST', body: input });
  },
  recalculate(input: { seasonId: string; groupId?: string | null; reason: string }) {
    return request<StandingsSnapshotDto>('/standings/recalculate', { method: 'POST', body: input });
  },
  snapshots(query: { seasonId: string; groupId?: string; limit?: number }) {
    return request<{ items: StandingsSnapshotDto[]; limit: number; offset: number }>(
      '/standings/snapshots',
      { query: query as Query },
    );
  },
  snapshotById(id: string) {
    return request<StandingsSnapshotDto>(`/standings/snapshots/${id}`, {});
  },
};

/* ------------------------------ announcements ---------------------------- */

export const announcementsApi = {
  async list(query: { competitionId?: string; seasonId?: string; audience?: string; limit?: number } = {}) {
    const result = await requestWithMeta<AnnouncementDto[]>('/announcements', {
      query: query as Query,
    });
    return result.data;
  },
  manage(query: { competitionId?: string; seasonId?: string; status?: string; audience?: string; limit?: number } = {}) {
    return request<Paginated<AnnouncementDto>>('/announcements/manage', { query: query as Query });
  },
  create(input: {
    competitionId?: string | null;
    seasonId?: string | null;
    title: string;
    body: string;
    audience?: string;
  }) {
    return request<AnnouncementDto>('/announcements', { method: 'POST', body: input });
  },
  update(
    id: string,
    input: { seasonId?: string | null; title?: string; body?: string; audience?: string },
  ) {
    return request<AnnouncementDto>(`/announcements/${id}`, { method: 'PATCH', body: input });
  },
  publish(id: string) {
    return request<AnnouncementDto>(`/announcements/${id}/publish`, { method: 'POST' });
  },
  unpublish(id: string) {
    return request<AnnouncementDto>(`/announcements/${id}/unpublish`, { method: 'POST' });
  },
  archive(id: string) {
    return request<AnnouncementDto>(`/announcements/${id}/archive`, { method: 'POST' });
  },
};

/* ------------------------------ notifications ---------------------------- */

export const notificationsApi = {
  list(query: { unreadOnly?: boolean; limit?: number } = {}) {
    return request<Paginated<NotificationDto>>('/notifications', { query: query as Query });
  },
  unreadCount() {
    return request<{ unread: number }>('/notifications/unread-count');
  },
  markRead(id: string) {
    return request<{ id: string; readAt: string }>(`/notifications/${id}/read`, { method: 'POST' });
  },
  markAllRead() {
    return request<{ updated: number }>('/notifications/read-all', { method: 'POST' });
  },
};

/* ------------------------------ disciplinary ----------------------------- */

export const disciplinaryApi = {
  list(query: { competitionId?: string; seasonId?: string; status?: string; subjectType?: string; assignedToMe?: boolean; limit?: number } = {}) {
    return request<Paginated<DisciplinaryCaseDto>>('/disciplinary-cases', { query: query as Query });
  },
  get(id: string) {
    return request<DisciplinaryCaseDto>(`/disciplinary-cases/${id}`);
  },
  history(id: string) {
    return request<AuditLogDto[]>(`/disciplinary-cases/${id}/history`);
  },
  sanctions(id: string) {
    return request<DisciplinarySanctionDto[]>(`/disciplinary-cases/${id}/sanctions`);
  },
  create(input: {
    competitionId: string;
    seasonId?: string | null;
    subjectType: string;
    subjectPlayerRegistrationId?: string | null;
    subjectUserId?: string | null;
    subjectTeamRegistrationId?: string | null;
    originType: string;
    originMatchId?: string | null;
    originEventId?: string | null;
    title: string;
    description: string;
  }) {
    return request<DisciplinaryCaseDto>('/disciplinary-cases', { method: 'POST', body: input });
  },
  assignReviewer(id: string, reviewerId: string, reason?: string | null) {
    return request<DisciplinaryCaseDto>(`/disciplinary-cases/${id}/reviewer`, {
      method: 'POST',
      body: { reviewerId, reason: reason ?? null },
    });
  },
  review(id: string, reason?: string | null) {
    return request<DisciplinaryCaseDto>(`/disciplinary-cases/${id}/review`, {
      method: 'POST',
      body: { reason: reason ?? null },
    });
  },
  requestResponse(id: string, reason: string) {
    return request<DisciplinaryCaseDto>(`/disciplinary-cases/${id}/request-response`, {
      method: 'POST',
      body: { reason },
    });
  },
  addFindings(id: string, body: string) {
    return request<DisciplinaryEntryDto>(`/disciplinary-cases/${id}/findings`, { method: 'POST', body: { body } });
  },
  decide(id: string, decision: string, reason?: string | null) {
    return request<DisciplinaryCaseDto>(`/disciplinary-cases/${id}/decision`, {
      method: 'POST',
      body: { decision, reason: reason ?? null },
    });
  },
  appeal(id: string, reason: string) {
    return request<DisciplinaryCaseDto>(`/disciplinary-cases/${id}/appeal`, { method: 'POST', body: { reason } });
  },
  close(id: string, reason: string) {
    return request<DisciplinaryCaseDto>(`/disciplinary-cases/${id}/close`, { method: 'POST', body: { reason } });
  },
  addNote(id: string, body: string, isInternal: boolean) {
    return request<DisciplinaryEntryDto>(`/disciplinary-cases/${id}/notes`, {
      method: 'POST',
      body: { body, isInternal },
    });
  },
  addResponse(id: string, body: string) {
    return request<DisciplinaryEntryDto>(`/disciplinary-cases/${id}/responses`, { method: 'POST', body: { body } });
  },
  addSanction(id: string, input: Record<string, unknown>) {
    return request<DisciplinarySanctionDto>(`/disciplinary-cases/${id}/sanctions`, { method: 'POST', body: input });
  },
  playerEligibility(playerRegistrationId: string, query: { matchId?: string } = {}) {
    return request<Record<string, unknown>>(`/disciplinary/eligibility/players/${playerRegistrationId}`, {
      query: query as Query,
    });
  },
  teamEligibility(teamRegistrationId: string, query: { matchId?: string } = {}) {
    return request<Record<string, unknown>>(`/disciplinary/eligibility/teams/${teamRegistrationId}`, {
      query: query as Query,
    });
  },
};

/* -------------------------------- disputes ------------------------------- */

export const disputesApi = {
  list(query: { competitionId?: string; seasonId?: string; status?: string; subjectType?: string; assignedToMe?: boolean; limit?: number } = {}) {
    return request<Paginated<DisputeDto>>('/disputes', { query: query as Query });
  },
  get(id: string) {
    return request<DisputeDto>(`/disputes/${id}`);
  },
  history(id: string) {
    return request<AuditLogDto[]>(`/disputes/${id}/history`);
  },
  create(input: {
    competitionId: string;
    seasonId?: string | null;
    matchId?: string | null;
    teamRegistrationId?: string | null;
    subjectType: string;
    subjectRefId?: string | null;
    title: string;
    description: string;
    submit?: boolean;
  }) {
    return request<DisputeDto>('/disputes', { method: 'POST', body: input });
  },
  submit(id: string) {
    return request<DisputeDto>(`/disputes/${id}/submit`, { method: 'POST', body: {} });
  },
  assignReviewer(id: string, reviewerId: string, reason?: string | null) {
    return request<DisputeDto>(`/disputes/${id}/reviewer`, {
      method: 'POST',
      body: { reviewerId, reason: reason ?? null },
    });
  },
  review(id: string, reason?: string | null) {
    return request<DisputeDto>(`/disputes/${id}/review`, { method: 'POST', body: { reason: reason ?? null } });
  },
  addResponse(id: string, body: string, isInternal = false) {
    return request<DisputeEntryDto>(`/disputes/${id}/responses`, { method: 'POST', body: { body, isInternal } });
  },
  requestInformation(id: string, body: string) {
    return request<DisputeEntryDto>(`/disputes/${id}/request-information`, { method: 'POST', body: { body } });
  },
  addInformation(id: string, body: string) {
    return request<DisputeEntryDto>(`/disputes/${id}/information`, { method: 'POST', body: { body } });
  },
  decide(id: string, outcome: string, decision: string, reason?: string | null) {
    return request<DisputeDto>(`/disputes/${id}/decision`, {
      method: 'POST',
      body: { outcome, decision, reason: reason ?? null },
    });
  },
  close(id: string, reason: string) {
    return request<DisputeDto>(`/disputes/${id}/close`, { method: 'POST', body: { reason } });
  },
};

/* -------------------------------- evidence ------------------------------- */

export const filesApi = {
  caseEvidence(caseId: string) {
    return request<EvidenceDto[]>(`/disciplinary-cases/${caseId}/evidence`);
  },
  disputeEvidence(disputeId: string) {
    return request<EvidenceDto[]>(`/disputes/${disputeId}/evidence`);
  },
  uploadCaseEvidence(caseId: string, file: File) {
    return uploadBinary(`/disciplinary-cases/${caseId}/evidence`, file) as Promise<EvidenceDto>;
  },
  uploadDisputeEvidence(disputeId: string, file: File) {
    return uploadBinary(`/disputes/${disputeId}/evidence`, file) as Promise<EvidenceDto>;
  },
  removeCaseEvidence(caseId: string, evidenceId: string, reason?: string) {
    return request<EvidenceDto>(`/disciplinary-cases/${caseId}/evidence/${evidenceId}`, {
      method: 'DELETE',
      query: { reason },
    });
  },
  removeDisputeEvidence(disputeId: string, evidenceId: string, reason?: string) {
    return request<EvidenceDto>(`/disputes/${disputeId}/evidence/${evidenceId}`, {
      method: 'DELETE',
      query: { reason },
    });
  },
  download(fileId: string) {
    return downloadAuthenticated(`/files/${fileId}/content`);
  },
};

/* --------------------------------- audit --------------------------------- */

export const auditApi = {
  list(
    query: {
      competitionId?: string;
      seasonId?: string;
      actorUserId?: string;
      action?: string;
      entityType?: string;
      entityId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    return request<Paginated<AuditLogDto>>('/audit-logs', { query: query as Query });
  },
};

/* --------------------------------- users --------------------------------- */

export const usersApi = {
  list(query: { q?: string; status?: string; role?: string; competitionId?: string; limit?: number; offset?: number } = {}) {
    return request<Paginated<UserDto>>('/users', { query: query as Query });
  },
  get(id: string) {
    return request<UserDto>(`/users/${id}`);
  },
  roles(id: string, query: { competitionId?: string } = {}) {
    return request<UserRoleDto[]>(`/users/${id}/roles`, { query: query as Query });
  },
  associations(id: string) {
    return request<UserAssociationsDto>(`/users/${id}/associations`);
  },
  history(id: string) {
    return request<AuditLogDto[]>(`/users/${id}/history`);
  },
  deactivate(id: string) {
    return request<UserDto>(`/users/${id}/deactivate`, { method: 'POST' });
  },
  activate(id: string) {
    return request<UserDto>(`/users/${id}/activate`, { method: 'POST' });
  },
  suspend(id: string, reason: string) {
    return request<UserDto>(`/users/${id}/suspend`, { method: 'POST', body: { reason } });
  },
  restore(id: string) {
    return request<UserDto>(`/users/${id}/restore`, { method: 'POST' });
  },
  revokeSessions(id: string, reason?: string) {
    return request<{ revoked: number }>(`/users/${id}/sessions/revoke`, {
      method: 'POST',
      body: { reason: reason ?? undefined },
    });
  },
  grantRole(id: string, role: string, competitionId?: string | null) {
    return request<UserRoleDto>(`/users/${id}/roles`, {
      method: 'POST',
      body: { role, competitionId: competitionId ?? null },
    });
  },
  revokeRole(id: string, role: string, competitionId?: string | null) {
    return request<{ revoked: boolean }>(`/users/${id}/roles/${role}`, {
      method: 'DELETE',
      query: { competitionId },
    });
  },
};

/* ---------------------------- admin accounts ----------------------------- */

export const adminApi = {
  list(query: { competitionId?: string } = {}) {
    return request<AdminAccountDto[]>('/admin-accounts', { query: query as Query });
  },
  create(input: {
    email: string;
    password: string;
    displayName: string;
    role: 'competition_admin' | 'super_admin';
    competitionIds?: string[];
  }) {
    return request<AdminAccountDto>('/admin-accounts', { method: 'POST', body: input });
  },
  assignCompetition(userId: string, competitionId: string) {
    return request<unknown>(`/admin-accounts/${userId}/competitions`, {
      method: 'POST',
      body: { competitionId },
    });
  },
  removeCompetition(userId: string, competitionId: string) {
    return request<unknown>(`/admin-accounts/${userId}/competitions/${competitionId}`, { method: 'DELETE' });
  },
  overview(competitionId: string, seasonId?: string) {
    return request<AdministrationOverviewDto>(`/competitions/${competitionId}/administration`, {
      query: { seasonId },
    });
  },
};

/* ------------------------- competition accounts ------------------------- */

export const competitionAccountsApi = {
  create(input: {
    email: string;
    password: string;
    displayName: string;
    role: 'match_official' | 'commentary_operator';
    competitionId: string;
  }) {
    return request<{
      id: string;
      email: string;
      displayName: string;
      role: string;
      competitionId: string;
    }>('/competition-accounts', { method: 'POST', body: input });
  },
};

/* ------------------------------ commentary ----------------------------- */

export interface CommentaryCreateInput {
  kind: 'commentary' | 'key_moment';
  eventType?: string | null;
  body: string;
  minute?: number | null;
  addedMinutes?: number | null;
  teamRegistrationId?: string | null;
  isImportant?: boolean;
  status?: 'draft' | 'published';
}

export const commentaryApi = {
  list(matchId: string) {
    return request<CommentaryEntryDto[]>(`/matches/${matchId}/commentary`);
  },
  create(matchId: string, input: CommentaryCreateInput) {
    return request<CommentaryEntryDto>(`/matches/${matchId}/commentary`, {
      method: 'POST',
      body: input,
    });
  },
  update(matchId: string, entryId: string, input: Partial<CommentaryCreateInput>) {
    return request<CommentaryEntryDto>(`/matches/${matchId}/commentary/${entryId}`, {
      method: 'PATCH',
      body: input,
    });
  },
  retract(matchId: string, entryId: string) {
    return request<CommentaryEntryDto>(`/matches/${matchId}/commentary/${entryId}/retract`, {
      method: 'POST',
    });
  },
  overview(matchId: string) {
    return request<MatchOverviewDto | null>(`/matches/${matchId}/overview`);
  },
  saveOverview(
    matchId: string,
    input: {
      introduction: string | null;
      preMatchNotes: string | null;
      liveSummary: string | null;
      narrative: string | null;
    },
  ) {
    return request<MatchOverviewDto>(`/matches/${matchId}/overview`, {
      method: 'PUT',
      body: input,
    });
  },
};
