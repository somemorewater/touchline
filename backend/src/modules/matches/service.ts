import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../database/client.js';
import {
  auditLogs,
  fixtures,
  matchEvents,
  matchOfficials,
  matches,
  seasons,
  teamRegistrations,
  teams,
  users,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { canReadMatch } from '../../security/access.js';
import { assertPersonnelEligible, insertPersonnelAssignment } from './personnel.js';
import {
  calculateScore,
  canManageOfficials,
  isInPlay,
  loadMatchContext,
  lockMatch,
  recalculateScore,
  requireMatchManage,
  requireMatchRead,
  requireMatchWrite,
} from './engine.js';
import { broadcastMatchUpdate } from './live.js';
import { createNotification, notifyMatchParticipants } from '../notifications/service.js';
import { invalidateStandingsSnapshots } from '../standings/invalidation.js';
import type { z } from 'zod';
import type {
  matchClockSchema,
  matchDurationUpdateSchema,
  matchLifecycleSchema,
  matchOfficialAssignSchema,
  matchOfficialUpdateSchema,
  matchReportSchema,
  matchRescheduleSchema,
  matchResultCorrectSchema,
  matchVenueUpdateSchema,
} from './schemas.js';

type MatchLifecycle = z.infer<typeof matchLifecycleSchema>;
type MatchReschedule = z.infer<typeof matchRescheduleSchema>;
type MatchClock = z.infer<typeof matchClockSchema>;
type MatchReport = z.infer<typeof matchReportSchema>;
type MatchResultCorrect = z.infer<typeof matchResultCorrectSchema>;
type MatchVenueUpdate = z.infer<typeof matchVenueUpdateSchema>;
type MatchDurationUpdate = z.infer<typeof matchDurationUpdateSchema>;
type OfficialAssign = z.infer<typeof matchOfficialAssignSchema>;
type OfficialUpdate = z.infer<typeof matchOfficialUpdateSchema>;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MatchAction =
  | 'start'
  | 'half_time'
  | 'second_half'
  | 'end'
  | 'postpone'
  | 'cancel'
  | 'abandon';

interface TransitionDefinition {
  allowedFrom: readonly string[];
  to: string;
  fixtureStatus?: string;
  reason: string;
}

const TRANSITIONS: Record<MatchAction, TransitionDefinition> = {
  start: {
    allowedFrom: ['scheduled'],
    to: 'first_half',
    reason: 'match.started',
  },
  half_time: {
    allowedFrom: ['first_half', 'live'],
    to: 'half_time',
    reason: 'match.half_time',
  },
  second_half: {
    allowedFrom: ['half_time'],
    to: 'second_half',
    reason: 'match.second_half',
  },
  end: {
    allowedFrom: ['second_half'],
    to: 'full_time',
    fixtureStatus: 'completed',
    reason: 'match.ended',
  },
  postpone: {
    allowedFrom: ['scheduled'],
    to: 'postponed',
    fixtureStatus: 'postponed',
    reason: 'match.postponed',
  },
  cancel: {
    allowedFrom: ['scheduled', 'postponed'],
    to: 'cancelled',
    fixtureStatus: 'cancelled',
    reason: 'match.cancelled',
  },
  abandon: {
    allowedFrom: ['first_half', 'live', 'half_time', 'second_half', 'extra_time', 'penalties'],
    to: 'abandoned',
    fixtureStatus: 'abandoned',
    reason: 'match.abandoned',
  },
};

function elapsedSeconds(match: typeof matches.$inferSelect, now: Date): number {
  const accumulated = match.clockAccumulatedSeconds ?? 0;
  if (!match.clockRunningAt) return accumulated;
  return accumulated + Math.max(0, Math.floor((now.getTime() - match.clockRunningAt.getTime()) / 1000));
}

function transitionValues(
  action: MatchAction,
  match: typeof matches.$inferSelect,
  now: Date,
): Partial<typeof matches.$inferInsert> {
  const duration = match.durationMinutes ?? 90;
  const halfTimeMinute = Math.floor(duration / 2);
  const elapsed = Math.floor(elapsedSeconds(match, now) / 60);
  switch (action) {
    case 'start':
      return {
        status: 'first_half',
        startedAt: match.startedAt ?? now,
        endedAt: null,
        currentMinute: 0,
        addedMinutes: 0,
        clockRunningAt: now,
        clockAccumulatedSeconds: 0,
      };
    case 'half_time': {
      const minute = Math.max(match.currentMinute ?? 0, halfTimeMinute, elapsed);
      return {
        status: 'half_time',
        currentMinute: minute,
        clockRunningAt: null,
        clockAccumulatedSeconds: minute * 60,
      };
    }
    case 'second_half':
      return {
        status: 'second_half',
        currentMinute: Math.max(match.currentMinute ?? 0, halfTimeMinute + 1),
        clockRunningAt: now,
        clockAccumulatedSeconds: match.clockAccumulatedSeconds ?? halfTimeMinute * 60,
      };
    case 'end': {
      const minute = Math.max(match.currentMinute ?? 0, duration, elapsed);
      return {
        status: 'full_time',
        endedAt: now,
        currentMinute: minute,
        clockRunningAt: null,
        clockAccumulatedSeconds: minute * 60,
      };
    }
    case 'postpone':
      return { status: 'postponed', clockRunningAt: null };
    case 'cancel':
      return { status: 'cancelled', clockRunningAt: null };
    case 'abandon':
      return {
        status: 'abandoned',
        endedAt: now,
        clockRunningAt: null,
        clockAccumulatedSeconds: elapsedSeconds(match, now),
      };
    default:
      return {};
  }
}

export async function transitionMatch(
  auth: AuthContext,
  matchId: string,
  action: MatchAction,
  input: MatchLifecycle,
) {
  const context = await requireMatchWrite(auth, matchId);
  const definition = TRANSITIONS[action];

  const result = await db.transaction(async (tx) => {
    const { match, fixture } = await lockMatch(tx, context.scope.fixtureId, matchId);

    if (!definition.allowedFrom.includes(match.status)) {
      throw conflict(
        `Cannot move a match from "${match.status}" to "${definition.to}".`,
      );
    }
    if (action === 'start' && fixture.status !== 'scheduled') {
      throw conflict('The fixture must be scheduled and published before kickoff.');
    }
    if (
      (action === 'postpone' || action === 'cancel') &&
      fixture.status !== 'scheduled' &&
      fixture.status !== 'postponed' &&
      fixture.status !== 'draft'
    ) {
      throw conflict(`A "${fixture.status}" fixture cannot be ${action}ed.`);
    }
    if (action === 'end' && !match.startedAt) {
      throw conflict('A match cannot end before it started.');
    }

    const now = new Date();
    const values = transitionValues(action, match, now);
    const [updated] = await tx
      .update(matches)
      .set({ ...values, updatedAt: now })
      .where(eq(matches.id, matchId))
      .returning();
    if (!updated) throw notFound('Match not found.');

    if (definition.fixtureStatus) {
      await tx
        .update(fixtures)
        .set({ status: definition.fixtureStatus, updatedAt: now })
        .where(eq(fixtures.id, fixture.id));
    }

    if (action === 'end') {
      const score = await recalculateScore(tx, { scope: context.scope, matchId });
      void score;
    }

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: definition.reason,
      entityType: 'match',
      entityId: matchId,
      before: { match, fixtureStatus: fixture.status },
      after: { match: updated, fixtureStatus: definition.fixtureStatus ?? fixture.status },
      reason: input.reason ?? null,
    });

    const [afterMatch] = await tx.select().from(matches).where(eq(matches.id, matchId));
    return { match: afterMatch ?? updated, fixture };
  });

  broadcastMatchUpdate(matchId, result.match, TRANSITIONS[action].reason);
  return { match: result.match, fixtureId: result.fixture.id };
}

