import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../database/client.js';
import {
  auditLogs,
  competitionGroups,
  competitions,
  fixtures,
  matches,
  matchEvents,
  matchOfficials,
  seasons,
  teamRegistrations,
  teams,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { insertPersonnelAssignment } from '../matches/personnel.js';
import {
  competitionScopesFor,
  hasPermission,
  hasPermissionInCompetition,
  isSuperAdmin,
} from '../../security/context.js';
import {
  canViewCompetition,
  getCompetitionVisibility,
  isPublicCompetition,
  isPublicFixture,
  isTeamCaptain,
  resolveCompetitionForSeason,
} from '../../security/access.js';
import { PERMISSIONS } from '../../security/permissions.js';
import type {
  fixtureCreateSchema,
  fixtureGenerationSchema,
  fixtureLifecycleSchema,
  fixtureListQuerySchema,
  fixtureRescheduleSchema,
  fixtureUpdateSchema,
} from './schemas.js';
import type { z } from 'zod';

type FixtureCreate = z.infer<typeof fixtureCreateSchema>;
type FixtureUpdate = z.infer<typeof fixtureUpdateSchema>;
type FixtureListQuery = z.infer<typeof fixtureListQuerySchema>;
type FixtureReschedule = z.infer<typeof fixtureRescheduleSchema>;
type FixtureLifecycle = z.infer<typeof fixtureLifecycleSchema>;
type FixtureGeneration = z.infer<typeof fixtureGenerationSchema>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const homeRegistrations = alias(teamRegistrations, 'home_registration');
const awayRegistrations = alias(teamRegistrations, 'away_registration');
const homeTeams = alias(teams, 'home_team');
const awayTeams = alias(teams, 'away_team');

interface FixtureScope {
  fixture: typeof fixtures.$inferSelect;
  season: typeof seasons.$inferSelect;
  competition: typeof competitions.$inferSelect;
}

interface FixtureEnriched {
  fixture: typeof fixtures.$inferSelect;
  homeRegistrationId: string;
  awayRegistrationId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  matchId: string | null;
  matchStatus: string | null;
  homeScore: number | null;
  awayScore: number | null;
  resultConfirmedAt: Date | null;
  durationMinutes: number | null;
  clockRunningAt: Date | null;
  clockAccumulatedSeconds: number | null;
  currentMinute: number | null;
  addedMinutes: number | null;
}

function canManageFixtures(auth: AuthContext | null, competitionId: string): boolean {
  if (!auth) return false;
  return (
    hasPermissionInCompetition(auth, PERMISSIONS.fixturesManage, competitionId) ||
    hasPermissionInCompetition(auth, PERMISSIONS.matchesManage, competitionId) ||
    hasPermissionInCompetition(auth, PERMISSIONS.competitionsUpdate, competitionId)
  );
}

async function isOfficialForFixture(userId: string, fixtureId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: matchOfficials.userId })
    .from(matchOfficials)
    .innerJoin(matches, eq(matchOfficials.matchId, matches.id))
    .where(and(eq(matches.fixtureId, fixtureId), eq(matchOfficials.userId, userId)))
    .limit(1);
  return Boolean(row);
}

async function loadFixtureScope(fixtureId: string): Promise<FixtureScope> {
  const [row] = await db
    .select({ fixture: fixtures, season: seasons, competition: competitions })
    .from(fixtures)
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(fixtures.id, fixtureId));
  if (!row) throw notFound('Fixture not found.');
  return row;
}

async function canReadFixture(auth: AuthContext | null, scope: FixtureScope): Promise<boolean> {
  if (
    isPublicFixture(scope.fixture) &&
    isPublicCompetition(scope.competition)
  ) {
    return true;
  }
  if (!auth) return false;
  if (canManageFixtures(auth, scope.competition.id)) return true;
  if (
    (await isTeamCaptain(auth.userId, scope.fixture.homeTeamRegistrationId)) ||
    (await isTeamCaptain(auth.userId, scope.fixture.awayTeamRegistrationId))
  ) {
    return true;
  }
  return isOfficialForFixture(auth.userId, scope.fixture.id);
}

async function assertCanManageFixture(auth: AuthContext, fixtureId: string): Promise<FixtureScope> {
  const scope = await loadFixtureScope(fixtureId);
  if (!canManageFixtures(auth, scope.competition.id)) {
    if (!(await canReadFixture(auth, scope))) throw notFound('Fixture not found.');
    throw forbidden();
  }
  return scope;
}

