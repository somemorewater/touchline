import type { MatchDetail, Services, SearchResult } from '../contracts';
import {
  announcementsApi,
  competitionsApi,
  fixturesApi,
  matchesApi,
  registrationsApi,
  statisticsApi,
  teamsApi,
} from '@/lib/api/endpoints';
import { ApiError, getAccessToken } from '@/lib/api/client';
import type {
  AnnouncementDto,
  CompetitionDto,
  FixtureDto,
  LineupDto,
  LineupPosition,
  MatchDetailDto,
  MatchEventDto,
  MatchStatus,
  PlayerRegistrationDto,
  PlayerStatisticsRowDto,
  SeasonDto,
  TeamDto,
  TeamEntryDto,
} from '@/lib/api/types';
import type {
  Announcement,
  Competition,
  League,
  LineupPlayer,
  Match,
  MatchEvent,
  MatchLineup,
  MatchStatus as ViewMatchStatus,
  Player,
  PlayerStatistics,
  Season,
  Team,
  TeamRegistration,
  TeamStatistics,
} from '@/types';
import { notRecorded } from '@/types';
import type { TeamEntry } from '../contracts';

const mapMatchStatus = (status: MatchStatus): ViewMatchStatus =>
  status.replaceAll('_', '-') as ViewMatchStatus;

const mapRegistrationStatus = (status: TeamEntryDto['status']) =>
  status.replaceAll('_', '-') as TeamRegistration['status'];

function toCompetition(dto: CompetitionDto): Competition {
  return {
    id: dto.id,
    slug: dto.slug,
    name: dto.name,
    description: dto.description ?? '',
    status: dto.status,
    format: dto.format,
    visibility: dto.visibility,
  };
}

function toSeason(dto: SeasonDto): Season {
  return {
    id: dto.id,
    competitionId: dto.competitionId,
    label: dto.label,
    startsOn: dto.startsOn ?? undefined,
    endsOn: dto.endsOn ?? undefined,
    status: dto.status,
  };
}

function toTeam(dto: TeamDto): Team {
  return {
    id: dto.id,
    name: dto.name,
    shortName: dto.shortName ?? undefined,
    department: dto.department ?? undefined,
  };
}

function toRegistration(
  dto: TeamEntryDto,
  competitionId: string,
): TeamRegistration {
  return {
    id: dto.id,
    teamId: dto.teamId,
    competitionId,
    seasonId: dto.seasonId,
    leagueId: dto.groupId ?? undefined,
    status: mapRegistrationStatus(dto.status),
    submittedAt: dto.submittedAt ?? undefined,
    reviewNote: dto.reviewNote ?? undefined,
    captainUserId: dto.captainUserId ?? undefined,
  };
}

function toAnnouncement(dto: AnnouncementDto): Announcement {
  return {
    id: dto.id,
    competitionId: dto.competitionId ?? undefined,
    seasonId: dto.seasonId ?? undefined,
    title: dto.title,
    body: dto.body,
    audience: dto.audience,
    publishedAt: dto.publishedAt ?? undefined,
    archivedAt: dto.archivedAt ?? undefined,
    createdAt: dto.createdAt,
  };
}

function toPlayerFromStatistics(row: PlayerStatisticsRowDto): Player {
  return {
    id: row.playerId,
    fullName: row.playerName,
    teamId: row.teamId,
    shirtNumber: row.shirtNumber ?? undefined,
    squadStatus: 'approved',
  };
}

function toPlayerFromRegistration(entry: PlayerRegistrationDto): Player {
  return {
    id: entry.playerId,
    fullName: entry.player.fullName,
    teamId: entry.team.id,
    department: entry.player.department ?? undefined,
    position: entry.player.position ?? undefined,
    shirtNumber: entry.shirtNumber ?? undefined,
    dateOfBirth: entry.player.dateOfBirth ?? undefined,
    squadStatus: entry.status === 'approved' ? 'approved' : 'registered',
  };
}

/* ------------------------------------------------------------------ */
/* Season → competition lookup                                        */
/* ------------------------------------------------------------------ */

const seasonCompetition = new Map<string, string>();
const seasonLookups = new Map<string, Promise<string | null>>();

async function resolveCompetitionForSeason(seasonId: string): Promise<string | null> {
  const cached = seasonCompetition.get(seasonId);
  if (cached) return cached;
  const inFlight = seasonLookups.get(seasonId);
  if (inFlight) return inFlight;

  const lookup = (async () => {
    const competitions = await competitionsApi.list();
    for (const competition of competitions) {
      const seasons = await competitionsApi.seasons(competition.id);
      for (const season of seasons) {
        seasonCompetition.set(season.id, competition.id);
      }
      if (seasons.some((season) => season.id === seasonId)) return competition.id;
    }
    return null;
  })().finally(() => seasonLookups.delete(seasonId));

  seasonLookups.set(seasonId, lookup);
  return lookup;
}