export async function rescheduleMatch(
  auth: AuthContext,
  matchId: string,
  input: MatchReschedule,
) {
  const context = await requireMatchWrite(auth, matchId);

  const result = await db.transaction(async (tx) => {
    const { match, fixture } = await lockMatch(tx, context.scope.fixtureId, matchId);
    if (match.status !== 'scheduled' && match.status !== 'postponed') {
      throw conflict('Only a scheduled or postponed match can be rescheduled.');
    }
    if (match.resultConfirmedAt) {
      throw conflict('A confirmed result cannot be rescheduled.');
    }
    const now = new Date();
    const [updatedFixture] = await tx
      .update(fixtures)
      .set({
        scheduledAt: new Date(input.scheduledAt),
        ...(fixture.status === 'postponed' ? { status: 'scheduled' } : {}),
        updatedAt: now,
      })
      .where(eq(fixtures.id, fixture.id))
      .returning();
    const [updatedMatch] = await tx
      .update(matches)
      .set({
        ...(match.status === 'postponed' ? { status: 'scheduled' } : {}),
        updatedAt: now,
      })
      .where(eq(matches.id, matchId))
      .returning();
    if (!updatedMatch || !updatedFixture) throw notFound('Match not found.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      competitionId: context.scope.competitionId,
      seasonId: context.scope.seasonId,
      action: 'match.rescheduled',
      entityType: 'match',
      entityId: matchId,
      before: { match, fixture },
      after: { match: updatedMatch, fixture: updatedFixture },
      reason: input.reason ?? null,
    });
    await notifyMatchParticipants(tx, matchId, {
      type: 'match.rescheduled',
      title: 'Match rescheduled',
      body: `The match was rescheduled to ${updatedFixture.scheduledAt?.toISOString() ?? 'a new time'}.`,
      entityType: 'match',
      entityId: matchId,
      competitionId: context.scope.competitionId,
      dedupeKey: `match-rescheduled:${matchId}:${updatedFixture.updatedAt.toISOString()}`,
    });
    return { match: updatedMatch, fixture: updatedFixture };
  });

  broadcastMatchUpdate(matchId, result.match, 'match.rescheduled');
  return result;
}

