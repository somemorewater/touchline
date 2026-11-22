import { and, asc, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  competitionRules,
  fixtures,
  lineups,
  lineupPlayers,
  matches,
  playerRegistrations,
  players,
  seasons,
  teamRegistrations,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import {
  canManageCompetitionLineups,
  canManageTeamLineup,
  canReviewLineups,
  isTeamCaptain,
  loadMatchScope,
  type MatchScope,
} from '../../security/access.js';
import { loadMatchContext, lockMatch } from '../matches/engine.js';
import { broadcastToMatch } from '../../security/connections.js';
import { notifyTeamCaptain } from '../notifications/service.js';
import {
  FORMATION_IDS,
  getFormation,
  validateFormationPositions,
  type FormationDefinition,
} from './formations.js';
import {
  canSeeLineup,
  loadVisibleMatchLineups,
  resolveLineupVisibility,
  sanitizeLineup,
} from './visibility.js';
import { MAX_LINEUP_SUBSTITUTES, type LineupListQuery, type LineupPlayerInput } from './schemas.js';
import { playerPositionCodes } from '../../shared/positions.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Transaction | typeof db;

export const DEFAULT_MAX_SUBSTITUTES = MAX_LINEUP_SUBSTITUTES;

interface MatchContextRow {
  scope: MatchScope;
  match: typeof matches.$inferSelect;
  fixture: typeof fixtures.$inferSelect;
}

function hasKickedOff(
  match: { status: string; startedAt: Date | null },
  fixture: { status: string },
): boolean {
  return (
    match.startedAt !== null ||
    !['scheduled', 'postponed'].includes(match.status) ||
    ['completed', 'cancelled', 'abandoned'].includes(fixture.status)
  );
}

function assertEditableByCaptain(context: MatchContextRow): void {
  if (context.fixture.status === 'cancelled' || context.fixture.status === 'abandoned') {
    throw conflict('Lineups cannot be edited for a cancelled or abandoned fixture.');
  }
  if (hasKickedOff(context.match, context.fixture)) {
    throw conflict('A lineup can no longer be edited by the team after kickoff.');
  }
}

function assertReviewable(context: MatchContextRow): void {
  if (context.fixture.status === 'cancelled' || context.fixture.status === 'abandoned') {
    throw conflict('Lineups cannot be reviewed for a cancelled or abandoned fixture.');
  }
  if (hasKickedOff(context.match, context.fixture)) {
    throw conflict('Lineups must be reviewed before kickoff.');
  }
}

async function loadContextForLineup(lineupId: string): Promise<{
  context: MatchContextRow;
  lineup: typeof lineups.$inferSelect;
}> {
  const [row] = await db.select().from(lineups).where(eq(lineups.id, lineupId));
  if (!row) throw notFound('Lineup not found.');
  const context = await loadMatchContext(row.matchId);
  if (!context) throw notFound('Lineup not found.');
  return { context, lineup: row };
}

async function assertParticipantTeam(scope: MatchScope, teamRegistrationId: string) {
  if (
    teamRegistrationId !== scope.homeTeamRegistrationId &&
    teamRegistrationId !== scope.awayTeamRegistrationId
  ) {
    throw badRequest('The team entry does not participate in this match.');
  }
  const [entry] = await db
    .select({
      id: teamRegistrations.id,
      seasonId: teamRegistrations.seasonId,
      status: teamRegistrations.status,
    })
    .from(teamRegistrations)
    .where(eq(teamRegistrations.id, teamRegistrationId));
  if (!entry) throw badRequest('The team entry does not exist.');
  if (entry.seasonId !== scope.seasonId) {
    throw badRequest('The team entry does not belong to the fixture season.');
  }
  if (entry.status !== 'approved') {
    throw conflict('Only approved team entries can submit a lineup.');
  }
}

async function maxSubstitutesForSeason(
  executor: Executor,
  seasonId: string,
): Promise<number> {
  const [rules] = await executor
    .select({ rules: competitionRules.rules })
    .from(competitionRules)
    .where(eq(competitionRules.seasonId, seasonId));
  const configured = rules?.rules?.maxSubstitutes;
  if (typeof configured === 'number' && Number.isInteger(configured) && configured >= 0) {
    return Math.min(configured, MAX_LINEUP_SUBSTITUTES);
  }
  return DEFAULT_MAX_SUBSTITUTES;
}

interface EligibilityRow {
  id: string;
  teamRegistrationId: string;
  seasonId: string;
  status: string;
  eligibilityApproved: boolean;
  shirtNumber: number | null;
  playerArchivedAt: Date | null;
  teamEntryStatus: string;
}

async function loadEligibleRegistrations(
  executor: Executor,
  registrationIds: string[],
): Promise<Map<string, EligibilityRow>> {
  if (registrationIds.length === 0) return new Map();
  const rows: EligibilityRow[] = await executor
    .select({
      id: playerRegistrations.id,
      teamRegistrationId: playerRegistrations.teamRegistrationId,
      seasonId: playerRegistrations.seasonId,
      status: playerRegistrations.status,
      eligibilityApproved: playerRegistrations.eligibilityApproved,
      shirtNumber: playerRegistrations.shirtNumber,
      playerArchivedAt: players.archivedAt,
      teamEntryStatus: teamRegistrations.status,
    })
    .from(playerRegistrations)
    .innerJoin(players, eq(playerRegistrations.playerId, players.id))
    .innerJoin(
      teamRegistrations,
      eq(playerRegistrations.teamRegistrationId, teamRegistrations.id),
    )
    .where(inArray(playerRegistrations.id, registrationIds));
  return new Map(rows.map((row) => [row.id, row]));
}

export interface ValidatedLineup {
  formation: FormationDefinition | null;
  starters: LineupPlayerInput[];
  substitutes: LineupPlayerInput[];
}

async function validateLineupSelection(
  executor: Executor,
  scope: MatchScope,
  teamRegistrationId: string,
  formationId: string | null,
  inputs: readonly LineupPlayerInput[],
  options: { requireComplete: boolean },
): Promise<ValidatedLineup> {
  const formation = getFormation(formationId);
  if (formationId && !formation) {
    throw badRequest(
      `The formation is not supported. Supported formations: ${FORMATION_IDS.join(', ')}.`,
    );
  }

  const seen = new Set<string>();
  const shirtNumbers = new Set<number>();
  for (const player of inputs) {
    if (seen.has(player.playerRegistrationId)) {
      throw badRequest('A player cannot appear more than once in a lineup.');
    }
    seen.add(player.playerRegistrationId);
    if (shirtNumbers.has(player.shirtNumber)) {
      throw badRequest('Shirt numbers must be unique within a lineup.');
    }
    shirtNumbers.add(player.shirtNumber);
    const hasX = player.x !== undefined && player.x !== null;
    const hasY = player.y !== undefined && player.y !== null;
    if (hasX !== hasY) {
      throw badRequest('Pitch coordinates must be provided as a pair.');
    }
    if (player.role === 'starter' && (!hasX || !hasY)) {
      throw badRequest('Every starting player must have pitch coordinates.');
    }
    if (player.role === 'substitute' && player.isCaptain) {
      throw badRequest('The captain must be a starting player.');
    }
  }

  const registrations = await loadEligibleRegistrations(executor, [...seen]);
  if (registrations.size !== seen.size) {
    throw badRequest('One or more player registrations do not exist.');
  }
  for (const player of inputs) {
    const registration = registrations.get(player.playerRegistrationId)!;
    if (registration.teamRegistrationId !== teamRegistrationId) {
      throw badRequest('A selected player is registered to a different team.');
    }
    if (registration.seasonId !== scope.seasonId) {
      throw badRequest('A selected player is not registered for this season.');
    }
    if (registration.status !== 'approved' || !registration.eligibilityApproved) {
      throw conflict('Every selected player must hold an approved, eligible registration.');
    }
    if (registration.playerArchivedAt !== null) {
      throw conflict('Archived players cannot be selected.');
    }
    if (registration.teamEntryStatus !== 'approved') {
      throw conflict('The team entry is not approved.');
    }
    if (
      registration.shirtNumber !== null &&
      registration.shirtNumber !== player.shirtNumber
    ) {
      throw badRequest('The lineup shirt number must match the approved registration.');
    }
  }

  const starters = inputs.filter((player) => player.role === 'starter');
  const substitutes = inputs.filter((player) => player.role === 'substitute');

  if (substitutes.some((player) => !playerPositionCodes.includes(player.position as (typeof playerPositionCodes)[number]))) {
    throw badRequest('Every selected substitute needs a supported tactical position.');
  }

  const limit = await maxSubstitutesForSeason(executor, scope.seasonId);
  if (substitutes.length > limit) {
    throw badRequest(`At most ${limit} substitutes are permitted for this season.`);
  }

  if (!options.requireComplete) {
    return { formation, starters, substitutes };
  }

  if (!formation) {
    throw badRequest('A complete lineup requires a supported formation.');
  }
  if (starters.length !== 11) {
    throw badRequest('A complete starting XI requires exactly eleven starters.');
  }
  const captains = starters.filter((player) => player.isCaptain);
  if (captains.length !== 1) {
    throw badRequest('A complete starting XI requires exactly one captain.');
  }
  if (starters.filter((player) => player.position === 'GK').length !== 1) {
    throw badRequest('A complete starting XI must contain exactly one goalkeeper.');
  }
  const formationError = validateFormationPositions(
    formation,
    starters.map((player) => ({
      position: player.position,
      x: player.x ?? null,
      y: player.y ?? null,
    })),
  );
  if (formationError) throw badRequest(formationError);

  return { formation, starters, substitutes };
}

function playerInsertValues(
  lineupId: string,
  scope: MatchScope,
  teamRegistrationId: string,
  inputs: readonly LineupPlayerInput[],
) {
  return inputs.map((player) => ({
    lineupId,
    matchId: scope.matchId,
    teamRegistrationId,
    playerRegistrationId: player.playerRegistrationId,
    role: player.role,
    shirtNumber: player.shirtNumber,
    position: player.position,
    x: player.x === undefined || player.x === null ? null : player.x.toFixed(2),
    y: player.y === undefined || player.y === null ? null : player.y.toFixed(2),
    isCaptain: player.isCaptain ?? false,
  }));
}

async function replacePlayers(
  tx: Transaction,
  lineupId: string,
  scope: MatchScope,
  teamRegistrationId: string,
  inputs: readonly LineupPlayerInput[],
): Promise<void> {
  await tx.delete(lineupPlayers).where(eq(lineupPlayers.lineupId, lineupId));
  if (inputs.length > 0) {
    await tx.insert(lineupPlayers).values(
      playerInsertValues(lineupId, scope, teamRegistrationId, inputs),
    );
  }
}

async function loadLineupWithPlayers(executor: Executor, lineupId: string) {
  const [lineup] = await executor.select().from(lineups).where(eq(lineups.id, lineupId));
  if (!lineup) throw notFound('Lineup not found.');
  const roster = await executor
    .select()
    .from(lineupPlayers)
    .where(eq(lineupPlayers.lineupId, lineupId))
    .orderBy(asc(lineupPlayers.role), asc(lineupPlayers.shirtNumber));
  return { lineup, players: roster };
}

function currentPlayersAsInput(
  rows: (typeof lineupPlayers.$inferSelect)[],
): LineupPlayerInput[] {
  return rows.map((player) => ({
    playerRegistrationId: player.playerRegistrationId,
    role: player.role === 'substitute' ? 'substitute' : 'starter',
    position: (player.position ?? 'MF') as LineupPlayerInput['position'],
    shirtNumber: player.shirtNumber ?? 1,
    x: player.x === null ? null : Number(player.x),
    y: player.y === null ? null : Number(player.y),
    isCaptain: player.isCaptain,
  }));
}

async function auditLineup(
  tx: Transaction,
  auth: AuthContext,
  action: string,
  lineupId: string,
  before: unknown,
  after: unknown,
  reason: string | null,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: auth.userId,
    action,
    entityType: 'lineup',
    entityId: lineupId,
    before: before as Record<string, unknown> | null,
    after: after as Record<string, unknown> | null,
    reason,
  });
}