function assertCompetitionWritable(status: string): void {
  if (status === 'archived') throw conflict('Archived competitions are read-only.');
}

function assertSeasonAllowsFixtures(status: string): void {
  if (status !== 'planned' && status !== 'active') {
    throw conflict('Fixtures require a planned or active season.');
  }
}

async function loadSeasonForFixtureWrite(auth: AuthContext, seasonId: string) {
  const [row] = await db
    .select({ season: seasons, competition: competitions })
    .from(seasons)
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(seasons.id, seasonId));
  if (!row) throw notFound('Season not found.');
  if (!canManageFixtures(auth, row.competition.id)) {
    if (!canViewCompetition(auth, row.competition)) throw notFound('Season not found.');
    throw forbidden();
  }
  assertCompetitionWritable(row.competition.status);
  assertSeasonAllowsFixtures(row.season.status);
  return row;
}

async function assertGroupInSeason(
  executor: Transaction | typeof db,
  groupId: string,
  seasonId: string,
): Promise<void> {
  const [group] = await executor
    .select({
      id: competitionGroups.id,
      seasonId: competitionGroups.seasonId,
      archivedAt: competitionGroups.archivedAt,
    })
    .from(competitionGroups)
    .where(eq(competitionGroups.id, groupId));
  if (!group) throw badRequest('groupId does not identify a group.');
  if (group.seasonId !== seasonId) throw badRequest('groupId does not belong to this season.');
  if (group.archivedAt) throw conflict('Archived groups cannot receive fixtures.');
}

interface Participant {
  id: string;
  teamId: string;
  groupId: string | null;
  status: string;
  archivedAt: Date | null;
  teamName: string;
}

async function loadParticipants(
  executor: Transaction | typeof db,
  seasonId: string,
  homeId: string,
  awayId: string,
): Promise<[Participant, Participant]> {
  if (homeId === awayId) throw badRequest('A team cannot play itself.');
  const rows = await executor
    .select({
      id: teamRegistrations.id,
      teamId: teamRegistrations.teamId,
      groupId: teamRegistrations.groupId,
      status: teamRegistrations.status,
      seasonId: teamRegistrations.seasonId,
      archivedAt: teams.archivedAt,
      teamName: teams.name,
    })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .where(inArray(teamRegistrations.id, [homeId, awayId]));
  if (rows.length !== 2) {
    throw badRequest('Both participants must be existing team entries.');
  }
  for (const row of rows) {
    if (row.seasonId !== seasonId) {
      throw badRequest('Both participants must belong to the fixture season.');
    }
    if (row.status !== 'approved') {
      throw conflict('Both participants must have an approved team entry.');
    }
    if (row.archivedAt) throw conflict('Archived teams cannot participate in fixtures.');
  }
  const home = rows.find((row) => row.id === homeId);
  const away = rows.find((row) => row.id === awayId);
  if (!home || !away) throw badRequest('Both participants must be existing team entries.');
  return [home, away];
}

async function validateParticipantGroup(
  home: Participant,
  away: Participant,
  groupId: string | null,
): Promise<void> {
  if (groupId === null) return;
  if (home.groupId !== groupId || away.groupId !== groupId) {
    throw badRequest('Both participants must belong to the fixture group.');
  }
}

async function writeFixtureAudit(
  tx: Transaction,
  actorUserId: string,
  action: string,
  fixtureId: string,
  before: unknown,
  after: unknown,
  reason?: string | null,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId,
    action,
    entityType: 'fixture',
    entityId: fixtureId,
    before: before ?? null,
    after: after ?? null,
    reason: reason ?? null,
  });
}

async function enrichedFixture(fixtureId: string): Promise<FixtureEnriched> {
  const [row] = await db
    .select({
      fixture: fixtures,
      homeRegistrationId: homeRegistrations.id,
      awayRegistrationId: awayRegistrations.id,
      homeTeamId: homeTeams.id,
      awayTeamId: awayTeams.id,
      homeTeamName: homeTeams.name,
      awayTeamName: awayTeams.name,
      matchId: matches.id,
      matchStatus: matches.status,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      resultConfirmedAt: matches.resultConfirmedAt,
      durationMinutes: matches.durationMinutes,
      clockRunningAt: matches.clockRunningAt,
      clockAccumulatedSeconds: matches.clockAccumulatedSeconds,
      currentMinute: matches.currentMinute,
      addedMinutes: matches.addedMinutes,
    })
    .from(fixtures)
    .innerJoin(homeRegistrations, eq(fixtures.homeTeamRegistrationId, homeRegistrations.id))
    .innerJoin(awayRegistrations, eq(fixtures.awayTeamRegistrationId, awayRegistrations.id))
    .innerJoin(homeTeams, eq(homeRegistrations.teamId, homeTeams.id))
    .innerJoin(awayTeams, eq(awayRegistrations.teamId, awayTeams.id))
    .leftJoin(matches, eq(matches.fixtureId, fixtures.id))
    .where(eq(fixtures.id, fixtureId));
  if (!row) throw notFound('Fixture not found.');
  return row;
}