export async function reinstateMatch(
  auth: AuthContext,
  matchId: string,
) {
  const context = await requireMatchManage(auth, matchId);

  const result = await db.transaction(async (tx) => {
    const { match, fixture } = await lockMatch(tx, context.scope.fixtureId, matchId);

    if (match.status !== 'cancelled') {
      throw conflict('Only a cancelled match can be reinstated.');
    }
    if (fixture.status === 'completed' || fixture.status === 'abandoned') {
      throw conflict(`A "${fixture.status}" fixture cannot be reinstated.`);
    }
    if (match.resultConfirmedAt) {
      throw conflict('A match with a confirmed result cannot be reinstated.');
    }

    const now = new Date();

    const [updatedFixture] = await tx
      .update(fixtures)
      .set({
        status: 'scheduled',
        updatedAt: now,
      })
      .where(eq(fixtures.id, fixture.id))
      .returning();

    const [updatedMatch] = await tx
      .update(matches)
      .set({
        status: 'scheduled',
        updatedAt: now,
      })
      .where(eq(matches.id, matchId))
      .returning();

    if (!updatedMatch || !updatedFixture) throw notFound('Match not found.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      competitionId: context.scope.competitionId,
      seasonId: context.scope.seasonId,
      action: 'match.reinstated',
      entityType: 'match',
      entityId: matchId,
      before: { match, fixture },
      after: { match: updatedMatch, fixture: updatedFixture },
      reason: null,
    });

    await notifyMatchParticipants(tx, matchId, {
      type: 'match.reinstated',
      title: 'Match reinstated',
      body: 'The match was reinstated.',
      entityType: 'match',
      entityId: matchId,
      competitionId: context.scope.competitionId,
      dedupeKey: `match-reinstated:${matchId}:${updatedFixture.updatedAt.toISOString()}`,
    });

    return { match: updatedMatch, fixture: updatedFixture };
  });

  broadcastMatchUpdate(matchId, result.match, 'match.reinstated');
  return result;
}

type MatchDetailsSnapshot = {
  match: typeof matches.$inferSelect;
  fixture: typeof fixtures.$inferSelect;
};

/**
 * Venue and duration describe pre-match setup. Once a match has started its
 * recorded details must stay part of the historical record.
 */
function assertDetailsEditable({ match, fixture }: MatchDetailsSnapshot): void {
  if (
    match.startedAt ||
    match.resultConfirmedAt ||
    !['scheduled', 'postponed'].includes(match.status) ||
    !['draft', 'scheduled', 'postponed'].includes(fixture.status)
  ) {
    throw conflict('Venue and duration can only be changed before a match starts.');
  }
}