export async function createLineup(
  auth: AuthContext,
  matchId: string,
  teamRegistrationId: string,
  formation: string | null,
  inputs: readonly LineupPlayerInput[],
) {
  const context = await loadMatchContext(matchId);
  if (!context) throw notFound('Match not found.');
  if (!(await canManageTeamLineup(auth, context.scope, teamRegistrationId))) {
    throw forbidden('You may only manage lineups for your own team.');
  }
  await assertParticipantTeam(context.scope, teamRegistrationId);
  assertEditableByCaptain(context);

  const result = await db.transaction(async (tx) => {
    const locked = await lockMatch(tx, context.scope.fixtureId, matchId);
    const lockedContext = { ...context, match: locked.match, fixture: locked.fixture };
    if (!(await canManageTeamLineup(auth, context.scope, teamRegistrationId))) {
      throw forbidden('You may only manage lineups for your own team.');
    }
    assertEditableByCaptain(lockedContext);
    const validated = await validateLineupSelection(
      tx,
      context.scope,
      teamRegistrationId,
      formation,
      inputs,
      { requireComplete: false },
    );
    const [existing] = await tx
      .select({ id: lineups.id })
      .from(lineups)
      .where(
        and(
          eq(lineups.matchId, matchId),
          eq(lineups.teamRegistrationId, teamRegistrationId),
        ),
      )
      .for('update');
    if (existing) {
      throw conflict('A lineup already exists for this team and match.');
    }
    const [created] = await tx
      .insert(lineups)
      .values({
        matchId,
        teamRegistrationId,
        formation: validated.formation?.id ?? null,
        status: 'draft',
      })
      .returning();
    if (!created) throw conflict('The lineup could not be created.');
    if (inputs.length > 0) {
      await tx
        .insert(lineupPlayers)
        .values(playerInsertValues(created.id, context.scope, teamRegistrationId, inputs));
    }
    await auditLineup(
      tx,
      auth,
      'lineup.created',
      created.id,
      null,
      { ...created, players: inputs },
      null,
    );
    return loadLineupWithPlayers(tx, created.id);
  });

  return sanitizeLineup(result.lineup, result.players, true);
}