/* ------------------------------------------------------------------ */
/* Fixtures → view matches                                            */
/* ------------------------------------------------------------------ */

function toMatch(fixture: FixtureDto, competitionId: string): Match {
  const status = fixture.match ? mapMatchStatus(fixture.match.status) : 'scheduled';
  const hasScore = Boolean(fixture.match) && status !== 'scheduled';
  return {
    id: fixture.match?.id ?? fixture.id,
    fixtureId: fixture.id,
    competitionId,
    seasonId: fixture.seasonId,
    leagueId: fixture.groupId ?? undefined,
    round: fixture.round ?? undefined,
    homeTeamId: fixture.homeTeam.id,
    awayTeamId: fixture.awayTeam.id,
    kickoffAt: fixture.scheduledAt ?? undefined,
    venue: fixture.venue ?? undefined,
    durationMinutes: fixture.match?.durationMinutes ?? undefined,
    status,
    score: hasScore && fixture.match ? { home: fixture.match.homeScore, away: fixture.match.awayScore } : null,
    resultConfirmed: Boolean(fixture.match?.resultConfirmedAt),
  };
}

const EVENT_TYPE: Record<string, MatchEvent['type']> = {
  goal: 'goal',
  own_goal: 'own-goal',
  yellow_card: 'yellow-card',
  second_yellow: 'second-yellow',
  red_card: 'red-card',
  substitution: 'substitution',
  injury: 'injury',
  penalty_awarded: 'penalty-awarded',
  penalty_scored: 'penalty-scored',
  penalty_missed: 'penalty-missed',
  kickoff: 'kickoff',
  half_time: 'half-time',
  full_time: 'full-time',
};

function toEvent(
  dto: MatchEventDto,
  registrationTeam: Map<string, string>,
  registrationPlayer: Map<string, string>,
): MatchEvent | null {
  const type = EVENT_TYPE[dto.eventType];
  if (!type) return null;
  const teamId = dto.teamRegistrationId ? registrationTeam.get(dto.teamRegistrationId) ?? '' : '';
  const playerId = dto.playerRegistrationId
    ? registrationPlayer.get(dto.playerRegistrationId) ?? dto.playerRegistrationId
    : undefined;
  const base = {
    id: dto.id,
    matchId: dto.matchId,
    minute: dto.minute,
    addedMinutes: dto.addedMinutes ?? undefined,
    teamId,
    description: dto.description ?? undefined,
    syncState: 'confirmed' as const,
  };

  if (type === 'substitution') {
    return {
      ...base,
      type,
      playerOffId: dto.playerRegistrationId
        ? registrationPlayer.get(dto.playerRegistrationId) ?? dto.playerRegistrationId
        : '',
      playerOnId: dto.secondaryPlayerRegistrationId
        ? registrationPlayer.get(dto.secondaryPlayerRegistrationId) ?? dto.secondaryPlayerRegistrationId
        : '',
    };
  }
  return { ...base, type, playerId };
}

function toLineup(
  dto: LineupDto,
  teamId: string,
  registrationTeam: Map<string, string>,
  registrationPlayer: Map<string, string>,
): MatchLineup {
  return {
    matchId: dto.matchId,
    teamId,
    formation: dto.formation ?? undefined,
    submittedAt: dto.submittedAt ?? undefined,
    status: dto.status,
    returnReason: dto.returnReason ?? undefined,
    players: dto.players.map((player): LineupPlayer => ({
      playerId: registrationPlayer.get(player.playerRegistrationId) ?? player.playerRegistrationId,
      role: player.role,
      shirtNumber: player.shirtNumber ?? undefined,
      position: (player.position ?? undefined) as LineupPosition | undefined,
      slot:
        player.x !== null && player.y !== null
          ? { x: Number(player.x), y: Number(player.y) }
          : undefined,
      isCaptain: player.isCaptain,
    })),
  };
}

/** Best-effort registration→player lookup. Public callers fall back to statistics only. */
async function loadRegistrationIndex(competitionId?: string, seasonId?: string) {
  // Player registrations require authentication; do not issue a request that
  // is guaranteed to be rejected for anonymous/public match pages.
  const registrationsQ = getAccessToken()
    ? registrationsApi.list({ competitionId, seasonId }).catch(() => [] as PlayerRegistrationDto[])
    : Promise.resolve([] as PlayerRegistrationDto[]);
  const [stats, registrations] = await Promise.all([
    statisticsApi.players({ competitionId, seasonId, limit: 500 }).catch(() => [] as PlayerStatisticsRowDto[]),
    registrationsQ,
  ]);

  const byRegistration = new Map<string, Player>();
  const byId = new Map<string, Player>();
  for (const row of stats) {
    const player = toPlayerFromStatistics(row);
    byId.set(player.id, player);
  }
  for (const entry of registrations) {
    const player = toPlayerFromRegistration(entry);
    byRegistration.set(entry.id, player);
    byId.set(player.id, player);
  }
  return { byRegistration, byId, stats, registrations };
}