export async function updateMatchVenue(
  auth: AuthContext,
  matchId: string,
  input: MatchVenueUpdate,
) {
  const context = await requireMatchManage(auth, matchId);
  return db.transaction(async (tx) => {
    const snapshot = await lockMatch(tx, context.scope.fixtureId, matchId);
    assertDetailsEditable(snapshot);

    const [fixture] = await tx
      .update(fixtures)
      .set({ venue: input.venue, updatedAt: new Date() })
      .where(eq(fixtures.id, snapshot.fixture.id))
      .returning();
    if (!fixture) throw notFound('Match not found.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      competitionId: context.scope.competitionId,
      seasonId: context.scope.seasonId,
      action: 'match.venue.updated',
      entityType: 'match',
      entityId: matchId,
      before: { venue: snapshot.fixture.venue },
      after: { venue: fixture.venue },
      reason: null,
    });

    return { venue: fixture.venue };
  });
}

export async function updateMatchDuration(
  auth: AuthContext,
  matchId: string,
  input: MatchDurationUpdate,
) {
  const context = await requireMatchManage(auth, matchId);
  return db.transaction(async (tx) => {
    const snapshot = await lockMatch(tx, context.scope.fixtureId, matchId);
    assertDetailsEditable(snapshot);

    const [match] = await tx
      .update(matches)
      .set({ durationMinutes: input.durationMinutes, updatedAt: new Date() })
      .where(eq(matches.id, matchId))
      .returning();
    if (!match) throw notFound('Match not found.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      competitionId: context.scope.competitionId,
      seasonId: context.scope.seasonId,
      action: 'match.duration.updated',
      entityType: 'match',
      entityId: matchId,
      before: { durationMinutes: snapshot.match.durationMinutes },
      after: { durationMinutes: match.durationMinutes },
      reason: null,
    });

    return { durationMinutes: match.durationMinutes };
  });
}

export async function updateMatchClock(
  auth: AuthContext,
  matchId: string,
  input: MatchClock,
) {
  const context = await requireMatchWrite(auth, matchId);

  const result = await db.transaction(async (tx) => {
    const { match } = await lockMatch(tx, context.scope.fixtureId, matchId);
    if (!isInPlay(match.status)) {
      throw conflict(`The clock cannot be updated while the match is "${match.status}".`);
    }
    if (match.resultConfirmedAt) {
      throw conflict('The match result is already confirmed.');
    }
    const now = new Date();
    const [updated] = await tx
      .update(matches)
      .set({
        currentMinute: input.minute,
        addedMinutes: input.addedMinutes ?? null,
        // A correction re-bases the running period; time already played in
        // this period is replaced by the authoritative corrected value.
        clockRunningAt: match.clockRunningAt ? now : null,
        clockAccumulatedSeconds: input.minute * 60,
        updatedAt: now,
      })
      .where(eq(matches.id, matchId))
      .returning();
    if (!updated) throw notFound('Match not found.');
    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      competitionId: context.scope.competitionId,
      seasonId: context.scope.seasonId,
      action: 'match.clock.updated',
      entityType: 'match',
      entityId: matchId,
      before: {
        currentMinute: match.currentMinute,
        addedMinutes: match.addedMinutes,
        clockRunningAt: match.clockRunningAt,
        clockAccumulatedSeconds: match.clockAccumulatedSeconds,
      },
      after: {
        currentMinute: updated.currentMinute,
        addedMinutes: updated.addedMinutes,
        clockRunningAt: updated.clockRunningAt,
        clockAccumulatedSeconds: updated.clockAccumulatedSeconds,
      },
      reason: null,
    });
    return updated;
  });

  broadcastMatchUpdate(matchId, result, 'match.clock');
  return result;
}