export async function getLineup(auth: AuthContext | null, lineupId: string) {
  const { context } = await loadContextForLineup(lineupId);
  const visibility = await resolveLineupVisibility(auth, context.scope);
  const result = await loadLineupWithPlayers(db, lineupId);
  if (!canSeeLineup(visibility, result.lineup)) throw notFound('Lineup not found.');
  return sanitizeLineup(
    result.lineup,
    result.players,
    visibility.all ||
      visibility.reviewer ||
      visibility.ownedTeamIds.includes(result.lineup.teamRegistrationId),
  );
}

export async function updateLineup(
  auth: AuthContext,
  lineupId: string,
  input: { formation?: string | null; players?: readonly LineupPlayerInput[]; reason?: string },
) {
  const { context } = await loadContextForLineup(lineupId);

  const result = await db.transaction(async (tx) => {
    const locked = await lockMatch(tx, context.scope.fixtureId, context.scope.matchId);
    const lockedContext = { ...context, match: locked.match, fixture: locked.fixture };
    const [existing] = await tx
      .select()
      .from(lineups)
      .where(eq(lineups.id, lineupId))
      .for('update');
    if (!existing) throw notFound('Lineup not found.');

    const admin = canManageCompetitionLineups(auth, context.scope.competitionId);
    const captain = await isTeamCaptain(auth.userId, existing.teamRegistrationId);
    if (!admin && !captain) {
      throw forbidden('You may only manage lineups for your own team.');
    }
    if (!admin) {
      assertEditableByCaptain(lockedContext);
      if (existing.status !== 'draft' && existing.status !== 'returned') {
        throw conflict('Only draft or returned lineups can be edited by the team captain.');
      }
    } else if (
      lockedContext.fixture.status === 'cancelled' ||
      lockedContext.fixture.status === 'abandoned'
    ) {
      throw conflict('Lineups cannot be edited for a cancelled or abandoned fixture.');
    }

    const correction =
      admin &&
      (existing.status === 'confirmed' ||
        existing.status === 'published' ||
        hasKickedOff(lockedContext.match, lockedContext.fixture));
    if (correction && !input.reason) {
      throw badRequest('An explicit reason is required for an administrative lineup correction.');
    }

    const roster = await tx
      .select()
      .from(lineupPlayers)
      .where(eq(lineupPlayers.lineupId, lineupId));
    const formation = input.formation === undefined ? existing.formation : input.formation;
    const inputs = input.players ?? currentPlayersAsInput(roster);
    const requireComplete = ['submitted', 'confirmed', 'published'].includes(existing.status);
    await validateLineupSelection(
      tx,
      context.scope,
      existing.teamRegistrationId,
      formation,
      inputs,
      { requireComplete },
    );

    const nextStatus = existing.status === 'returned' && !admin ? 'draft' : existing.status;
    const [updated] = await tx
      .update(lineups)
      .set({
        formation,
        status: nextStatus,
        updatedAt: new Date(),
        ...(nextStatus === 'draft' && existing.status === 'returned'
          ? { returnedAt: null, returnedBy: null, returnReason: null }
          : {}),
      })
      .where(eq(lineups.id, lineupId))
      .returning();
    if (!updated) throw notFound('Lineup not found.');

    if (input.players !== undefined) {
      await replacePlayers(tx, lineupId, context.scope, existing.teamRegistrationId, inputs);
    }

    await auditLineup(
      tx,
      auth,
      correction ? 'lineup.corrected' : 'lineup.updated',
      lineupId,
      { ...existing, players: roster },
      { ...updated, players: inputs },
      input.reason ?? null,
    );

    return loadLineupWithPlayers(tx, lineupId);
  });

  return sanitizeLineup(result.lineup, result.players, true);
}