function shapeFixture(row: FixtureEnriched) {
  return {
    ...row.fixture,
    match: row.matchId
      ? {
          id: row.matchId,
          status: row.matchStatus,
          homeScore: row.homeScore,
          awayScore: row.awayScore,
          resultConfirmedAt: row.resultConfirmedAt,
          durationMinutes: row.durationMinutes ?? 90,
          clockRunningAt: row.clockRunningAt,
          clockAccumulatedSeconds: row.clockAccumulatedSeconds ?? 0,
          currentMinute: row.currentMinute,
          addedMinutes: row.addedMinutes,
        }
      : null,
    homeTeam: {
      id: row.homeTeamId,
      name: row.homeTeamName,
      registrationId: row.homeRegistrationId,
    },
    awayTeam: {
      id: row.awayTeamId,
      name: row.awayTeamName,
      registrationId: row.awayRegistrationId,
    },
  };
}

export async function createFixture(auth: AuthContext, input: FixtureCreate) {
  const { season, competition } = await loadSeasonForFixtureWrite(auth, input.seasonId);
  const groupId = input.groupId ?? null;
  if (groupId) await assertGroupInSeason(db, groupId, season.id);
  const [home, away] = await loadParticipants(
    db,
    season.id,
    input.homeTeamRegistrationId,
    input.awayTeamRegistrationId,
  );
  await validateParticipantGroup(home, away, groupId);

  return db.transaction(async (tx) => {
    const [fixture] = await tx
      .insert(fixtures)
      .values({
        seasonId: season.id,
        groupId,
        homeTeamRegistrationId: input.homeTeamRegistrationId,
        awayTeamRegistrationId: input.awayTeamRegistrationId,
        round: input.round ?? null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        venue: input.venue ?? null,
        status: 'draft',
        createdBy: auth.userId,
      })
      .returning();
    if (!fixture) throw new Error('Fixture insert did not return a row.');

    const [match] = await tx
      .insert(matches)
      .values({ fixtureId: fixture.id })
      .returning();
    if (!match) throw new Error('Match insert did not return a row.');

    // Any eligibility failure rolls back the fixture and match as well, so a
    // requested assignment can never be silently dropped.
    const official = input.officialUserId
      ? await insertPersonnelAssignment(tx, {
          matchId: match.id,
          userId: input.officialUserId,
          role: 'official',
          competitionId: competition.id,
          seasonId: season.id,
          actor: auth,
        })
      : null;
    const commentary = input.commentaryUserId
      ? await insertPersonnelAssignment(tx, {
          matchId: match.id,
          userId: input.commentaryUserId,
          role: 'commentary',
          competitionId: competition.id,
          seasonId: season.id,
          actor: auth,
        })
      : null;

    await writeFixtureAudit(tx, auth.userId, 'fixture.created', fixture.id, null, {
      fixture,
      matchId: match.id,
      officialUserId: input.officialUserId ?? null,
      commentaryUserId: input.commentaryUserId ?? null,
    });
    return {
      competitionId: competition.id,
      seasonId: season.id,
      fixture,
      match,
      official,
      commentary,
    };
  });
}