export async function listMatchesForOfficial(userId: string) {
  const homeRegistrations = alias(teamRegistrations, 'official_home_registration');
  const awayRegistrations = alias(teamRegistrations, 'official_away_registration');
  const homeTeams = alias(teams, 'official_home_team');
  const awayTeams = alias(teams, 'official_away_team');

  const rows = await db
    .select({
      match: matches,
      fixture: fixtures,
      competitionId: seasons.competitionId,
      homeRegistrationId: homeRegistrations.id,
      awayRegistrationId: awayRegistrations.id,
      homeTeamId: homeTeams.id,
      awayTeamId: awayTeams.id,
      homeTeamName: homeTeams.name,
      awayTeamName: awayTeams.name,
      assignedAt: matchOfficials.assignedAt,
      role: matchOfficials.role,
    })
    .from(matchOfficials)
    .innerJoin(matches, eq(matchOfficials.matchId, matches.id))
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .innerJoin(homeRegistrations, eq(fixtures.homeTeamRegistrationId, homeRegistrations.id))
    .innerJoin(awayRegistrations, eq(fixtures.awayTeamRegistrationId, awayRegistrations.id))
    .innerJoin(homeTeams, eq(homeRegistrations.teamId, homeTeams.id))
    .innerJoin(awayTeams, eq(awayRegistrations.teamId, awayTeams.id))
    .where(eq(matchOfficials.userId, userId))
    .orderBy(asc(fixtures.scheduledAt), asc(fixtures.createdAt));

  return rows.map((row) => ({
    ...row.match,
    matchId: row.match.id,
    fixture: row.fixture,
    competitionId: row.competitionId,
    officialRole: row.role,
    assignedAt: row.assignedAt,
    homeTeamName: row.homeTeamName,
    awayTeamName: row.awayTeamName,
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
  }));
}

export async function listMatchOfficials(auth: AuthContext | null, matchId: string) {
  await requireMatchRead(auth, matchId);
  const rows = await db
    .select({
      userId: matchOfficials.userId,
      role: matchOfficials.role,
      assignedAt: matchOfficials.assignedAt,
      assignedBy: matchOfficials.assignedBy,
      displayName: users.displayName,
    })
    .from(matchOfficials)
    .innerJoin(users, eq(matchOfficials.userId, users.id))
    .where(eq(matchOfficials.matchId, matchId))
    .orderBy(asc(matchOfficials.assignedAt));
  return rows;
}

export async function assignMatchOfficial(
  auth: AuthContext,
  matchId: string,
  input: OfficialAssign,
) {
  const context = await loadMatchContext(matchId);
  if (!context) throw notFound('Match not found.');
  if (!canManageOfficials(auth, context.scope)) {
    if (!(await canReadMatch(auth, context.scope))) throw notFound('Match not found.');
    throw forbidden('Assigning match officials requires administrative scope.');
  }
  if (input.userId === auth.userId) {
    throw forbidden('You cannot assign yourself as a match official.');
  }
  if (
    context.match.status === 'full_time' ||
    context.match.status === 'cancelled' ||
    context.match.status === 'abandoned'
  ) {
    throw conflict(`Officials cannot be assigned to a "${context.match.status}" match.`);
  }

  const role = input.role ?? 'official';
  const result = await db.transaction(async (tx) => {
    await lockMatch(tx, context.scope.fixtureId, matchId);
    const assignment = await insertPersonnelAssignment(tx, {
      matchId,
      userId: input.userId,
      role,
      competitionId: context.scope.competitionId,
      seasonId: context.scope.seasonId,
      actor: auth,
    });
    await createNotification(tx, input.userId, {
      type: 'match.official.assigned',
      title: 'Match personnel assignment',
      body: role === 'commentary'
        ? 'You were assigned as a commentary operator.'
        : 'You were assigned as a match official.',
      entityType: 'match',
      entityId: matchId,
      competitionId: context.scope.competitionId,
      dedupeKey: `match-official:${matchId}:${input.userId}`,
    });
    return assignment;
  });

  return result;
}

