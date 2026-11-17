import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  lineups,
  lineupPlayers,
  matchEvents,
  matches,
  playerRegistrations,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import {
  canReadPrivateMatch,
  isMatchOfficial,
} from '../../security/access.js';
import {
  canManageMatch,
  isInPlay,
  lockMatch,
  recalculateScore,
  requireMatchRead,
  requireMatchWrite,
  type MatchContext,
  type Executor,
} from './engine.js';
import { broadcastMatchUpdate, sanitizeEvent } from './live.js';
import { invalidateStandingsSnapshots } from '../standings/invalidation.js';
import type {
  MatchEventCorrect,
  MatchEventCreate,
  MatchEventType,
} from './schemas.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const REQUIRED_TEAM_TYPES: ReadonlySet<MatchEventType> = new Set([
  'goal',
  'own-goal',
  'yellow-card',
  'second-yellow',
  'red-card',
  'substitution',
  'injury',
  'penalty-awarded',
  'penalty-scored',
  'penalty-missed',
]);

const REQUIRED_PLAYER_TYPES: ReadonlySet<MatchEventType> = new Set([
  'goal',
  'own-goal',
  'yellow-card',
  'second-yellow',
  'red-card',
  'substitution',
  'penalty-scored',
  'penalty-missed',
]);

const CORRECTABLE_STATUSES = new Set<string>([
  'first_half',
  'live',
  'half_time',
  'second_half',
  'extra_time',
  'penalties',
  'full_time',
  'abandoned',
]);