export async function listFixtures(auth: AuthContext | null, filters: FixtureListQuery) {
  const conditions: SQL[] = [];

  if (filters.competitionId) {
    const competition = await getCompetitionVisibility(filters.competitionId);
    if (
      !competition ||
      (!canViewCompetition(auth, competition) &&
        !canManageFixtures(auth, filters.competitionId))
    ) {
      throw notFound('Competition not found.');
    }
  }
  if (filters.seasonId) {
    const competitionId = await resolveCompetitionForSeason(filters.seasonId);
    const competition = competitionId
      ? await getCompetitionVisibility(competitionId)
      : null;
    if (
      !competition ||
      (!canViewCompetition(auth, competition) && !canManageFixtures(auth, competition.id))
    ) {
      throw notFound('Season not found.');
    }
  }

  if (filters.competitionId) {
    conditions.push(
      inArray(
        fixtures.seasonId,
        db
          .select({ id: seasons.id })
          .from(seasons)
          .where(eq(seasons.competitionId, filters.competitionId)),
      ),
    );
  }
  if (filters.seasonId) conditions.push(eq(fixtures.seasonId, filters.seasonId));
  if (filters.groupId) conditions.push(eq(fixtures.groupId, filters.groupId));
  if (filters.status) conditions.push(eq(fixtures.status, filters.status));
  if (filters.teamId) {
    conditions.push(
      or(
        eq(homeRegistrations.teamId, filters.teamId),
        eq(awayRegistrations.teamId, filters.teamId),
      )!,
    );
  }
  if (filters.teamRegistrationId) {
    conditions.push(
      or(
        eq(fixtures.homeTeamRegistrationId, filters.teamRegistrationId),
        eq(fixtures.awayTeamRegistrationId, filters.teamRegistrationId),
      )!,
    );
  }

  const globalManager = Boolean(
    auth &&
      (isSuperAdmin(auth) || hasPermission(auth, PERMISSIONS.fixturesManage)),
  );

  if (!globalManager) {
    const visibility: SQL[] = [
      and(
        sql`${fixtures.publishedAt} is not null`,
        lte(fixtures.publishedAt, new Date()),
        sql`exists (
          select 1 from ${seasons} s
          join ${competitions} c on c.id = s.competition_id
          where s.id = ${fixtures.seasonId}
            and c.visibility = 'public'
            and c.status in ('published','active','completed','archived')
        )`,
      )!,
    ];
    if (auth) {
      visibility.push(
        or(
          eq(homeRegistrations.captainUserId, auth.userId),
          eq(awayRegistrations.captainUserId, auth.userId),
        )!,
      );
      const scopes = [
        ...new Set([
          ...competitionScopesFor(auth, PERMISSIONS.fixturesManage),
          ...competitionScopesFor(auth, PERMISSIONS.matchesManage),
          ...competitionScopesFor(auth, PERMISSIONS.competitionsUpdate),
        ]),
      ];
      if (scopes.length > 0) {
        visibility.push(
          inArray(
            fixtures.seasonId,
            db
              .select({ id: seasons.id })
              .from(seasons)
              .where(inArray(seasons.competitionId, scopes)),
          ),
        );
      }
      visibility.push(
        exists(
          db
            .select({ matchId: matchOfficials.matchId })
            .from(matchOfficials)
            .innerJoin(matches, eq(matchOfficials.matchId, matches.id))
            .where(
              and(
                eq(matches.fixtureId, fixtures.id),
                eq(matchOfficials.userId, auth.userId),
              ),
            ),
        ),
      );
    }
    conditions.push(or(...visibility)!);
  }

  const rows = await db
    .select({
      fixture: fixtures,
      homeRegistrationId: homeRegistrations.id,
      awayRegistrationId: awayRegistrations.id,
      homeTeamId: homeTeams.id,
      awayTeamId: awayTeams.id,
      homeTeamName: homeTeams.name,
      awayTeamName: awayTeams.name,
      matchId: matches.id,
      matchStatus: matches.status,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      resultConfirmedAt: matches.resultConfirmedAt,
      durationMinutes: matches.durationMinutes,
      clockRunningAt: matches.clockRunningAt,
      clockAccumulatedSeconds: matches.clockAccumulatedSeconds,
      currentMinute: matches.currentMinute,
      addedMinutes: matches.addedMinutes,
    })
    .from(fixtures)
    .innerJoin(homeRegistrations, eq(fixtures.homeTeamRegistrationId, homeRegistrations.id))
    .innerJoin(awayRegistrations, eq(fixtures.awayTeamRegistrationId, awayRegistrations.id))
    .innerJoin(homeTeams, eq(homeRegistrations.teamId, homeTeams.id))
    .innerJoin(awayTeams, eq(awayRegistrations.teamId, awayTeams.id))
    .leftJoin(matches, eq(matches.fixtureId, fixtures.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(fixtures.scheduledAt), asc(fixtures.createdAt));

  return rows.map(shapeFixture);
}

export async function getFixture(auth: AuthContext | null, fixtureId: string) {
  const scope = await loadFixtureScope(fixtureId);
  if (!(await canReadFixture(auth, scope))) throw notFound('Fixture not found.');
  return shapeFixture(await enrichedFixture(fixtureId));
}

export async function updateFixture(auth: AuthContext, fixtureId: string, input: FixtureUpdate) {
  const scope = await assertCanManageFixture(auth, fixtureId);
  assertCompetitionWritable(scope.competition.status);
  assertSeasonAllowsFixtures(scope.season.status);

  return db.transaction(async (tx) => {
    const [lockedFixture] = await tx
      .select()
      .from(fixtures)
      .where(eq(fixtures.id, fixtureId))
      .for('update');
    if (!lockedFixture) throw notFound('Fixture not found.');
    if (
      lockedFixture.status === 'completed' ||
      lockedFixture.status === 'cancelled' ||
      lockedFixture.status === 'abandoned'
    ) {
      throw conflict(`A "${lockedFixture.status}" fixture is read-only.`);
    }

    const [matchRow] = await tx
      .select({ id: matches.id, status: matches.status })
      .from(matches)
      .where(eq(matches.fixtureId, fixtureId))
      .for('update');
    const participantsChanged =
      (input.homeTeamRegistrationId !== undefined &&
        input.homeTeamRegistrationId !== lockedFixture.homeTeamRegistrationId) ||
      (input.awayTeamRegistrationId !== undefined &&
        input.awayTeamRegistrationId !== lockedFixture.awayTeamRegistrationId);

    const homeId = input.homeTeamRegistrationId ?? lockedFixture.homeTeamRegistrationId;
    const awayId = input.awayTeamRegistrationId ?? lockedFixture.awayTeamRegistrationId;
    const groupId =
      input.groupId === undefined ? lockedFixture.groupId : input.groupId;

    if (groupId) await assertGroupInSeason(tx, groupId, lockedFixture.seasonId);

    if (participantsChanged) {
      if (lockedFixture.status !== 'draft') {
        throw conflict('Participants can only be changed while the fixture is still a draft.');
      }
      if (matchRow && matchRow.status !== 'scheduled') {
        throw conflict('Participants cannot be changed after the match has started.');
      }
      if (matchRow) {
        const [activeEvents] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(matchEvents)
          .where(eq(matchEvents.matchId, matchRow.id));
        if ((activeEvents?.count ?? 0) > 0) {
          throw conflict('Participants cannot be changed after match events exist.');
        }
      }
    }

    const [home, away] = await loadParticipants(tx, lockedFixture.seasonId, homeId, awayId);
    await validateParticipantGroup(home, away, groupId);

    const [updated] = await tx
      .update(fixtures)
      .set({
        ...(input.groupId !== undefined ? { groupId } : {}),
        ...(input.homeTeamRegistrationId !== undefined
          ? { homeTeamRegistrationId: input.homeTeamRegistrationId }
          : {}),
        ...(input.awayTeamRegistrationId !== undefined
          ? { awayTeamRegistrationId: input.awayTeamRegistrationId }
          : {}),
        ...(input.round !== undefined ? { round: input.round } : {}),
        ...(input.scheduledAt !== undefined
          ? { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null }
          : {}),
        ...(input.venue !== undefined ? { venue: input.venue } : {}),
        updatedAt: new Date(),
      })
      .where(eq(fixtures.id, fixtureId))
      .returning();
    if (!updated) throw notFound('Fixture not found.');

    await writeFixtureAudit(tx, auth.userId, 'fixture.updated', fixtureId, lockedFixture, updated);
    return { fixture: updated, matchId: matchRow?.id ?? null };
  });
}

export async function publishFixture(auth: AuthContext, fixtureId: string) {
  const scope = await assertCanManageFixture(auth, fixtureId);
  assertCompetitionWritable(scope.competition.status);
  assertSeasonAllowsFixtures(scope.season.status);
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(fixtures)
      .where(eq(fixtures.id, fixtureId))
      .for('update');
    if (!locked) throw notFound('Fixture not found.');
    if (locked.status !== 'draft') {
      throw conflict('Only a draft fixture can be published.');
    }
    const [updated] = await tx
      .update(fixtures)
      .set({ status: 'scheduled', publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(fixtures.id, fixtureId))
      .returning();
    if (!updated) throw notFound('Fixture not found.');
    await writeFixtureAudit(tx, auth.userId, 'fixture.published', fixtureId, locked, updated);
    return updated;
  });
}

