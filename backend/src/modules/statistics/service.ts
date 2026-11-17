import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  lineups,
  lineupPlayers,
  matchEvents,
  matches,
  playerRegistrations,
  players,
  seasons,
  teamRegistrations,
  teams,
} from '../../database/schema/index.js';
import { notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { canReadMatch, loadMatchScope } from '../../security/access.js';
import {
  loadEligibleMatches,
  resolveStatisticsScopes,
  type EligibleMatch,
} from './eligibility.js';
import type {
  PlayerRankingsQuery,
  StatisticsFilter,
  TeamStatisticsQuery,
} from './schemas.js';

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export interface PlayerStatisticsRow {
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

export interface TeamStatisticsRow {
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

interface RegistrationMeta {
  playerRegistrationId: string;
  playerId: string;
  playerName: string;
  teamRegistrationId: string;
  teamId: string;
  teamName: string;
  seasonId: string;
  shirtNumber: number | null;
}

function emptyPlayerRow(meta: RegistrationMeta): PlayerStatisticsRow {
  return {
    playerRegistrationId: meta.playerRegistrationId,
    playerId: meta.playerId,
    playerName: meta.playerName,
    teamRegistrationId: meta.teamRegistrationId,
    teamId: meta.teamId,
    teamName: meta.teamName,
    seasonId: meta.seasonId,
    shirtNumber: meta.shirtNumber,
    appearances: 0,
    starts: 0,
    substituteAppearances: 0,
    goals: 0,
    penaltyGoals: 0,
    ownGoals: 0,
    yellowCards: 0,
    redCards: 0,
    substitutionsMade: 0,
    substitutionsReceived: 0,
    cleanSheets: 0,
  };
}

function emptyTeamRow(meta: Omit<RegistrationMeta, 'playerRegistrationId' | 'playerId' | 'playerName' | 'shirtNumber'>): TeamStatisticsRow {
  return {
    teamRegistrationId: meta.teamRegistrationId,
    teamId: meta.teamId,
    teamName: meta.teamName,
    seasonId: meta.seasonId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    cleanSheets: 0,
    yellowCards: 0,
    redCards: 0,
  };
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

async function loadRegistrationMetadata(
  executor: Executor,
  registrationIds: string[],
): Promise<Map<string, RegistrationMeta>> {
  if (registrationIds.length === 0) return new Map();
  const rows = await executor
    .select({
      playerRegistrationId: playerRegistrations.id,
      playerId: players.id,
      playerName: players.fullName,
      teamRegistrationId: playerRegistrations.teamRegistrationId,
      teamId: teamRegistrations.teamId,
      teamName: teams.name,
      seasonId: playerRegistrations.seasonId,
      shirtNumber: playerRegistrations.shirtNumber,
    })
    .from(playerRegistrations)
    .innerJoin(players, eq(playerRegistrations.playerId, players.id))
    .innerJoin(
      teamRegistrations,
      eq(playerRegistrations.teamRegistrationId, teamRegistrations.id),
    )
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .where(inArray(playerRegistrations.id, registrationIds));
  return new Map(rows.map((row) => [row.playerRegistrationId, row]));
}

async function loadTeamMetadata(
  executor: Executor,
  registrationIds: string[],
): Promise<Map<string, Omit<RegistrationMeta, 'playerRegistrationId' | 'playerId' | 'playerName' | 'shirtNumber'>>> {
  if (registrationIds.length === 0) return new Map();
  const rows = await executor
    .select({
      teamRegistrationId: teamRegistrations.id,
      teamId: teamRegistrations.teamId,
      teamName: teams.name,
      seasonId: teamRegistrations.seasonId,
    })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .where(inArray(teamRegistrations.id, registrationIds));
  return new Map(rows.map((row) => [row.teamRegistrationId, row]));
}

const matchKey = (matchId: string, registrationId: string) =>
  `${matchId}:${registrationId}`;

export async function aggregatePlayerStatistics(
  executor: Executor,
  eligible: EligibleMatch[],
  restrictRegistrationIds?: string[],
): Promise<PlayerStatisticsRow[]> {
  if (eligible.length === 0) return [];
  const matchIds = eligible.map((match) => match.id);
  const matchById = new Map(eligible.map((match) => [match.id, match]));
  const restrict = restrictRegistrationIds && restrictRegistrationIds.length > 0
    ? new Set(restrictRegistrationIds)
    : null;

  const lineupRows = await executor
    .select({
      matchId: lineups.matchId,
      teamRegistrationId: lineups.teamRegistrationId,
      playerRegistrationId: lineupPlayers.playerRegistrationId,
      role: lineupPlayers.role,
      position: lineupPlayers.position,
    })
    .from(lineups)
    .innerJoin(lineupPlayers, eq(lineupPlayers.lineupId, lineups.id))
    .where(
      and(
        inArray(lineups.matchId, matchIds),
        eq(lineups.status, 'confirmed'),
      ),
    );

  const eventRows = await executor
    .select({
      matchId: matchEvents.matchId,
      eventType: matchEvents.eventType,
      teamRegistrationId: matchEvents.teamRegistrationId,
      playerRegistrationId: matchEvents.playerRegistrationId,
      secondaryPlayerRegistrationId: matchEvents.secondaryPlayerRegistrationId,
    })
    .from(matchEvents)
    .where(
      and(
        inArray(matchEvents.matchId, matchIds),
        isNull(matchEvents.voidedAt),
      ),
    );

  const registrationIds = new Set<string>();
  for (const row of lineupRows) registrationIds.add(row.playerRegistrationId);
  for (const row of eventRows) {
    if (row.playerRegistrationId) registrationIds.add(row.playerRegistrationId);
    if (row.secondaryPlayerRegistrationId) {
      registrationIds.add(row.secondaryPlayerRegistrationId);
    }
  }
  const metadata = await loadRegistrationMetadata(executor, [...registrationIds]);
  const rows = new Map<string, PlayerStatisticsRow>();
  const roleByMatch = new Map<string, string>();

  const ensure = (registrationId: string): PlayerStatisticsRow | null => {
    if (restrict && !restrict.has(registrationId)) return null;
    const existing = rows.get(registrationId);
    if (existing) return existing;
    const meta = metadata.get(registrationId);
    if (!meta) return null;
    const created = emptyPlayerRow(meta);
    rows.set(registrationId, created);
    return created;
  };

  for (const row of lineupRows) {
    roleByMatch.set(matchKey(row.matchId, row.playerRegistrationId), row.role);
    if (row.role !== 'starter') continue;
    const aggregate = ensure(row.playerRegistrationId);
    if (!aggregate) continue;
    aggregate.appearances += 1;
    aggregate.starts += 1;
  }

  const substitutedOut = new Set<string>();
  const subbedIn = new Set<string>();
  for (const event of eventRows) {
    if (event.eventType === 'substitution') {
      if (event.playerRegistrationId) {
        substitutedOut.add(matchKey(event.matchId, event.playerRegistrationId));
        const aggregate = ensure(event.playerRegistrationId);
        if (aggregate) aggregate.substitutionsMade += 1;
      }
      if (event.secondaryPlayerRegistrationId) {
        const key = matchKey(event.matchId, event.secondaryPlayerRegistrationId);
        const aggregate = ensure(event.secondaryPlayerRegistrationId);
        if (aggregate) {
          aggregate.substitutionsReceived += 1;
          const role = roleByMatch.get(key);
          if (role === 'substitute' && !subbedIn.has(key)) {
            subbedIn.add(key);
            aggregate.appearances += 1;
            aggregate.substituteAppearances += 1;
          }
        }
      }
      continue;
    }
    if (!event.playerRegistrationId) continue;
    const aggregate = ensure(event.playerRegistrationId);
    if (!aggregate) continue;
    switch (event.eventType) {
      case 'goal':
        aggregate.goals += 1;
        break;
      case 'penalty-scored':
        aggregate.goals += 1;
        aggregate.penaltyGoals += 1;
        break;
      case 'own-goal':
        // Own goals are never credited as a normal goal for the scorer.
        aggregate.ownGoals += 1;
        break;
      case 'yellow-card':
        aggregate.yellowCards += 1;
        break;
      case 'second-yellow':
      case 'red-card':
        aggregate.redCards += 1;
        break;
      default:
        break;
    }
  }

  for (const row of lineupRows) {
    if (row.role !== 'starter' || row.position !== 'GK') continue;
    const match = matchById.get(row.matchId);
    if (!match) continue;
    const goalsAgainst =
      row.teamRegistrationId === match.homeTeamRegistrationId
        ? match.awayScore
        : match.homeScore;
    const wasSubstituted = substitutedOut.has(
      matchKey(row.matchId, row.playerRegistrationId),
    );
    if (goalsAgainst === 0 && !wasSubstituted) {
      const aggregate = ensure(row.playerRegistrationId);
      if (aggregate) aggregate.cleanSheets += 1;
    }
  }

  return [...rows.values()].sort(
    (left, right) =>
      compareText(left.playerName.toLowerCase(), right.playerName.toLowerCase()) ||
      compareText(left.teamName.toLowerCase(), right.teamName.toLowerCase()) ||
      compareText(left.seasonId, right.seasonId) ||
      compareText(left.playerRegistrationId, right.playerRegistrationId),
  );
}

export async function aggregateTeamStatistics(
  executor: Executor,
  eligible: EligibleMatch[],
  restrictRegistrationIds?: string[],
): Promise<TeamStatisticsRow[]> {
  if (eligible.length === 0) return [];
  const matchIds = eligible.map((match) => match.id);
  const restrict = restrictRegistrationIds && restrictRegistrationIds.length > 0
    ? new Set(restrictRegistrationIds)
    : null;

  const registrationIds = new Set<string>();
  for (const match of eligible) {
    registrationIds.add(match.homeTeamRegistrationId);
    registrationIds.add(match.awayTeamRegistrationId);
  }
  const teamMetadata = await loadTeamMetadata(executor, [...registrationIds]);
  const rows = new Map<string, TeamStatisticsRow>();
  const ensure = (registrationId: string): TeamStatisticsRow | null => {
    if (restrict && !restrict.has(registrationId)) return null;
    const existing = rows.get(registrationId);
    if (existing) return existing;
    const meta = teamMetadata.get(registrationId);
    if (!meta) return null;
    const created = emptyTeamRow(meta);
    rows.set(registrationId, created);
    return created;
  };

  for (const match of eligible) {
    for (const side of ['home', 'away'] as const) {
      const registrationId =
        side === 'home'
          ? match.homeTeamRegistrationId
          : match.awayTeamRegistrationId;
      const aggregate = ensure(registrationId);
      if (!aggregate) continue;
      const goalsFor = side === 'home' ? match.homeScore : match.awayScore;
      const goalsAgainst = side === 'home' ? match.awayScore : match.homeScore;
      aggregate.played += 1;
      aggregate.goalsFor += goalsFor;
      aggregate.goalsAgainst += goalsAgainst;
      aggregate.goalDifference = aggregate.goalsFor - aggregate.goalsAgainst;
      if (goalsAgainst === 0) aggregate.cleanSheets += 1;
      if (goalsFor > goalsAgainst) aggregate.won += 1;
      else if (goalsFor === goalsAgainst) aggregate.drawn += 1;
      else aggregate.lost += 1;
    }
  }

  const eventRows = await executor
    .select({
      teamRegistrationId: matchEvents.teamRegistrationId,
      eventType: matchEvents.eventType,
    })
    .from(matchEvents)
    .where(
      and(
        inArray(matchEvents.matchId, matchIds),
        isNull(matchEvents.voidedAt),
        inArray(matchEvents.eventType, ['yellow-card', 'second-yellow', 'red-card']),
      ),
    );
  for (const event of eventRows) {
    if (!event.teamRegistrationId) continue;
    const aggregate = ensure(event.teamRegistrationId);
    if (!aggregate) continue;
    if (event.eventType === 'yellow-card') aggregate.yellowCards += 1;
    else aggregate.redCards += 1;
  }

  return [...rows.values()].sort(
    (left, right) =>
      compareText(left.teamName.toLowerCase(), right.teamName.toLowerCase()) ||
      compareText(left.seasonId, right.seasonId) ||
      compareText(left.teamRegistrationId, right.teamRegistrationId),
  );
}

export async function getPlayerStatistics(
  auth: AuthContext | null,
  filter: StatisticsFilter,
): Promise<PlayerStatisticsRow[]> {
  const scopes = await resolveStatisticsScopes(auth, filter);
  const eligible = await loadEligibleMatches(db, filter, scopes);
  const restrict =
    filter.playerId || filter.playerRegistrationId
      ? eligible.playerRegistrations
      : undefined;
  const rows = await aggregatePlayerStatistics(db, eligible.matches, restrict);
  return rows.slice(filter.offset, filter.offset + filter.limit);
}

function sumPlayerRows(rows: PlayerStatisticsRow[]): Omit<PlayerStatisticsRow, 'playerRegistrationId' | 'playerId' | 'playerName' | 'teamRegistrationId' | 'teamId' | 'teamName' | 'seasonId' | 'shirtNumber'> {
  const totals = {
    appearances: 0,
    starts: 0,
    substituteAppearances: 0,
    goals: 0,
    penaltyGoals: 0,
    ownGoals: 0,
    yellowCards: 0,
    redCards: 0,
    substitutionsMade: 0,
    substitutionsReceived: 0,
    cleanSheets: 0,
  };
  for (const row of rows) {
    totals.appearances += row.appearances;
    totals.starts += row.starts;
    totals.substituteAppearances += row.substituteAppearances;
    totals.goals += row.goals;
    totals.penaltyGoals += row.penaltyGoals;
    totals.ownGoals += row.ownGoals;
    totals.yellowCards += row.yellowCards;
    totals.redCards += row.redCards;
    totals.substitutionsMade += row.substitutionsMade;
    totals.substitutionsReceived += row.substitutionsReceived;
    totals.cleanSheets += row.cleanSheets;
  }
  return totals;
}

export async function getPlayerStatisticsDetail(
  auth: AuthContext | null,
  playerId: string,
  filter: StatisticsFilter,
) {
  const [player] = await db
    .select({ id: players.id, fullName: players.fullName })
    .from(players)
    .where(eq(players.id, playerId));
  if (!player) throw notFound('Player not found.');

  const scopes = await resolveStatisticsScopes(auth, filter);
  const eligible = await loadEligibleMatches(db, filter, scopes);
  const rows = await aggregatePlayerStatistics(
    db,
    eligible.matches,
    eligible.playerRegistrations,
  );

  const bySeasonMap = new Map<string, ReturnType<typeof sumPlayerRows>>();
  for (const row of rows) {
    const existing = bySeasonMap.get(row.seasonId) ?? sumPlayerRows([]);
    const totals = sumPlayerRows([row]);
    bySeasonMap.set(row.seasonId, {
      appearances: existing.appearances + totals.appearances,
      starts: existing.starts + totals.starts,
      substituteAppearances:
        existing.substituteAppearances + totals.substituteAppearances,
      goals: existing.goals + totals.goals,
      penaltyGoals: existing.penaltyGoals + totals.penaltyGoals,
      ownGoals: existing.ownGoals + totals.ownGoals,
      yellowCards: existing.yellowCards + totals.yellowCards,
      redCards: existing.redCards + totals.redCards,
      substitutionsMade: existing.substitutionsMade + totals.substitutionsMade,
      substitutionsReceived:
        existing.substitutionsReceived + totals.substitutionsReceived,
      cleanSheets: existing.cleanSheets + totals.cleanSheets,
    });
  }

  return {
    player: { id: player.id, fullName: player.fullName },
    totals: sumPlayerRows(rows),
    bySeason: [...bySeasonMap.entries()]
      .map(([seasonId, totals]) => ({ seasonId, ...totals }))
      .sort((left, right) => compareText(left.seasonId, right.seasonId)),
    rows,
  };
}

export async function getTeamStatistics(
  auth: AuthContext | null,
  filter: TeamStatisticsQuery,
): Promise<TeamStatisticsRow[]> {
  const scopes = await resolveStatisticsScopes(auth, filter);
  const eligible = await loadEligibleMatches(
    db,
    { ...filter, limit: 500, offset: 0 },
    scopes,
  );
  const restrict =
    filter.teamId || filter.teamRegistrationId
      ? eligible.teamRegistrations
      : undefined;
  const rows = await aggregateTeamStatistics(db, eligible.matches, restrict);
  return rows.slice(filter.offset, filter.offset + filter.limit);
}

export async function getPlayerRankings(
  auth: AuthContext | null,
  query: PlayerRankingsQuery,
) {
  const scopes = await resolveStatisticsScopes(auth, query);
  const eligible = await loadEligibleMatches(
    db,
    { ...query, limit: 500, offset: 0 },
    scopes,
  );
  const rows = await aggregatePlayerStatistics(db, eligible.matches);
  const byPlayer = new Map<string, PlayerStatisticsRow>();
  for (const row of rows) {
    const existing = byPlayer.get(row.playerId);
    if (!existing) {
      byPlayer.set(row.playerId, { ...row });
      continue;
    }
    existing.appearances += row.appearances;
    existing.starts += row.starts;
    existing.substituteAppearances += row.substituteAppearances;
    existing.goals += row.goals;
    existing.penaltyGoals += row.penaltyGoals;
    existing.ownGoals += row.ownGoals;
    existing.yellowCards += row.yellowCards;
    existing.redCards += row.redCards;
    existing.substitutionsMade += row.substitutionsMade;
    existing.substitutionsReceived += row.substitutionsReceived;
    existing.cleanSheets += row.cleanSheets;
  }
  const metric = query.metric;
  const metricValue = (row: PlayerStatisticsRow): number => {
    switch (metric) {
      case 'appearances':
        return row.appearances;
      case 'yellow_cards':
        return row.yellowCards;
      case 'red_cards':
        return row.redCards;
      case 'clean_sheets':
        return row.cleanSheets;
      case 'goals':
      default:
        return row.goals;
    }
  };
  const ranked = [...byPlayer.values()]
    .sort(
      (left, right) =>
        metricValue(right) - metricValue(left) ||
        compareText(left.playerName.toLowerCase(), right.playerName.toLowerCase()) ||
        compareText(left.playerId, right.playerId),
    )
    .slice(query.offset, query.offset + query.limit)
    .map((row, index) => ({
      position: query.offset + index + 1,
      playerId: row.playerId,
      playerName: row.playerName,
      metric,
      value: metricValue(row),
      appearances: row.appearances,
      goals: row.goals,
      yellowCards: row.yellowCards,
      redCards: row.redCards,
      cleanSheets: row.cleanSheets,
    }));
  return { metric, rows: ranked, limit: query.limit, offset: query.offset };
}

export async function getMatchStatistics(auth: AuthContext | null, matchId: string) {
  const scope = await loadMatchScope(matchId);
  if (!scope || !(await canReadMatch(auth, scope))) {
    throw notFound('Match not found.');
  }
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) throw notFound('Match not found.');

  const [homeTeam] = await db
    .select({ name: teams.name, registrationId: teamRegistrations.id, teamId: teams.id })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teams.id, teamRegistrations.teamId))
    .where(eq(teamRegistrations.id, scope.homeTeamRegistrationId));
  const [awayTeam] = await db
    .select({ name: teams.name, registrationId: teamRegistrations.id, teamId: teams.id })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teams.id, teamRegistrations.teamId))
    .where(eq(teamRegistrations.id, scope.awayTeamRegistrationId));

  const confirmed = match.status === 'full_time' && match.resultConfirmedAt !== null;
  const base = {
    match: {
      id: match.id,
      status: match.status,
      resultConfirmedAt: match.resultConfirmedAt,
      startedAt: match.startedAt,
      endedAt: match.endedAt,
    },
    fixture: {
      id: scope.fixtureId,
      seasonId: scope.seasonId,
      groupId: null,
    },
    homeTeam: homeTeam ?? null,
    awayTeam: awayTeam ?? null,
  };
  if (!confirmed) {
    return {
      ...base,
      confirmed: false,
      score: null,
      teamStatistics: [],
      playerStatistics: [],
    };
  }

  const scopes = await resolveStatisticsScopes(auth, { matchId });
  const eligible = await loadEligibleMatches(db, { matchId, limit: 500, offset: 0 }, scopes);
  const teamStatistics = await aggregateTeamStatistics(db, eligible.matches);
  const playerStatistics = await aggregatePlayerStatistics(db, eligible.matches);
  return {
    ...base,
    confirmed: true,
    score: { homeScore: match.homeScore, awayScore: match.awayScore },
    teamStatistics,
    playerStatistics,
  };
}
