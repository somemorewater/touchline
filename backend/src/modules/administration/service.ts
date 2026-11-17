import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  competitions,
  fixtures,
  lineups,
  matches,
  playerRegistrations,
  seasons,
  standingsSnapshots,
  teamRegistrations,
} from '../../database/schema/index.js';
import { forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { isSuperAdmin } from '../../security/context.js';
import { canManageCompetition } from '../../security/access.js';
import { PERMISSIONS } from '../../security/permissions.js';

function toCountMap(rows: Array<{ status: string; count: number }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

export async function competitionOverview(
  auth: AuthContext,
  competitionId: string,
  seasonId?: string,
) {
  const [competition] = await db
    .select({
      id: competitions.id,
      slug: competitions.slug,
      name: competitions.name,
      status: competitions.status,
      visibility: competitions.visibility,
    })
    .from(competitions)
    .where(eq(competitions.id, competitionId));
  if (!competition) throw notFound('Competition not found.');
  if (
    !isSuperAdmin(auth) &&
    !canManageCompetition(auth, PERMISSIONS.competitionsRead, competitionId)
  ) {
    throw notFound('Competition not found.');
  }
  if (seasonId) {
    const [season] = await db
      .select({ competitionId: seasons.competitionId })
      .from(seasons)
      .where(eq(seasons.id, seasonId));
    if (!season) throw notFound('Season not found.');
    if (season.competitionId !== competitionId) {
      throw forbidden('The season does not belong to the competition.');
    }
  }

  const seasonFilter = seasonId
    ? [eq(seasons.id, seasonId)]
    : [eq(seasons.competitionId, competitionId)];

  const [
    teamRows,
    playerRows,
    fixtureRows,
    matchRows,
    lineupRows,
    currentSnapshots,
    pendingRegistrations,
    fullTimeUnconfirmed,
    overdueScheduled,
    matchesWithoutLineups,
  ] = await Promise.all([
    db
      .select({ status: teamRegistrations.status, count: sql<number>`count(*)::int` })
      .from(teamRegistrations)
      .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
      .where(and(...seasonFilter))
      .groupBy(teamRegistrations.status),
    db
      .select({ status: playerRegistrations.status, count: sql<number>`count(*)::int` })
      .from(playerRegistrations)
      .innerJoin(seasons, eq(playerRegistrations.seasonId, seasons.id))
      .where(and(...seasonFilter))
      .groupBy(playerRegistrations.status),
    db
      .select({ status: fixtures.status, count: sql<number>`count(*)::int` })
      .from(fixtures)
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .where(and(...seasonFilter))
      .groupBy(fixtures.status),
    db
      .select({ status: matches.status, count: sql<number>`count(*)::int` })
      .from(matches)
      .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .where(and(...seasonFilter))
      .groupBy(matches.status),
    db
      .select({ status: lineups.status, count: sql<number>`count(*)::int` })
      .from(lineups)
      .innerJoin(matches, eq(lineups.matchId, matches.id))
      .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .where(and(...seasonFilter))
      .groupBy(lineups.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(standingsSnapshots)
      .innerJoin(seasons, eq(standingsSnapshots.seasonId, seasons.id))
      .where(and(...seasonFilter, eq(standingsSnapshots.isCurrent, true))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(playerRegistrations)
      .innerJoin(seasons, eq(playerRegistrations.seasonId, seasons.id))
      .where(
        and(
          ...seasonFilter,
          inArray(playerRegistrations.status, ['submitted', 'under_review']),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(matches)
      .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .where(
        and(
          ...seasonFilter,
          eq(matches.status, 'full_time'),
          isNull(matches.resultConfirmedAt),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(matches)
      .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .where(
        and(
          ...seasonFilter,
          inArray(fixtures.status, ['scheduled', 'postponed']),
          isNotNull(fixtures.scheduledAt),
          lt(fixtures.scheduledAt, new Date()),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(matches)
      .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .leftJoin(lineups, eq(lineups.matchId, matches.id))
      .where(and(...seasonFilter, inArray(fixtures.status, ['scheduled', 'postponed'])))
      .groupBy(matches.id)
      .having(sql`count(${lineups.id}) = 0`),
  ]);

  const teams = toCountMap(teamRows);
  const players = toCountMap(playerRows);
  const fixturesByStatus = toCountMap(fixtureRows);
  const matchesByStatus = toCountMap(matchRows);
  const lineupsByStatus = toCountMap(lineupRows);

  const warnings: string[] = [];
  if ((teams.approved ?? 0) < 2) warnings.push('Fewer than two approved team entries.');
  if ((pendingRegistrations[0]?.count ?? 0) > 0) {
    warnings.push(`${pendingRegistrations[0]?.count} player registration(s) await review.`);
  }
  if ((fullTimeUnconfirmed[0]?.count ?? 0) > 0) {
    warnings.push(`${fullTimeUnconfirmed[0]?.count} full-time result(s) are unconfirmed.`);
  }
  if ((overdueScheduled[0]?.count ?? 0) > 0) {
    warnings.push(`${overdueScheduled[0]?.count} scheduled fixture(s) are past kickoff.`);
  }
  if (matchesWithoutLineups.length > 0) {
    warnings.push(`${matchesWithoutLineups.length} upcoming match(es) have no lineup.`);
  }
  if ((currentSnapshots[0]?.count ?? 0) === 0) {
    warnings.push('No current standings snapshot is published.');
  }

  return {
    competition,
    seasonId: seasonId ?? null,
    teams,
    playerRegistrations: players,
    fixtures: fixturesByStatus,
    matches: matchesByStatus,
    lineups: lineupsByStatus,
    standings: { currentSnapshots: currentSnapshots[0]?.count ?? 0 },
    operational: {
      pendingRegistrations: pendingRegistrations[0]?.count ?? 0,
      fullTimeUnconfirmed: fullTimeUnconfirmed[0]?.count ?? 0,
      overdueScheduledFixtures: overdueScheduled[0]?.count ?? 0,
      upcomingMatchesWithoutLineups: matchesWithoutLineups.length,
    },
    warnings,
  };
}