async function transitionLineup(
  auth: AuthContext,
  lineupId: string,
  check: (
    tx: Transaction,
    context: MatchContextRow,
    lineup: typeof lineups.$inferSelect,
  ) => Promise<void> | void,
  values: Partial<typeof lineups.$inferInsert>,
  action: string,
  reason: string | null,
  notify?: (
    tx: Transaction,
    updated: typeof lineups.$inferSelect,
    context: MatchContextRow,
  ) => Promise<void>,
) {
  const { context } = await loadContextForLineup(lineupId);
  return db.transaction(async (tx) => {
    const locked = await lockMatch(tx, context.scope.fixtureId, context.scope.matchId);
    const lockedContext = { ...context, match: locked.match, fixture: locked.fixture };
    const [existing] = await tx
      .select()
      .from(lineups)
      .where(eq(lineups.id, lineupId))
      .for('update');
    if (!existing) throw notFound('Lineup not found.');
    await check(tx, lockedContext, existing);
    const [updated] = await tx
      .update(lineups)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(lineups.id, lineupId))
      .returning();
    if (!updated) throw notFound('Lineup not found.');
    await auditLineup(tx, auth, action, lineupId, existing, updated, reason);
    if (notify) await notify(tx, updated, lockedContext);
    return loadLineupWithPlayers(tx, lineupId);
  });
}

