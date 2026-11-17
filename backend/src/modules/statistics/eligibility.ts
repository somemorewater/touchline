import { and, eq, gte, inArray, isNotNull, lt, or, type SQL } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  competitions,
  fixtures,
  matches,
  playerRegistrations,
  seasons,
  teamRegistrations,
} from '../../database/schema/index.js';
import { badRequest, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import {
  canManageCompetitionLineups,
  canReadMatch,
  isPublicCompetition,
  loadMatchScope,
} from '../../security/access.js';
import type { StatisticsFilter } from './schemas.js';

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export interface StatisticsScope {
  competitionId: string;
  /** Private/management access also sees unpublished fixtures. */
  includeUnpublished: boolean;
}

export interface EligibleMatch {
  id: string;
  seasonId: string;
  groupId: string | null;
  competitionId: string;
  homeTeamRegistrationId: string;
  awayTeamRegistrationId: string;
  homeScore: number;
  awayScore: number;
  scheduledAt: Date | null;
  endedAt: Date | null;
  resultConfirmedAt: Date | null;
}

async function isCaptainInCompetition(
  auth: AuthContext,
  competitionId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: teamRegistrations.id })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(
      and(
        eq(teamRegistrations.captainUserId, auth.userId),
        eq(seasons.competitionId, competitionId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Authoritative statistics only include full-time matches with a confirmed
 * result on a completed fixture. Public callers additionally require the
 * fixture to be published; managers and captains see their private scope.
 */
export async function resolveStatisticsScopes(
  auth: AuthContext | null,
  filter: Pick<StatisticsFilter, 'competitionId' | 'seasonId' | 'matchId'>,
): Promise<StatisticsScope[]> {
  let explicit = false;
  let competitionIds: string[] | null = null;
  let matchScope: Awaited<ReturnType<typeof loadMatchScope>> = null;

  if (filter.competitionId) {
    explicit = true;
    competitionIds = [filter.competitionId];
  }
  if (filter.seasonId) {
    explicit = true;
    const [season] = await db
      .select({ competitionId: seasons.competitionId })
      .from(seasons)
      .where(eq(seasons.id, filter.seasonId));
    if (!season) throw notFound('Season not found.');
    if (filter.competitionId && season.competitionId !== filter.competitionId) {
      throw badRequest('The season does not belong to the requested competition.');
    }
    competitionIds = [season.competitionId];
  }
  if (filter.matchId) {
    explicit = true;
    matchScope = await loadMatchScope(filter.matchId);
    if (!matchScope) throw notFound('Match not found.');
    if (filter.seasonId && matchScope.seasonId !== filter.seasonId) {
      throw badRequest('The match does not belong to the requested season.');
    }
    if (filter.competitionId && matchScope.competitionId !== filter.competitionId) {
      throw badRequest('The match does not belong to the requested competition.');
    }
    competitionIds = [matchScope.competitionId];
  }

  const candidates = competitionIds
    ? await db
        .select({
          id: competitions.id,
          status: competitions.status,
          visibility: competitions.visibility,
        })
        .from(competitions)
        .where(inArray(competitions.id, competitionIds))
    : await db
        .select({
          id: competitions.id,
          status: competitions.status,
          visibility: competitions.visibility,
        })
        .from(competitions);

  if (explicit && candidates.length === 0) throw notFound('Competition not found.');

  const scopes: StatisticsScope[] = [];
  for (const candidate of candidates) {
    if (isPublicCompetition(candidate)) {
      if (
        matchScope &&
        matchScope.competitionId === candidate.id &&
        !matchScope.fixturePublishedAt
      ) {
        continue;
      }
      scopes.push({ competitionId: candidate.id, includeUnpublished: false });
      continue;
    }
    if (!auth) continue;
    if (canManageCompetitionLineups(auth, candidate.id)) {
      scopes.push({ competitionId: candidate.id, includeUnpublished: true });
      continue;
    }
    if (matchScope && matchScope.competitionId === candidate.id) {
      if (await canReadMatch(auth, matchScope)) {
        scopes.push({ competitionId: candidate.id, includeUnpublished: true });
        continue;
      }
    }
    if (await isCaptainInCompetition(auth, candidate.id)) {
      scopes.push({ competitionId: candidate.id, includeUnpublished: true });
    }
  }

  if (explicit && scopes.length === 0) throw notFound('Competition not found.');
  return scopes;
}

async function resolveTeamRegistrations(
  filter: StatisticsFilter,
  scopes: StatisticsScope[],
): Promise<string[]> {
  if (filter.teamRegistrationId) return [filter.teamRegistrationId];
  if (!filter.teamId) return [];
  const scopeIds = scopes.map((scope) => scope.competitionId);
  if (scopeIds.length === 0) return [];
  const rows = await db
    .select({ id: teamRegistrations.id })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(
      and(
        eq(teamRegistrations.teamId, filter.teamId),
        inArray(seasons.competitionId, scopeIds),
        ...(filter.seasonId ? [eq(teamRegistrations.seasonId, filter.seasonId)] : []),
      ),
    );
  return rows.map((row) => row.id);
}

async function resolvePlayerRegistrations(
  filter: StatisticsFilter,
  scopes: StatisticsScope[],
): Promise<string[]> {
  if (filter.playerRegistrationId) return [filter.playerRegistrationId];
  if (!filter.playerId) return [];
  const scopeIds = scopes.map((scope) => scope.competitionId);
  if (scopeIds.length === 0) return [];
  const rows = await db
    .select({ id: playerRegistrations.id })
    .from(playerRegistrations)
    .innerJoin(seasons, eq(playerRegistrations.seasonId, seasons.id))
    .where(
      and(
        eq(playerRegistrations.playerId, filter.playerId),
        inArray(seasons.competitionId, scopeIds),
        ...(filter.seasonId ? [eq(playerRegistrations.seasonId, filter.seasonId)] : []),
      ),
    );
  return rows.map((row) => row.id);
}

export async function loadEligibleMatches(
  executor: Executor,
  filter: StatisticsFilter,
  scopes: StatisticsScope[],
): Promise<{
  matches: EligibleMatch[];
  playerRegistrations: string[];
  teamRegistrations: string[];
}> {
  if (scopes.length === 0) {
    return { matches: [], playerRegistrations: [], teamRegistrations: [] };
  }

  const scopeConditions = scopes.map((scope) => {
    const base = eq(seasons.competitionId, scope.competitionId);
    return scope.includeUnpublished ? base : and(base, isNotNull(fixtures.publishedAt));
  });

  const conditions: SQL[] = [
    eq(matches.status, 'full_time'),
    isNotNull(matches.resultConfirmedAt),
    eq(fixtures.status, 'completed'),
    or(...scopeConditions)!,
  ];
  if (filter.seasonId) conditions.push(eq(fixtures.seasonId, filter.seasonId));
  if (filter.groupId) conditions.push(eq(fixtures.groupId, filter.groupId));
  if (filter.matchId) conditions.push(eq(matches.id, filter.matchId));
  if (filter.from) {
    conditions.push(gte(fixtures.scheduledAt, new Date(`${filter.from}T00:00:00.000Z`)));
  }
  if (filter.to) {
    const end = new Date(`${filter.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(lt(fixtures.scheduledAt, end));
  }

  const teamRegistrationIds = [
    ...new Set(await resolveTeamRegistrations(filter, scopes)),
  ];
  const playerRegistrationIds = [
    ...new Set(await resolvePlayerRegistrations(filter, scopes)),
  ];
  if (
    (filter.teamId || filter.teamRegistrationId) &&
    teamRegistrationIds.length === 0
  ) {
    return { matches: [], playerRegistrations: [], teamRegistrations: [] };
  }
  if (
    (filter.playerId || filter.playerRegistrationId) &&
    playerRegistrationIds.length === 0
  ) {
    return { matches: [], playerRegistrations: [], teamRegistrations: [] };
  }
  if (teamRegistrationIds.length > 0) {
    conditions.push(
      or(
        inArray(fixtures.homeTeamRegistrationId, teamRegistrationIds),
        inArray(fixtures.awayTeamRegistrationId, teamRegistrationIds),
      )!,
    );
  }

  const rows = await executor
    .select({
      id: matches.id,
      seasonId: fixtures.seasonId,
      groupId: fixtures.groupId,
      competitionId: seasons.competitionId,
      homeTeamRegistrationId: fixtures.homeTeamRegistrationId,
      awayTeamRegistrationId: fixtures.awayTeamRegistrationId,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      scheduledAt: fixtures.scheduledAt,
      endedAt: matches.endedAt,
      resultConfirmedAt: matches.resultConfirmedAt,
    })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .where(and(...conditions))
    .orderBy(fixtures.scheduledAt, matches.id);

  return {
    matches: rows,
    playerRegistrations: playerRegistrationIds,
    teamRegistrations: teamRegistrationIds,
  };
}