export async function updateMatchOfficial(
  auth: AuthContext,
  matchId: string,
  userId: string,
  input: OfficialUpdate,
) {
  const context = await loadMatchContext(matchId);
  if (!context) throw notFound('Match not found.');
  if (!canManageOfficials(auth, context.scope)) {
    if (!(await canReadMatch(auth, context.scope))) throw notFound('Match not found.');
    throw forbidden('Managing match officials requires administrative scope.');
  }
  if (
    context.match.status === 'full_time' ||
    context.match.status === 'cancelled' ||
    context.match.status === 'abandoned'
  ) {
    throw conflict(`Officials cannot be changed on a "${context.match.status}" match.`);
  }

  return db.transaction(async (tx) => {
    await lockMatch(tx, context.scope.fixtureId, matchId);
    const [existing] = await tx
      .select()
      .from(matchOfficials)
      .where(
        and(eq(matchOfficials.matchId, matchId), eq(matchOfficials.userId, userId)),
      )
      .for('update');
    if (!existing) throw notFound('Official assignment not found.');
    const role = input.role ?? existing.role;
    if (role === existing.role) return existing;
    await assertPersonnelEligible(
      tx,
      userId,
      context.scope.competitionId,
      role === 'commentary' ? 'commentary' : 'official',
    );

    const [updated] = await tx
      .update(matchOfficials)
      .set({ role })
      .where(
        and(eq(matchOfficials.matchId, matchId), eq(matchOfficials.userId, userId)),
      )
      .returning();
    if (!updated) throw notFound('Official assignment not found.');
    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'match.official.updated',
      entityType: 'match',
      entityId: matchId,
      before: existing,
      after: updated,
      reason: null,
    });
    return updated;
  });
}

export async function replaceMatchPersonnel(
  auth: AuthContext,
  matchId: string,
  role: 'official' | 'commentary',
  userId: string,
) {
  const context = await loadMatchContext(matchId);
  if (!context) throw notFound('Match not found.');
  if (!canManageOfficials(auth, context.scope)) {
    if (!(await canReadMatch(auth, context.scope))) throw notFound('Match not found.');
    throw forbidden('Managing match personnel requires administrative scope.');
  }
  if (userId === auth.userId) throw forbidden('You cannot assign yourself to a match.');
  if (
    context.match.status === 'full_time' ||
    context.match.status === 'cancelled' ||
    context.match.status === 'abandoned'
  ) {
    throw conflict(`Personnel cannot be changed on a "${context.match.status}" match.`);
  }

  return db.transaction(async (tx) => {
    await lockMatch(tx, context.scope.fixtureId, matchId);
    const [current] = await tx
      .select()
      .from(matchOfficials)
      .where(
        and(
          eq(matchOfficials.matchId, matchId),
          eq(matchOfficials.role, role),
        ),
      )
      .for('update');
    if (current?.userId === userId) return { ...current, unchanged: true };

    const user = await assertPersonnelEligible(tx, userId, context.scope.competitionId, role);
    if (current) {
      await tx
        .delete(matchOfficials)
        .where(
          and(
            eq(matchOfficials.matchId, matchId),
            eq(matchOfficials.userId, current.userId),
            eq(matchOfficials.role, role),
          ),
        );
    }
    const [assignment] = await tx
      .insert(matchOfficials)
      .values({ matchId, userId, role, assignedBy: auth.userId })
      .returning();
    if (!assignment) throw new Error('Personnel insert did not return a row.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      competitionId: context.scope.competitionId,
      seasonId: context.scope.seasonId,
      action: role === 'commentary' ? 'match.commentary.replaced' : 'match.official.replaced',
      entityType: 'match',
      entityId: matchId,
      before: current ?? null,
      after: { ...assignment, displayName: user.displayName },
      reason: null,
    });
    await createNotification(tx, userId, {
      type: 'match.official.assigned',
      title: 'Match personnel assignment',
      body: role === 'commentary'
        ? 'You were assigned as a commentary operator.'
        : 'You were assigned as a match official.',
      entityType: 'match',
      entityId: matchId,
      competitionId: context.scope.competitionId,
      dedupeKey: `match-personnel:${matchId}:${userId}:${role}`,
    });
    return { ...assignment, displayName: user.displayName };
  });
}

export async function removeMatchOfficial(
  auth: AuthContext,
  matchId: string,
  userId: string,
) {
  const context = await loadMatchContext(matchId);
  if (!context) throw notFound('Match not found.');
  if (!canManageOfficials(auth, context.scope)) {
    if (!(await canReadMatch(auth, context.scope))) throw notFound('Match not found.');
    throw forbidden('Removing match officials requires administrative scope.');
  }
  if (context.match.status !== 'scheduled' && context.match.status !== 'postponed') {
    throw conflict('Officials can only be removed before the match starts.');
  }

  return db.transaction(async (tx) => {
    await lockMatch(tx, context.scope.fixtureId, matchId);
    const [existing] = await tx
      .select()
      .from(matchOfficials)
      .where(
        and(eq(matchOfficials.matchId, matchId), eq(matchOfficials.userId, userId)),
      )
      .for('update');
    if (!existing) throw notFound('Official assignment not found.');
    await tx
      .delete(matchOfficials)
      .where(
        and(eq(matchOfficials.matchId, matchId), eq(matchOfficials.userId, userId)),
      );
    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'match.official.removed',
      entityType: 'match',
      entityId: matchId,
      before: existing,
      after: null,
      reason: null,
    });
    return { removed: true, userId };
  });
}