export async function unpublishFixture(auth: AuthContext, fixtureId: string) {
  const scope = await assertCanManageFixture(auth, fixtureId);
  assertCompetitionWritable(scope.competition.status);
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(fixtures)
      .where(eq(fixtures.id, fixtureId))
      .for('update');
    if (!locked) throw notFound('Fixture not found.');
    if (locked.status !== 'scheduled' || locked.publishedAt === null) {
      throw conflict('Only a published, scheduled fixture can be unpublished.');
    }
    const [matchRow] = await tx
      .select({ id: matches.id, status: matches.status })
      .from(matches)
      .where(eq(matches.fixtureId, fixtureId))
      .for('update');
    if (matchRow && matchRow.status !== 'scheduled') {
      throw conflict('A match that has started cannot be unpublished.');
    }
    const [updated] = await tx
      .update(fixtures)
      .set({ status: 'draft', publishedAt: null, updatedAt: new Date() })
      .where(eq(fixtures.id, fixtureId))
      .returning();
    if (!updated) throw notFound('Fixture not found.');
    await writeFixtureAudit(tx, auth.userId, 'fixture.unpublished', fixtureId, locked, updated);
    return updated;
  });
}

/**
 * Fixture-level lifecycle writes use the same lock order as the match engine
 * (fixture → match) so the two paths can never deadlock against each other.
 */