export interface StoredEvent {
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
  clientTimestamp: Date | null;
  createdBy: string | null;
  receivedAt: Date;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  correctedAt: Date | null;
  correctedBy: string | null;
  correctionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function shapeEvent(event: StoredEvent, includeAudit: boolean) {
  const base = {
    id: event.id,
    matchId: event.matchId,
    clientEventId: event.clientEventId,
    eventType: event.eventType,
    teamRegistrationId: event.teamRegistrationId,
    playerRegistrationId: event.playerRegistrationId,
    secondaryPlayerRegistrationId: event.secondaryPlayerRegistrationId,
    minute: event.minute,
    addedMinutes: event.addedMinutes,
    description: event.description,
    clientTimestamp: event.clientTimestamp,
    receivedAt: event.receivedAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    voided: event.voidedAt !== null,
    corrected: event.correctedAt !== null,
  };
  if (!includeAudit) return base;
  return {
    ...base,
    voidedAt: event.voidedAt,
    voidedBy: event.voidedBy,
    voidReason: event.voidReason,
    correctedAt: event.correctedAt,
    correctedBy: event.correctedBy,
    correctionReason: event.correctionReason,
  };
}

function isPrivateEventReader(auth: AuthContext | null, context: MatchContext): boolean {
  if (!auth) return false;
  if (canReadPrivateMatch(auth, context.scope)) return true;
  return false;
}

async function isPrivateEventReaderAsync(
  auth: AuthContext | null,
  context: MatchContext,
): Promise<boolean> {
  if (isPrivateEventReader(auth, context)) return true;
  if (!auth) return false;
  return isMatchOfficial(auth.userId, context.scope.matchId);
}

async function loadPlayer(
  executor: Executor,
  playerRegistrationId: string,
  expectedTeamRegistrationId: string | null,
  seasonId: string,
) {
  const [player] = await executor
    .select({
      id: playerRegistrations.id,
      teamRegistrationId: playerRegistrations.teamRegistrationId,
      seasonId: playerRegistrations.seasonId,
    })
    .from(playerRegistrations)
    .where(eq(playerRegistrations.id, playerRegistrationId));
  if (!player) throw badRequest('playerRegistrationId does not identify a player registration.');
  if (player.seasonId !== seasonId) {
    throw badRequest('The player registration does not belong to the fixture season.');
  }
  if (expectedTeamRegistrationId && player.teamRegistrationId !== expectedTeamRegistrationId) {
    throw badRequest('The player registration does not belong to the event team.');
  }
  return player;
}

interface EventValues {
  eventType: MatchEventType;
  teamRegistrationId?: string | null | undefined;
  playerRegistrationId?: string | null | undefined;
  secondaryPlayerRegistrationId?: string | null | undefined;
  minute: number;
  addedMinutes?: number | null | undefined;
  description?: string | null | undefined;
  clientTimestamp?: string | null | undefined;
}

export interface ValidatedEvent {
  eventType: string;
  teamRegistrationId: string | null;
  playerRegistrationId: string | null;
  secondaryPlayerRegistrationId: string | null;
  minute: number;
  addedMinutes: number | null;
  description: string | null;
  clientTimestamp: Date | null;
}

/**
 * Validates event attribution against the fixture participants and season.
 * Team and player IDs supplied by the client are never trusted directly.
 */
export async function validateEventValues(
  executor: Executor,
  context: MatchContext,
  values: EventValues,
): Promise<ValidatedEvent> {
  const participants = [
    context.scope.homeTeamRegistrationId,
    context.scope.awayTeamRegistrationId,
  ];
  let teamId = values.teamRegistrationId ?? null;

  if (teamId && !participants.includes(teamId)) {
    throw badRequest('teamRegistrationId does not participate in this match.');
  }

  if (values.playerRegistrationId) {
    const player = await loadPlayer(
      executor,
      values.playerRegistrationId,
      teamId,
      context.scope.seasonId,
    );
    teamId = teamId ?? player.teamRegistrationId;
    if (!participants.includes(teamId)) {
      throw badRequest('The player registration does not participate in this match.');
    }
  }

  if (values.secondaryPlayerRegistrationId) {
    if (!teamId) {
      throw badRequest('A secondary player requires an event team.');
    }
    await loadPlayer(
      executor,
      values.secondaryPlayerRegistrationId,
      teamId,
      context.scope.seasonId,
    );
  }

  if (REQUIRED_TEAM_TYPES.has(values.eventType) && !teamId) {
    throw badRequest('This event type requires a participating team.');
  }
  if (REQUIRED_PLAYER_TYPES.has(values.eventType) && !values.playerRegistrationId) {
    throw badRequest('This event type requires a player registration.');
  }
  if (values.eventType === 'substitution') {
    if (!values.playerRegistrationId || !values.secondaryPlayerRegistrationId) {
      throw badRequest('A substitution requires outgoing and incoming players.');
    }
    if (values.playerRegistrationId === values.secondaryPlayerRegistrationId) {
      throw badRequest('A player cannot be substituted for themselves.');
    }
    if (teamId) {
      const [confirmedLineup] = await executor
        .select({ id: lineups.id })
        .from(lineups)
        .where(
          and(
            eq(lineups.matchId, context.match.id),
            eq(lineups.teamRegistrationId, teamId),
            eq(lineups.status, 'confirmed'),
          ),
        )
        .limit(1);
      if (confirmedLineup) {
        const roster = await executor
          .select({
            playerRegistrationId: lineupPlayers.playerRegistrationId,
            role: lineupPlayers.role,
          })
          .from(lineupPlayers)
          .where(eq(lineupPlayers.lineupId, confirmedLineup.id));
        const roles = new Map(
          roster.map((row) => [row.playerRegistrationId, row.role]),
        );
        if (roles.get(values.playerRegistrationId) !== 'starter') {
          throw badRequest(
            'The outgoing player must be a starter in the confirmed lineup.',
          );
        }
        if (roles.get(values.secondaryPlayerRegistrationId) !== 'substitute') {
          throw badRequest(
            'The incoming player must be a substitute in the confirmed lineup.',
          );
        }
      }
    }
  }
  if (
    values.playerRegistrationId &&
    values.secondaryPlayerRegistrationId &&
    values.playerRegistrationId === values.secondaryPlayerRegistrationId
  ) {
    throw badRequest('Primary and secondary players must differ.');
  }

  return {
    eventType: values.eventType,
    teamRegistrationId: teamId,
    playerRegistrationId: values.playerRegistrationId ?? null,
    secondaryPlayerRegistrationId: values.secondaryPlayerRegistrationId ?? null,
    minute: values.minute,
    addedMinutes: values.addedMinutes ?? null,
    description: values.description ?? null,
    clientTimestamp: values.clientTimestamp ? new Date(values.clientTimestamp) : null,
  };
}

function replayMatches(event: StoredEvent, input: MatchEventCreate): boolean {
  if (input.eventType !== event.eventType) return false;
  if (input.minute !== event.minute) return false;
  if ((input.addedMinutes ?? null) !== event.addedMinutes) return false;
  if ((input.playerRegistrationId ?? null) !== event.playerRegistrationId) return false;
  if ((input.secondaryPlayerRegistrationId ?? null) !== event.secondaryPlayerRegistrationId) {
    return false;
  }
  if ((input.description ?? null) !== event.description) return false;
  if (
    input.teamRegistrationId &&
    input.teamRegistrationId !== event.teamRegistrationId
  ) {
    return false;
  }
  if (input.clientTimestamp) {
    const stored = event.clientTimestamp?.toISOString() ?? null;
    if (new Date(input.clientTimestamp).toISOString() !== stored) return false;
  }
  return true;
}

function assertEventWritable(match: { status: string; resultConfirmedAt: Date | null }): void {
  if (!isInPlay(match.status)) {
    throw conflict(`Events cannot be recorded while the match is "${match.status}".`);
  }
  if (match.resultConfirmedAt) {
    throw conflict('The match result is already confirmed.');
  }
}

export async function createMatchEvent(
  auth: AuthContext,
  matchId: string,
  input: MatchEventCreate,
) {
  const context = await requireMatchWrite(auth, matchId);
  assertEventWritable(context.match);

  const result = await db.transaction(async (tx) => {
    const { match } = await lockMatch(tx, context.scope.fixtureId, matchId);
    assertEventWritable(match);

    const [existing] = await tx
      .select()
      .from(matchEvents)
      .where(
        and(
          eq(matchEvents.matchId, matchId),
          eq(matchEvents.clientEventId, input.clientEventId),
        ),
      )
      .for('update');
    if (existing) {
      if (!replayMatches(existing, input)) {
        throw conflict(
          'clientEventId was already used for this match with a different payload.',
        );
      }
      return {
        event: existing,
        created: false,
        score: { homeScore: match.homeScore, awayScore: match.awayScore },
        match,
      };
    }

    const validated = await validateEventValues(tx, context, input);
    const [created] = await tx
      .insert(matchEvents)
      .values({
        matchId,
        clientEventId: input.clientEventId,
        ...validated,
        createdBy: auth.userId,
      })
      .returning();
    if (!created) throw new Error('Event insert did not return a row.');

    const score = await recalculateScore(tx, { scope: context.scope, matchId });
    const [after] = await tx.select().from(matches).where(eq(matches.id, matchId));
    return { event: created, created: true, score, match: after ?? match };
  });

  broadcastMatchUpdate(
    matchId,
    result.match,
    result.created ? 'event.recorded' : 'event.replayed',
    sanitizeEvent(result.event),
  );
  return {
    event: shapeEvent(result.event, true),
    created: result.created,
    score: result.score,
  };
}

export async function listMatchEvents(auth: AuthContext | null, matchId: string) {
  const context = await requireMatchRead(auth, matchId);
  const privateReader = await isPrivateEventReaderAsync(auth, context);
  const rows = await db
    .select()
    .from(matchEvents)
    .where(
      privateReader
        ? eq(matchEvents.matchId, matchId)
        : and(eq(matchEvents.matchId, matchId), isNull(matchEvents.voidedAt)),
    )
    .orderBy(asc(matchEvents.minute), asc(matchEvents.addedMinutes), asc(matchEvents.createdAt));
  return rows.map((row) => shapeEvent(row, privateReader));
}

export async function getMatchEvent(
  auth: AuthContext | null,
  matchId: string,
  eventId: string,
) {
  const context = await requireMatchRead(auth, matchId);
  const privateReader = await isPrivateEventReaderAsync(auth, context);
  const [event] = await db
    .select()
    .from(matchEvents)
    .where(and(eq(matchEvents.id, eventId), eq(matchEvents.matchId, matchId)));
  if (!event || (event.voidedAt !== null && !privateReader)) {
    throw notFound('Event not found.');
  }
  return shapeEvent(event, privateReader);
}

function mergedEventValues(event: StoredEvent, input: MatchEventCorrect): EventValues {
  return {
    eventType: (input.eventType ?? event.eventType) as MatchEventType,
    teamRegistrationId:
      input.teamRegistrationId !== undefined
        ? input.teamRegistrationId
        : event.teamRegistrationId,
    playerRegistrationId:
      input.playerRegistrationId !== undefined
        ? input.playerRegistrationId
        : event.playerRegistrationId,
    secondaryPlayerRegistrationId:
      input.secondaryPlayerRegistrationId !== undefined
        ? input.secondaryPlayerRegistrationId
        : event.secondaryPlayerRegistrationId,
    minute: input.minute ?? event.minute,
    addedMinutes:
      input.addedMinutes !== undefined ? input.addedMinutes : event.addedMinutes,
    description: input.description !== undefined ? input.description : event.description,
    clientTimestamp:
      input.clientTimestamp !== undefined
        ? input.clientTimestamp
        : event.clientTimestamp?.toISOString() ?? null,
  };
}

async function loadEventForUpdate(tx: Transaction, matchId: string, eventId: string) {
  const [event] = await tx
    .select()
    .from(matchEvents)
    .where(and(eq(matchEvents.id, eventId), eq(matchEvents.matchId, matchId)))
    .for('update');
  if (!event) throw notFound('Event not found.');
  return event;
}

function assertCorrectable(
  auth: AuthContext,
  context: MatchContext,
  match: { status: string; resultConfirmedAt: Date | null },
): void {
  if (!CORRECTABLE_STATUSES.has(match.status)) {
    throw conflict(`Events cannot be corrected while the match is "${match.status}".`);
  }
  if (match.resultConfirmedAt && !canManageMatch(auth, context.scope)) {
    throw forbidden('A confirmed result can only be corrected by an administrator.');
  }
}

async function clearConfirmation(
  tx: Transaction,
  actorUserId: string,
  matchId: string,
  seasonId: string,
  before: { resultConfirmedAt: Date | null; confirmedBy: string | null },
  reason: string,
): Promise<void> {
  if (!before.resultConfirmedAt) return;
  await tx
    .update(matches)
    .set({ resultConfirmedAt: null, confirmedBy: null, updatedAt: new Date() })
    .where(eq(matches.id, matchId));
  await tx.insert(auditLogs).values({
    actorUserId,
    action: 'match.result.reopened',
    entityType: 'match',
    entityId: matchId,
    before,
    after: { resultConfirmedAt: null, confirmedBy: null },
    reason,
  });
  await invalidateStandingsSnapshots(
    tx,
    actorUserId,
    seasonId,
    matchId,
    'Match result reopened',
  );
}

export async function correctMatchEvent(
  auth: AuthContext,
  matchId: string,
  eventId: string,
  input: MatchEventCorrect,
) {
  const context = await requireMatchWrite(auth, matchId);

  const result = await db.transaction(async (tx) => {
    const { match } = await lockMatch(tx, context.scope.fixtureId, matchId);
    assertCorrectable(auth, context, match);
    const event = await loadEventForUpdate(tx, matchId, eventId);
    if (event.voidedAt) {
      throw conflict('A voided event cannot be corrected.');
    }

    const validated = await validateEventValues(tx, context, mergedEventValues(event, input));
    const [updated] = await tx
      .update(matchEvents)
      .set({
        ...validated,
        correctedAt: new Date(),
        correctedBy: auth.userId,
        correctionReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(matchEvents.id, eventId))
      .returning();
    if (!updated) throw notFound('Event not found.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'match.event.corrected',
      entityType: 'match',
      entityId: matchId,
      before: event,
      after: updated,
      reason: input.reason,
    });

    await clearConfirmation(
      tx,
      auth.userId,
      matchId,
      context.scope.seasonId,
      match,
      input.reason,
    );
    const score = await recalculateScore(tx, { scope: context.scope, matchId });
    const [after] = await tx.select().from(matches).where(eq(matches.id, matchId));
    return { event: updated, score, match: after ?? match };
  });

  broadcastMatchUpdate(matchId, result.match, 'event.corrected', sanitizeEvent(result.event));
  return {
    event: shapeEvent(result.event, true),
    score: result.score,
    resultConfirmedAt: result.match.resultConfirmedAt,
  };
}

export async function voidMatchEvent(
  auth: AuthContext,
  matchId: string,
  eventId: string,
  input: { reason: string },
) {
  const context = await requireMatchWrite(auth, matchId);

  const result = await db.transaction(async (tx) => {
    const { match } = await lockMatch(tx, context.scope.fixtureId, matchId);
    assertCorrectable(auth, context, match);
    const event = await loadEventForUpdate(tx, matchId, eventId);
    if (event.voidedAt) throw conflict('The event is already voided.');

    const now = new Date();
    const [updated] = await tx
      .update(matchEvents)
      .set({
        voidedAt: now,
        voidedBy: auth.userId,
        voidReason: input.reason,
        updatedAt: now,
      })
      .where(eq(matchEvents.id, eventId))
      .returning();
    if (!updated) throw notFound('Event not found.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'match.event.voided',
      entityType: 'match',
      entityId: matchId,
      before: event,
      after: updated,
      reason: input.reason,
    });

    await clearConfirmation(
      tx,
      auth.userId,
      matchId,
      context.scope.seasonId,
      match,
      input.reason,
    );
    const score = await recalculateScore(tx, { scope: context.scope, matchId });
    const [after] = await tx.select().from(matches).where(eq(matches.id, matchId));
    return { event: updated, score, match: after ?? match };
  });

  broadcastMatchUpdate(matchId, result.match, 'event.voided', sanitizeEvent(result.event));
  return {
    event: shapeEvent(result.event, true),
    score: result.score,
    resultConfirmedAt: result.match.resultConfirmedAt,
  };
}