async function eventSnapshot(executor: Transaction | typeof db, matchId: string) {
  const rows = await executor
    .select({
      id: matchEvents.id,
      eventType: matchEvents.eventType,
      teamRegistrationId: matchEvents.teamRegistrationId,
      playerRegistrationId: matchEvents.playerRegistrationId,
      secondaryPlayerRegistrationId: matchEvents.secondaryPlayerRegistrationId,
      minute: matchEvents.minute,
      addedMinutes: matchEvents.addedMinutes,
      voidedAt: matchEvents.voidedAt,
    })
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))
    .orderBy(asc(matchEvents.minute), asc(matchEvents.createdAt));
  return rows.map((row) => ({ ...row, voided: row.voidedAt !== null }));
}

export async function getMatchResult(auth: AuthContext | null, matchId: string) {
  const context = await requireMatchRead(auth, matchId);
  const derived = await calculateScore(
    db,
    matchId,
    context.scope.homeTeamRegistrationId,
    context.scope.awayTeamRegistrationId,
  );
  const homeRegistrations = alias(teamRegistrations, 'result_home_registration');
  const awayRegistrations = alias(teamRegistrations, 'result_away_registration');
  const homeTeams = alias(teams, 'result_home_team');
  const awayTeams = alias(teams, 'result_away_team');
  const [row] = await db
    .select({
      homeRegistrationId: homeRegistrations.id,
      awayRegistrationId: awayRegistrations.id,
      homeTeamId: homeTeams.id,
      awayTeamId: awayTeams.id,
      homeTeamName: homeTeams.name,
      awayTeamName: awayTeams.name,
    })
    .from(fixtures)
    .innerJoin(homeRegistrations, eq(fixtures.homeTeamRegistrationId, homeRegistrations.id))
    .innerJoin(awayRegistrations, eq(fixtures.awayTeamRegistrationId, awayRegistrations.id))
    .innerJoin(homeTeams, eq(homeRegistrations.teamId, homeTeams.id))
    .innerJoin(awayTeams, eq(awayRegistrations.teamId, awayTeams.id))
    .where(eq(fixtures.id, context.scope.fixtureId));

  return {
    match: {
      id: context.match.id,
      status: context.match.status,
      homeScore: context.match.homeScore,
      awayScore: context.match.awayScore,
      currentMinute: context.match.currentMinute,
      addedMinutes: context.match.addedMinutes,
      durationMinutes: context.match.durationMinutes,
      clockRunningAt: context.match.clockRunningAt,
      clockAccumulatedSeconds: context.match.clockAccumulatedSeconds,
      startedAt: context.match.startedAt,
      endedAt: context.match.endedAt,
      resultConfirmedAt: context.match.resultConfirmedAt,
      confirmedBy: context.match.confirmedBy,
    },
    fixture: {
      id: context.fixture.id,
      seasonId: context.fixture.seasonId,
      groupId: context.fixture.groupId,
      round: context.fixture.round,
      scheduledAt: context.fixture.scheduledAt,
      venue: context.fixture.venue,
      status: context.fixture.status,
      publishedAt: context.fixture.publishedAt,
    },
    homeTeam: row
      ? {
          teamId: row.homeTeamId,
          name: row.homeTeamName,
          registrationId: row.homeRegistrationId,
        }
      : null,
    awayTeam: row
      ? {
          teamId: row.awayTeamId,
          name: row.awayTeamName,
          registrationId: row.awayRegistrationId,
        }
      : null,
    score: { homeScore: context.match.homeScore, awayScore: context.match.awayScore },
    derivedScore: derived,
    events: await eventSnapshot(db, matchId),
  };
}