export async function submitLineup(auth: AuthContext, lineupId: string, reason?: string) {
  const result = await transitionLineup(
    auth,
    lineupId,
    async (tx, context, lineup) => {
      const admin = canManageCompetitionLineups(auth, context.scope.competitionId);
      const captain = await isTeamCaptain(auth.userId, lineup.teamRegistrationId);
      if (!admin && !captain) {
        throw forbidden('You may only submit lineups for your own team.');
      }
      if (!admin) assertEditableByCaptain(context);
      if (lineup.status !== 'draft' && lineup.status !== 'returned') {
        throw conflict('Only draft or returned lineups can be submitted.');
      }
      const roster = await tx
        .select()
        .from(lineupPlayers)
        .where(eq(lineupPlayers.lineupId, lineup.id));
      await validateLineupSelection(
        tx,
        context.scope,
        lineup.teamRegistrationId,
        lineup.formation,
        currentPlayersAsInput(roster),
        { requireComplete: true },
      );
    },
    { status: 'submitted', submittedAt: new Date() },
    'lineup.submitted',
    reason ?? null,
  );
  return sanitizeLineup(result.lineup, result.players, true);
}

export async function confirmLineup(auth: AuthContext, lineupId: string, reason?: string) {
  const { context: initialContext } = await loadContextForLineup(lineupId);
  if (!canReviewLineups(auth, initialContext.scope.competitionId)) {
    throw forbidden('Confirming a lineup requires competition administrative scope.');
  }

  const result = await transitionLineup(
    auth,
    lineupId,
    async (tx, context, lineup) => {
      if (!canReviewLineups(auth, context.scope.competitionId)) {
        throw forbidden('Confirming a lineup requires competition administrative scope.');
      }
      assertReviewable(context);
      if (lineup.status !== 'submitted' && lineup.status !== 'published') {
        throw conflict('Only submitted lineups can be confirmed.');
      }
      const roster = await tx
        .select()
        .from(lineupPlayers)
        .where(eq(lineupPlayers.lineupId, lineup.id));
      await validateLineupSelection(
        tx,
        context.scope,
        lineup.teamRegistrationId,
        lineup.formation,
        currentPlayersAsInput(roster),
        { requireComplete: true },
      );
    },
    {
      status: 'confirmed',
      confirmedAt: new Date(),
      confirmedBy: auth.userId,
      returnedAt: null,
      returnedBy: null,
      returnReason: null,
    },
    'lineup.confirmed',
    reason ?? null,
    async (tx, updated, context) => {
      await notifyTeamCaptain(tx, updated.teamRegistrationId, {
        type: 'lineup.confirmed',
        title: 'Lineup confirmed',
        body: 'Your lineup was confirmed by competition administration.',
        entityType: 'lineup',
        entityId: updated.id,
        competitionId: context.scope.competitionId,
        dedupeKey: `lineup-confirmed:${updated.id}:${updated.updatedAt.toISOString()}`,
      });
    },
  );

  const shaped = sanitizeLineup(result.lineup, result.players, false);
  broadcastToMatch(result.lineup.matchId, {
    type: 'lineup.update',
    reason: 'lineup.confirmed',
    at: new Date().toISOString(),
    lineup: {
      id: shaped.id,
      matchId: shaped.matchId,
      teamRegistrationId: shaped.teamRegistrationId,
      formation: shaped.formation,
      status: shaped.status,
      confirmedAt: shaped.confirmedAt,
      players: shaped.players,
    },
  });
  return shaped;
}