async function lockFixtureWithMatch(tx: Transaction, fixtureId: string) {
  const [fixture] = await tx
    .select()
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .for('update');
  if (!fixture) throw notFound('Fixture not found.');
  const [match] = await tx
    .select()
    .from(matches)
    .where(eq(matches.fixtureId, fixtureId))
    .for('update');
  return { fixture, match: match ?? null };
}

export async function postponeFixture(
  auth: AuthContext,
  fixtureId: string,
  input: FixtureLifecycle,
) {
  const scope = await assertCanManageFixture(auth, fixtureId);
  assertCompetitionWritable(scope.competition.status);
  return db.transaction(async (tx) => {
    const { fixture, match } = await lockFixtureWithMatch(tx, fixtureId);
    if (fixture.status !== 'scheduled') {
      throw conflict('Only a scheduled fixture can be postponed.');
    }
    if (match && match.status !== 'scheduled') {
      throw conflict('A match that has started cannot be postponed at fixture level.');
    }
    const now = new Date();
    const [updated] = await tx
      .update(fixtures)
      .set({ status: 'postponed', updatedAt: now })
      .where(eq(fixtures.id, fixtureId))
      .returning();
    if (match) {
      await tx
        .update(matches)
        .set({ status: 'postponed', updatedAt: now })
        .where(eq(matches.id, match.id));
    }
    await writeFixtureAudit(
      tx,
      auth.userId,
      'fixture.postponed',
      fixtureId,
      { fixture, match },
      { fixture: updated, matchStatus: match ? 'postponed' : null },
      input.reason ?? null,
    );
    return { fixture: updated, matchId: match?.id ?? null };
  });
}

export async function rescheduleFixture(
  auth: AuthContext,
  fixtureId: string,
  input: FixtureReschedule,
) {
  const scope = await assertCanManageFixture(auth, fixtureId);
  assertCompetitionWritable(scope.competition.status);
  assertSeasonAllowsFixtures(scope.season.status);
  return db.transaction(async (tx) => {
    const { fixture, match } = await lockFixtureWithMatch(tx, fixtureId);
    if (
      fixture.status === 'completed' ||
      fixture.status === 'cancelled' ||
      fixture.status === 'abandoned'
    ) {
      throw conflict(`A "${fixture.status}" fixture cannot be rescheduled.`);
    }
    if (match && match.status !== 'scheduled' && match.status !== 'postponed') {
      throw conflict('A match that has started cannot be rescheduled.');
    }
    const now = new Date();
    const nextStatus = fixture.status === 'postponed' ? 'scheduled' : fixture.status;
    const [updated] = await tx
      .update(fixtures)
      .set({
        scheduledAt: new Date(input.scheduledAt),
        status: nextStatus,
        updatedAt: now,
      })
      .where(eq(fixtures.id, fixtureId))
      .returning();
    if (match) {
      await tx
        .update(matches)
        .set({
          ...(match.status === 'postponed' ? { status: 'scheduled' } : {}),
          updatedAt: now,
        })
        .where(eq(matches.id, match.id));
    }
    await writeFixtureAudit(
      tx,
      auth.userId,
      'fixture.rescheduled',
      fixtureId,
      { fixture, match },
      { fixture: updated, matchStatus: match && match.status === 'postponed' ? 'scheduled' : match?.status },
      input.reason ?? null,
    );
    return { fixture: updated, matchId: match?.id ?? null };
  });
}