export async function submitMatchReport(
  auth: AuthContext,
  matchId: string,
  input: MatchReport,
) {
  const context = await requireMatchWrite(auth, matchId);

  const result = await db.transaction(async (tx) => {
    const { match, fixture } = await lockMatch(tx, context.scope.fixtureId, matchId);
    if (match.resultConfirmedAt) {
      throw conflict('The match result has already been submitted.');
    }
    if (match.status !== 'full_time') {
      throw conflict('A result can only be submitted after full time.');
    }
    if (!match.startedAt || !match.endedAt) {
      throw conflict('The match must have recorded start and end times.');
    }
    if (fixture.status !== 'completed') {
      throw conflict('The fixture is not in a completed state.');
    }

    const beforeEvents = await eventSnapshot(tx, matchId);
    const score = await recalculateScore(tx, { scope: context.scope, matchId });
    const now = new Date();
    const [updated] = await tx
      .update(matches)
      .set({ resultConfirmedAt: now, confirmedBy: auth.userId, updatedAt: now })
      .where(eq(matches.id, matchId))
      .returning();
    if (!updated) throw notFound('Match not found.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'match.result.submitted',
      entityType: 'match',
      entityId: matchId,
      before: {
        status: match.status,
        score: { homeScore: match.homeScore, awayScore: match.awayScore },
        resultConfirmedAt: match.resultConfirmedAt,
        events: beforeEvents,
      },
      after: {
        status: updated.status,
        score,
        resultConfirmedAt: now,
        confirmedBy: auth.userId,
      },
      reason: input.reason ?? null,
    });
    await invalidateStandingsSnapshots(
      tx,
      auth.userId,
      context.scope.seasonId,
      matchId,
      'Match result submitted',
    );
    return { match: updated, score };
  });

  broadcastMatchUpdate(matchId, result.match, 'result.submitted');
  return {
    match: result.match,
    score: result.score,
    resultConfirmedAt: result.match.resultConfirmedAt,
  };
}

export async function correctMatchResult(
  auth: AuthContext,
  matchId: string,
  input: MatchResultCorrect,
) {
  const context = await requireMatchManage(auth, matchId);

  const result = await db.transaction(async (tx) => {
    const { match } = await lockMatch(tx, context.scope.fixtureId, matchId);
    if (match.status !== 'full_time') {
      throw conflict('Only a full-time match result can be corrected.');
    }
    const beforeEvents = await eventSnapshot(tx, matchId);
    const score = await recalculateScore(tx, { scope: context.scope, matchId });
    const now = new Date();
    const [updated] = await tx
      .update(matches)
      .set({ resultConfirmedAt: now, confirmedBy: auth.userId, updatedAt: now })
      .where(eq(matches.id, matchId))
      .returning();
    if (!updated) throw notFound('Match not found.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'match.result.corrected',
      entityType: 'match',
      entityId: matchId,
      before: {
        score: { homeScore: match.homeScore, awayScore: match.awayScore },
        resultConfirmedAt: match.resultConfirmedAt,
        confirmedBy: match.confirmedBy,
        events: beforeEvents,
      },
      after: {
        score,
        resultConfirmedAt: now,
        confirmedBy: auth.userId,
        events: beforeEvents,
      },
      reason: input.reason,
    });
    await invalidateStandingsSnapshots(
      tx,
      auth.userId,
      context.scope.seasonId,
      matchId,
      'Match result corrected',
    );
    return { match: updated, score };
  });

  broadcastMatchUpdate(matchId, result.match, 'result.corrected');
  return {
    match: result.match,
    score: result.score,
    resultConfirmedAt: result.match.resultConfirmedAt,
  };
}

export async function getMatchResultHistory(auth: AuthContext, matchId: string) {
  await requireMatchWrite(auth, matchId);
  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorUserId: auditLogs.actorUserId,
      before: auditLogs.before,
      after: auditLogs.after,
      reason: auditLogs.reason,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'match'),
        eq(auditLogs.entityId, matchId),
        inArray(auditLogs.action, [
          'match.result.submitted',
          'match.result.corrected',
          'match.result.reopened',
        ]),
      ),
    )
    .orderBy(desc(auditLogs.createdAt));
}