export async function returnLineup(auth: AuthContext, lineupId: string, reason: string) {
  const { context: initialContext } = await loadContextForLineup(lineupId);
  if (!canReviewLineups(auth, initialContext.scope.competitionId)) {
    throw forbidden('Returning a lineup requires competition administrative scope.');
  }
  const result = await transitionLineup(
    auth,
    lineupId,
    (_tx, context, lineup) => {
      if (!canReviewLineups(auth, context.scope.competitionId)) {
        throw forbidden('Returning a lineup requires competition administrative scope.');
      }
      assertReviewable(context);
      if (lineup.status !== 'submitted' && lineup.status !== 'confirmed') {
        throw conflict('Only submitted or confirmed lineups can be returned.');
      }
    },
    {
      status: 'returned',
      returnedAt: new Date(),
      returnedBy: auth.userId,
      returnReason: reason,
      confirmedAt: null,
      confirmedBy: null,
    },
    'lineup.returned',
    reason,
    async (tx, updated, context) => {
      await notifyTeamCaptain(tx, updated.teamRegistrationId, {
        type: 'lineup.returned',
        title: 'Lineup returned',
        body: `Your lineup was returned for adjustment: ${reason}`,
        entityType: 'lineup',
        entityId: updated.id,
        competitionId: context.scope.competitionId,
        dedupeKey: `lineup-returned:${updated.id}:${updated.updatedAt.toISOString()}`,
      });
    },
  );
  return sanitizeLineup(result.lineup, result.players, true);
}

export async function withdrawLineup(auth: AuthContext, lineupId: string, reason?: string) {
  const initial = await loadContextForLineup(lineupId);
  const initialContext = initial.context;
  const admin = canManageCompetitionLineups(auth, initialContext.scope.competitionId);
  if (!admin && !(await isTeamCaptain(auth.userId, initial.lineup.teamRegistrationId))) {
    throw forbidden('You may only withdraw lineups for your own team.');
  }
  const result = await transitionLineup(
    auth,
    lineupId,
    async (_tx, context, lineup) => {
      const isAdmin = canManageCompetitionLineups(auth, context.scope.competitionId);
      if (!isAdmin && !(await isTeamCaptain(auth.userId, lineup.teamRegistrationId))) {
        throw forbidden('You may only withdraw lineups for your own team.');
      }
      if (!isAdmin) assertEditableByCaptain(context);
      else if (
        context.fixture.status === 'cancelled' ||
        context.fixture.status === 'abandoned'
      ) {
        throw conflict('Lineups cannot be withdrawn for a cancelled or abandoned fixture.');
      }
      if (lineup.status === 'draft') {
        throw conflict('The lineup is already a draft.');
      }
    },
    {
      status: 'draft',
      submittedAt: null,
      confirmedAt: null,
      confirmedBy: null,
      returnedAt: null,
      returnedBy: null,
      returnReason: null,
    },
    'lineup.withdrawn',
    reason ?? null,
  );
  return sanitizeLineup(result.lineup, result.players, true);
}

export async function getMatchLineups(auth: AuthContext | null, matchId: string) {
  const scope = await loadMatchScope(matchId);
  if (!scope) throw notFound('Match not found.');
  const visibility = await resolveLineupVisibility(auth, scope);
  if (
    !visibility.all &&
    !visibility.publicMatch &&
    visibility.ownedTeamIds.length === 0
  ) {
    throw notFound('Match not found.');
  }
  return loadVisibleMatchLineups(auth, scope, visibility);
}