export async function cancelFixture(
  auth: AuthContext,
  fixtureId: string,
  input: FixtureLifecycle,
) {
  const scope = await assertCanManageFixture(auth, fixtureId);
  assertCompetitionWritable(scope.competition.status);
  return db.transaction(async (tx) => {
    const { fixture, match } = await lockFixtureWithMatch(tx, fixtureId);
    if (
      fixture.status === 'completed' ||
      fixture.status === 'cancelled' ||
      fixture.status === 'abandoned'
    ) {
      throw conflict(`A "${fixture.status}" fixture cannot be cancelled.`);
    }
    if (match && match.status !== 'scheduled' && match.status !== 'postponed') {
      throw conflict('A match that has started cannot be cancelled; abandon it instead.');
    }
    const now = new Date();
    const [updated] = await tx
      .update(fixtures)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(fixtures.id, fixtureId))
      .returning();
    if (match) {
      await tx
        .update(matches)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(matches.id, match.id));
    }
    await writeFixtureAudit(
      tx,
      auth.userId,
      'fixture.cancelled',
      fixtureId,
      { fixture, match },
      { fixture: updated, matchStatus: match ? 'cancelled' : null },
      input.reason ?? null,
    );
    return { fixture: updated, matchId: match?.id ?? null };
  });
}

export interface GeneratedPairing {
  round: number;
  homeTeamRegistrationId: string;
  awayTeamRegistrationId: string;
}

export function buildRoundRobin(teamIds: readonly string[], legs: 1 | 2): GeneratedPairing[] {
  if (teamIds.length < 2) return [];
  const rotation = [...teamIds];
  const bye = '__bye__';
  if (rotation.length % 2 === 1) rotation.push(bye);
  const size = rotation.length;
  const roundsPerLeg = size - 1;
  const half = size / 2;
  const pairings: GeneratedPairing[] = [];
  let wheel = [...rotation];

  for (let round = 0; round < roundsPerLeg; round += 1) {
    for (let index = 0; index < half; index += 1) {
      const first = wheel[index]!;
      const second = wheel[size - 1 - index]!;
      if (first === bye || second === bye) continue;
      const flip = (round + index) % 2 === 1;
      pairings.push({
        round: round + 1,
        homeTeamRegistrationId: flip ? second : first,
        awayTeamRegistrationId: flip ? first : second,
      });
    }
    wheel = [wheel[0]!, wheel[size - 1]!, ...wheel.slice(1, size - 1)];
  }

  if (legs === 2) {
    const firstLeg = [...pairings];
    for (const pairing of firstLeg) {
      pairings.push({
        round: pairing.round + roundsPerLeg,
        homeTeamRegistrationId: pairing.awayTeamRegistrationId,
        awayTeamRegistrationId: pairing.homeTeamRegistrationId,
      });
    }
  }
  return pairings;
}

interface GenerationContext {
  season: typeof seasons.$inferSelect;
  competition: typeof competitions.$inferSelect;
  groupId: string | null;
  teams: Array<{ id: string; teamName: string }>;
  existing: Array<{ homeTeamRegistrationId: string; awayTeamRegistrationId: string; round: number | null }>;
}

async function loadGenerationContext(
  executor: Transaction | typeof db,
  auth: AuthContext,
  input: FixtureGeneration,
): Promise<GenerationContext> {
  const [row] = await executor
    .select({ season: seasons, competition: competitions })
    .from(seasons)
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(seasons.id, input.seasonId));
  if (!row) throw notFound('Season not found.');
  if (!canManageFixtures(auth, row.competition.id)) {
    if (!canViewCompetition(auth, row.competition)) throw notFound('Season not found.');
    throw forbidden();
  }
  assertCompetitionWritable(row.competition.status);
  assertSeasonAllowsFixtures(row.season.status);
  if (row.competition.format === 'knockout') {
    throw conflict('Round-robin generation does not apply to knockout competitions.');
  }

  const groupId = input.groupId ?? null;
  if (groupId) await assertGroupInSeason(executor, groupId, row.season.id);

  const teamConditions: SQL[] = [
    eq(teamRegistrations.seasonId, row.season.id),
    eq(teamRegistrations.status, 'approved'),
    isNull(teams.archivedAt),
  ];
  if (groupId) teamConditions.push(eq(teamRegistrations.groupId, groupId));

  const entries = await executor
    .select({ id: teamRegistrations.id, teamName: teams.name })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .where(and(...teamConditions))
    .orderBy(asc(teams.name));

  const existingRows = await executor
    .select({
      homeTeamRegistrationId: fixtures.homeTeamRegistrationId,
      awayTeamRegistrationId: fixtures.awayTeamRegistrationId,
      round: fixtures.round,
    })
    .from(fixtures)
    .where(
      and(
        eq(fixtures.seasonId, row.season.id),
        groupId ? eq(fixtures.groupId, groupId) : isNull(fixtures.groupId),
      ),
    );

  return {
    season: row.season,
    competition: row.competition,
    groupId,
    teams: entries,
    existing: existingRows,
  };
}