function toPlayerStatistics(
  row: PlayerStatisticsRowDto,
  competitionId: string,
): PlayerStatistics {
  return {
    playerId: row.playerId,
    competitionId,
    seasonId: row.seasonId,
    appearances: { state: 'known', value: row.appearances },
    starts: { state: 'known', value: row.starts },
    substituteAppearances: { state: 'known', value: row.substituteAppearances },
    // The backend computes no minutes or assists. Never invent them.
    minutesPlayed: notRecorded,
    goals: { state: 'known', value: row.goals },
    assists: notRecorded,
    yellowCards: { state: 'known', value: row.yellowCards },
    redCards: { state: 'known', value: row.redCards },
    cleanSheets: { state: 'known', value: row.cleanSheets },
  };
}

export const apiServices: Services = {
  competitions: {
    async list() {
      return (await competitionsApi.list()).map(toCompetition);
    },
    async get(idOrSlug) {
      const list = await competitionsApi.list();
      const match = list.find((competition) => competition.id === idOrSlug || competition.slug === idOrSlug);
      if (!match) return null;
      return toCompetition(await competitionsApi.get(match.id));
    },
    async listSeasons(competitionId) {
      return (await competitionsApi.seasons(competitionId)).map(toSeason);
    },
    async listLeagues(competitionId, seasonId) {
      const groups = await competitionsApi.groups(seasonId);
      return groups.map((group): League => ({
        id: group.id,
        competitionId,
        seasonId: group.seasonId,
        name: group.name,
        kind: group.kind,
        archivedAt: group.archivedAt,
      }));
    },
  },

  teams: {
    async listEntries({ competitionId, seasonId }) {
      const entries = await teamsApi.entries(seasonId);
      return entries.map((entry): TeamEntry => ({
        team: toTeam(entry.team),
        registration: toRegistration(entry.registration, competitionId),
      }));
    },
    async get(teamId) {
      const detail = await teamsApi.get(teamId);
      const entry = detail.entries[0];
      if (!entry) return null;
      return {
        team: toTeam(detail),
        registration: toRegistration(entry.registration, entry.competition.id),
      };
    },
    async statistics({ competitionId, seasonId }) {
      const rows = await statisticsApi.teams({ competitionId, seasonId });
      return rows.map((row): TeamStatistics => ({
        teamId: row.teamId,
        competitionId,
        seasonId: row.seasonId,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        cleanSheets: { state: 'known', value: row.cleanSheets },
        yellowCards: { state: 'known', value: row.yellowCards },
        redCards: { state: 'known', value: row.redCards },
      }));
    },
  },

  players: {
    async list({ teamId, competitionId }) {
      const index = await loadRegistrationIndex(competitionId);
      const seen = new Map<string, Player>();
      for (const row of index.stats) {
        if (teamId && row.teamId !== teamId) continue;
        seen.set(row.playerId, index.byId.get(row.playerId) ?? toPlayerFromStatistics(row));
      }
      for (const entry of index.registrations) {
        if (teamId && entry.team.id !== teamId) continue;
        if (!seen.has(entry.playerId)) seen.set(entry.playerId, toPlayerFromRegistration(entry));
      }
      return [...seen.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
    },
    async get(playerId) {
      try {
        const detail = await statisticsApi.player(playerId);
        const row = detail.rows[0];
        if (row) {
          return {
            ...toPlayerFromStatistics(row),
            fullName: detail.player.fullName,
          };
        }
        return {
          id: detail.player.id,
          fullName: detail.player.fullName,
          teamId: '',
          squadStatus: 'approved' as const,
        };
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
      // Staff may read registrations that public statistics do not expose.
      const registrations = await registrationsApi.list().catch(() => [] as PlayerRegistrationDto[]);
      const entry = registrations.find((registration) => registration.playerId === playerId);
      return entry ? toPlayerFromRegistration(entry) : null;
    },
    async statistics({ competitionId, seasonId }) {
      const rows = await statisticsApi.players({ competitionId, seasonId });
      return rows.map((row) => toPlayerStatistics(row, competitionId));
    },
  },

  matches: {
    async list({ competitionId, seasonId, teamId, leagueId }) {
      const fixtures = await fixturesApi.list({ competitionId, seasonId, teamId, groupId: leagueId });
      return fixtures.map((fixture) => toMatch(fixture, competitionId));
    },
    async get(matchId) {
      let detail: MatchDetailDto;
      try {
        detail = await matchesApi.get(matchId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }

      const seasonId = detail.match.fixture.seasonId;
      const competitionId = await resolveCompetitionForSeason(seasonId);
      if (!competitionId) return null;

      const registrationTeam = new Map<string, string>();
      if (detail.match.homeRegistration) {
        registrationTeam.set(detail.match.homeRegistration.id, detail.match.homeTeam?.id ?? '');
      }
      if (detail.match.awayRegistration) {
        registrationTeam.set(detail.match.awayRegistration.id, detail.match.awayTeam?.id ?? '');
      }

      const index = await loadRegistrationIndex(competitionId, seasonId);
      const registrationPlayer = new Map<string, string>();
      for (const [registrationId, player] of index.byRegistration) {
        registrationPlayer.set(registrationId, player.id);
      }

      const match = toMatch(
        {
          ...detail.match.fixture,
          createdBy: null,
          match: {
            id: detail.match.id,
            status: detail.match.status,
            homeScore: detail.match.homeScore,
            awayScore: detail.match.awayScore,
            resultConfirmedAt: detail.match.resultConfirmedAt,
            durationMinutes: detail.match.durationMinutes,
          },
          homeTeam: {
            id: detail.match.homeTeam?.id ?? '',
            name: detail.match.homeTeam?.name ?? 'Home team',
            registrationId: detail.match.homeRegistration?.id ?? '',
          },
          awayTeam: {
            id: detail.match.awayTeam?.id ?? '',
            name: detail.match.awayTeam?.name ?? 'Away team',
            registrationId: detail.match.awayRegistration?.id ?? '',
          },
        },
        competitionId,
      );

      const events = detail.events
        .map((event) => toEvent(event, registrationTeam, registrationPlayer))
        .filter((event): event is MatchEvent => event !== null);

      const lineups = detail.lineups.map((lineup) =>
        toLineup(
          lineup,
          registrationTeam.get(lineup.teamRegistrationId) ?? '',
          registrationTeam,
          registrationPlayer,
        ),
      );

      return {
        match,
        events,
        lineups,
      } satisfies MatchDetail;
    },
  },

  announcements: {
    async list({ competitionId }) {
      return (await announcementsApi.list({ competitionId, limit: 200 })).map(toAnnouncement);
    },
    async get(id) {
      const list = (await announcementsApi.list({ limit: 200 })).map(toAnnouncement);
      return list.find((announcement) => announcement.id === id) ?? null;
    },
  },

  search: {
    async search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];

      const [competitions, teams, players, fixtures, announcements] = await Promise.all([
        competitionsApi.list().catch(() => [] as CompetitionDto[]),
        teamsApi.list().catch(() => [] as TeamDto[]),
        statisticsApi.players({ limit: 500 }).catch(() => [] as PlayerStatisticsRowDto[]),
        fixturesApi.list().catch(() => [] as FixtureDto[]),
        announcementsApi.list({ limit: 200 }).catch(() => [] as AnnouncementDto[]),
      ]);

      const out: SearchResult[] = [];
      for (const competition of competitions) {
        if (competition.name.toLowerCase().includes(q)) {
          out.push({
            kind: 'competition',
            id: competition.id,
            title: competition.name,
            subtitle: 'Competition',
            href: `/competitions/${competition.slug}`,
          });
        }
      }
      for (const team of teams) {
        if (team.name.toLowerCase().includes(q)) {
          out.push({ kind: 'team', id: team.id, title: team.name, subtitle: 'Team', href: `/teams/${team.id}` });
        }
      }
      const playerSeen = new Set<string>();
      for (const row of players) {
        if (playerSeen.has(row.playerId)) continue;
        if (row.playerName.toLowerCase().includes(q)) {
          playerSeen.add(row.playerId);
          out.push({
            kind: 'player',
            id: row.playerId,
            title: row.playerName,
            subtitle: row.teamName,
            href: `/players/${row.playerId}`,
          });
        }
      }
      for (const fixture of fixtures) {
        if (!fixture.match) continue;
        const title = `${fixture.homeTeam.name} v ${fixture.awayTeam.name}`;
        if (title.toLowerCase().includes(q)) {
          out.push({
            kind: 'match',
            id: fixture.match.id,
            title,
            subtitle: 'Match',
            href: `/matches/${fixture.match.id}`,
          });
        }
      }
      for (const announcement of announcements) {
        if (announcement.title.toLowerCase().includes(q)) {
          out.push({
            kind: 'article',
            id: announcement.id,
            title: announcement.title,
            subtitle: 'News',
            href: `/news/${announcement.id}`,
          });
        }
      }
      return out.slice(0, 20);
    },
  },
};