export async function listLineupHistory(auth: AuthContext, query: LineupListQuery) {
  const conditions: SQL[] = [];
  const allowedCompetitionIds = new Set<string>();

  if (query.teamRegistrationId) {
    const [entry] = await db
      .select({ seasonId: teamRegistrations.seasonId, competitionId: seasons.competitionId })
      .from(teamRegistrations)
      .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
      .where(eq(teamRegistrations.id, query.teamRegistrationId));
    if (!entry) throw notFound('Team entry not found.');
    const admin = canManageCompetitionLineups(auth, entry.competitionId);
    if (!admin && !(await isTeamCaptain(auth.userId, query.teamRegistrationId))) {
      throw notFound('Team entry not found.');
    }
    conditions.push(eq(lineups.teamRegistrationId, query.teamRegistrationId));
    allowedCompetitionIds.add(entry.competitionId);
  } else if (query.matchId) {
    const scope = await loadMatchScope(query.matchId);
    if (!scope) throw notFound('Match not found.');
    const visibility = await resolveLineupVisibility(auth, scope);
    if (
      !visibility.all &&
      !visibility.publicMatch &&
      visibility.ownedTeamIds.length === 0
    ) {
      throw notFound('Match not found.');
    }
    conditions.push(eq(lineups.matchId, query.matchId));
    if (!visibility.all) {
      const visibleLineup = visibility.publicMatch
        ? or(
            inArray(lineups.teamRegistrationId, visibility.ownedTeamIds),
            inArray(lineups.status, ['confirmed', 'published']),
          )
        : inArray(lineups.teamRegistrationId, visibility.ownedTeamIds);
      if (visibleLineup) conditions.push(visibleLineup);
    }
    allowedCompetitionIds.add(scope.competitionId);
  } else {
    const scopes = new Set<string>();
    if (query.competitionId) scopes.add(query.competitionId);
    if (query.seasonId) {
      const [season] = await db
        .select({ competitionId: seasons.competitionId })
        .from(seasons)
        .where(eq(seasons.id, query.seasonId));
      if (!season) throw notFound('Season not found.');
      scopes.add(season.competitionId);
      conditions.push(eq(teamRegistrations.seasonId, query.seasonId));
    }
    if (scopes.size === 0) {
      throw badRequest('Filter lineup history by team, match, season or competition.');
    }
    for (const competitionId of scopes) {
      if (canManageCompetitionLineups(auth, competitionId)) {
        allowedCompetitionIds.add(competitionId);
        continue;
      }
      const captainEntries = await db
        .select({ id: teamRegistrations.id })
        .from(teamRegistrations)
        .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
        .where(
          and(
            eq(teamRegistrations.captainUserId, auth.userId),
            eq(seasons.competitionId, competitionId),
            ...(query.seasonId ? [eq(teamRegistrations.seasonId, query.seasonId)] : []),
          ),
        );
      if (captainEntries.length === 0) continue;
      allowedCompetitionIds.add(competitionId);
      conditions.push(
        inArray(lineups.teamRegistrationId, captainEntries.map((row) => row.id)),
      );
    }
    if (allowedCompetitionIds.size === 0) {
      throw notFound('No lineup history is visible to you.');
    }
  }

  if (query.competitionId && !allowedCompetitionIds.has(query.competitionId)) {
    throw notFound('No lineup history is visible to you.');
  }
  if (query.status) conditions.push(eq(lineups.status, query.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select({ lineup: lineups })
    .from(lineups)
    .innerJoin(teamRegistrations, eq(lineups.teamRegistrationId, teamRegistrations.id))
    .where(where)
    .orderBy(desc(lineups.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  const items = await Promise.all(
    rows.map(async (row) => {
      const roster = await db
        .select()
        .from(lineupPlayers)
        .where(eq(lineupPlayers.lineupId, row.lineup.id));
      return sanitizeLineup(row.lineup, roster, true);
    }),
  );
  return { items, limit: query.limit, offset: query.offset };
}

export async function getLineupsForMatchDetail(auth: AuthContext | null, matchId: string) {
  const scope = await loadMatchScope(matchId);
  if (!scope) return [];
  return loadVisibleMatchLineups(auth, scope);
}