interface GenerationPlan {
  context: GenerationContext;
  legs: 1 | 2;
  startRound: number;
  fixtures: Array<GeneratedPairing & { homeTeamName: string; awayTeamName: string }>;
}

function buildGenerationPlan(
  context: GenerationContext,
  legs: 1 | 2,
): GenerationPlan {
  if (context.teams.length < 2) {
    throw conflict('At least two approved team entries are required to generate fixtures.');
  }
  const teamById = new Map(context.teams.map((team) => [team.id, team.teamName]));
  const existingPairs = new Set(
    context.existing.map(
      (row) => `${row.homeTeamRegistrationId}:${row.awayTeamRegistrationId}`,
    ),
  );
  const startRound = context.existing.reduce(
    (maximum, row) => Math.max(maximum, row.round ?? 0),
    0,
  );
  const pairings = buildRoundRobin(
    context.teams.map((team) => team.id),
    legs,
  );
  const fixtures: GenerationPlan['fixtures'] = [];
  for (const pairing of pairings) {
    const key = `${pairing.homeTeamRegistrationId}:${pairing.awayTeamRegistrationId}`;
    if (existingPairs.has(key)) continue;
    existingPairs.add(key);
    fixtures.push({
      ...pairing,
      round: pairing.round + startRound,
      homeTeamName: teamById.get(pairing.homeTeamRegistrationId) ?? 'Unknown team',
      awayTeamName: teamById.get(pairing.awayTeamRegistrationId) ?? 'Unknown team',
    });
  }
  return { context, legs, startRound, fixtures };
}

export async function previewGeneratedFixtures(
  auth: AuthContext,
  input: FixtureGeneration,
) {
  const legs = input.legs ?? 1;
  const context = await loadGenerationContext(db, auth, input);
  const plan = buildGenerationPlan(context, legs);
  return {
    seasonId: context.season.id,
    groupId: context.groupId,
    legs,
    teamCount: context.teams.length,
    existingFixtureCount: context.existing.length,
    startRound: plan.startRound,
    fixtures: plan.fixtures,
  };
}

export async function generateFixtures(auth: AuthContext, input: FixtureGeneration) {
  const legs = input.legs ?? 1;
  return db.transaction(async (tx) => {
    const [seasonLock] = await tx
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.id, input.seasonId))
      .for('update');
    if (!seasonLock) throw notFound('Season not found.');

    const context = await loadGenerationContext(tx, auth, input);
    const plan = buildGenerationPlan(context, legs);
    if (plan.fixtures.length === 0) {
      throw conflict('No new fixtures to generate for this season and group.');
    }

    const created: Array<{ fixtureId: string; matchId: string }> = [];
    for (const pairing of plan.fixtures) {
      const [fixture] = await tx
        .insert(fixtures)
        .values({
          seasonId: context.season.id,
          groupId: context.groupId,
          homeTeamRegistrationId: pairing.homeTeamRegistrationId,
          awayTeamRegistrationId: pairing.awayTeamRegistrationId,
          round: pairing.round,
          status: 'draft',
          createdBy: auth.userId,
        })
        .returning();
      if (!fixture) throw new Error('Generated fixture insert did not return a row.');
      const [match] = await tx
        .insert(matches)
        .values({ fixtureId: fixture.id })
        .returning({ id: matches.id });
      if (!match) throw new Error('Generated match insert did not return a row.');
      created.push({ fixtureId: fixture.id, matchId: match.id });
    }

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'fixture.generated',
      entityType: 'season',
      entityId: context.season.id,
      before: null,
      after: {
        groupId: context.groupId,
        legs,
        startRound: plan.startRound,
        fixtures: created,
      },
      reason: null,
    });

    return {
      seasonId: context.season.id,
      groupId: context.groupId,
      legs,
      createdCount: created.length,
      fixtures: created,
    };
  });
}
