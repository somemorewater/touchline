import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  competitions,
  players,
  playerRegistrationEdits,
  playerRegistrations,
  seasons,
  teamRegistrations,
  teams,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import {
  competitionScopesFor,
  hasPermission,
  isSuperAdmin,
} from '../../security/context.js';
import {
  canManageCompetition,
  canReviewRegistrationsIn,
} from '../../security/access.js';
import { PERMISSIONS } from '../../security/permissions.js';
import { notifyTeamCaptain } from '../notifications/service.js';
import type {
  playerRegistrationListQuerySchema,
  playerRegistrationRejectSchema,
  playerRegistrationReviewSchema,
  playerRegistrationSubmitSchema,
  playerRegistrationEditSchema,
  playerRegistrationEditReviewSchema,
} from './schemas.js';
import type { z } from 'zod';

type SubmitInput = z.infer<typeof playerRegistrationSubmitSchema>;
type ListQuery = z.infer<typeof playerRegistrationListQuerySchema>;
type ReviewInput = z.infer<typeof playerRegistrationReviewSchema>;
type RejectInput = z.infer<typeof playerRegistrationRejectSchema>;
type EditInput = z.infer<typeof playerRegistrationEditSchema>;
type EditReviewInput = z.infer<typeof playerRegistrationEditReviewSchema>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ACTIVE_STATUSES = ['submitted', 'under_review', 'approved'] as const;

interface RegistrationScope {
  registration: typeof playerRegistrations.$inferSelect;
  player: typeof players.$inferSelect;
  entry: typeof teamRegistrations.$inferSelect;
  team: typeof teams.$inferSelect;
  season: typeof seasons.$inferSelect;
  competition: typeof competitions.$inferSelect;
}

async function loadRegistrationScope(
  registrationId: string,
  executor: Transaction | typeof db = db,
): Promise<RegistrationScope> {
  const [row] = await executor
    .select({
      registration: playerRegistrations,
      player: players,
      entry: teamRegistrations,
      team: teams,
      season: seasons,
      competition: competitions,
    })
    .from(playerRegistrations)
    .innerJoin(players, eq(playerRegistrations.playerId, players.id))
    .innerJoin(
      teamRegistrations,
      eq(playerRegistrations.teamRegistrationId, teamRegistrations.id),
    )
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .innerJoin(seasons, eq(playerRegistrations.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(playerRegistrations.id, registrationId));
  if (!row) throw notFound('Player registration not found.');
  return row;
}

function canViewRegistration(auth: AuthContext, scope: RegistrationScope): boolean {
  if (isSuperAdmin(auth)) return true;
  if (scope.entry.captainUserId === auth.userId) return true;
  return (
    canManageCompetition(auth, PERMISSIONS.playersRead, scope.competition.id) ||
    canReviewRegistrationsIn(auth, scope.competition.id)
  );
}

async function writeAudit(
  tx: Transaction,
  actorUserId: string,
  action: string,
  registrationId: string,
  before: unknown,
  after: unknown,
  reason?: string | null,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId,
    action,
    entityType: 'player_registration',
    entityId: registrationId,
    before: before ?? null,
    after: after ?? null,
    reason: reason ?? null,
  });
}

async function assertNoActiveSeasonRegistration(
  executor: Transaction | typeof db,
  playerId: string,
  seasonId: string,
  excludeId?: string,
): Promise<void> {
  const conditions: SQL[] = [
    eq(playerRegistrations.playerId, playerId),
    eq(playerRegistrations.seasonId, seasonId),
    inArray(playerRegistrations.status, [...ACTIVE_STATUSES]),
  ];
  if (excludeId) conditions.push(ne(playerRegistrations.id, excludeId));
  const [row] = await executor
    .select({ id: playerRegistrations.id })
    .from(playerRegistrations)
    .where(and(...conditions))
    .limit(1);
  if (row) {
    throw conflict('The player already has an active registration in this season.');
  }
}

async function assertMatriculationAvailable(
  executor: Transaction | typeof db,
  seasonId: string,
  matriculationNumber: string | null,
  excludeId?: string,
): Promise<void> {
  if (!matriculationNumber) return;
  const conditions: SQL[] = [
    eq(playerRegistrations.seasonId, seasonId),
    eq(playerRegistrations.matriculationNumber, matriculationNumber),
    inArray(playerRegistrations.status, [...ACTIVE_STATUSES]),
  ];
  if (excludeId) conditions.push(ne(playerRegistrations.id, excludeId));
  const [row] = await executor
    .select({ id: playerRegistrations.id })
    .from(playerRegistrations)
    .where(and(...conditions))
    .limit(1);
  if (row) {
    throw conflict('This matriculation number is already actively registered in the season.');
  }
}

async function assertShirtNumberAvailable(
  executor: Transaction | typeof db,
  teamRegistrationId: string,
  shirtNumber: number | null,
  excludeId?: string,
): Promise<void> {
  if (shirtNumber === null) return;
  const conditions: SQL[] = [
    eq(playerRegistrations.teamRegistrationId, teamRegistrationId),
    eq(playerRegistrations.shirtNumber, shirtNumber),
  ];
  if (excludeId) conditions.push(ne(playerRegistrations.id, excludeId));
  const [row] = await executor
    .select({ id: playerRegistrations.id })
    .from(playerRegistrations)
    .where(and(...conditions))
    .limit(1);
  if (row) throw conflict('This shirt number is already used in the team entry.');
}

async function assertEntryEligibleForRegistration(
  executor: Transaction | typeof db,
  teamRegistrationId: string,
  seasonId: string,
) {
  const [row] = await executor
    .select({
      entry: teamRegistrations,
      team: teams,
      season: seasons,
      competition: competitions,
    })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(
      and(
        eq(teamRegistrations.id, teamRegistrationId),
        eq(teamRegistrations.seasonId, seasonId),
      ),
    );
  if (!row) throw badRequest('The team entry does not belong to the registration season.');
  if (row.entry.status !== 'approved') {
    throw conflict('Player registrations require an approved team entry.');
  }
  if (row.team.archivedAt) throw conflict('Archived teams cannot register players.');
  if (row.season.status !== 'planned' && row.season.status !== 'active') {
    throw conflict('Player registrations require a planned or active season.');
  }
  if (row.competition.status === 'archived') {
    throw conflict('Archived competitions are read-only.');
  }
  return row;
}

async function registrationDetail(
  executor: Transaction | typeof db,
  registrationId: string,
) {
  const scope = await loadRegistrationScope(registrationId, executor);
  const [pendingEdit] = await executor.select().from(playerRegistrationEdits).where(and(eq(playerRegistrationEdits.registrationId, registrationId), eq(playerRegistrationEdits.status, 'pending'))).limit(1);
  return {
    ...scope.registration,
    player: scope.player,
    team: scope.team,
    teamRegistration: scope.entry,
    season: scope.season,
    competition: scope.competition,
    pendingEdit: pendingEdit ?? null,
  };
}

export async function submitPlayerRegistration(
  auth: AuthContext,
  input: SubmitInput,
) {
  const [entry] = await db
    .select()
    .from(teamRegistrations)
    .where(eq(teamRegistrations.id, input.teamRegistrationId));
  if (!entry) throw notFound('Team entry not found.');
  if (entry.captainUserId !== auth.userId) {
    throw forbidden('Only the assigned team captain can submit registrations for this team.');
  }

  await assertEntryEligibleForRegistration(
    db,
    input.teamRegistrationId,
    entry.seasonId,
  );

  let player = null as typeof players.$inferSelect | null;
  if (input.playerId) {
    const [existingPlayer] = await db
      .select()
      .from(players)
      .where(eq(players.id, input.playerId));
    if (!existingPlayer) throw badRequest('playerId does not identify a player.');
    if (existingPlayer.archivedAt) throw conflict('Archived players cannot be registered.');
    player = existingPlayer;
  } else if (input.player?.dateOfBirth) {
    const [duplicate] = await db
      .select({ id: players.id })
      .from(players)
      .where(
        and(
          isNull(players.archivedAt),
          sql`lower(${players.fullName}) = ${input.player.fullName.toLowerCase()}`,
          eq(players.dateOfBirth, input.player.dateOfBirth),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw conflict(
        `A matching player already exists (${duplicate.id}). Submit with playerId instead.`,
      );
    }
  }

  const requestedMatriculation =
    input.matriculationNumber === undefined
      ? undefined
      : input.matriculationNumber?.trim() || null;
  const requestedShirtNumber = input.shirtNumber;

  return db.transaction(async (tx) => {
    const [lockedEntry] = await tx
      .select({ id: teamRegistrations.id })
      .from(teamRegistrations)
      .where(eq(teamRegistrations.id, input.teamRegistrationId))
      .for('update');
    if (!lockedEntry) throw notFound('Team entry not found.');

    let activePlayer = player;
    if (input.playerId) {
      const [currentPlayer] = await tx
        .select()
        .from(players)
        .where(eq(players.id, input.playerId))
        .for('update');
      if (!currentPlayer) throw badRequest('playerId does not identify a player.');
      if (currentPlayer.archivedAt) {
        throw conflict('Archived players cannot be registered.');
      }
      activePlayer = currentPlayer;
    }
    if (!activePlayer && input.player) {
      const [created] = await tx
        .insert(players)
        .values({
          fullName: input.player.fullName,
          department: input.player.department ?? null,
          dateOfBirth: input.player.dateOfBirth ?? null,
          position: input.player.position ?? null,
          preferredFoot: input.player.preferredFoot ?? null,
          contactEmail: input.player.contactEmail ?? null,
        })
        .returning();
      if (!created) throw new Error('Player insert did not return a row.');
      activePlayer = created;
    }
    if (!activePlayer) throw badRequest('A player is required.');

    await assertEntryEligibleForRegistration(
      tx,
      input.teamRegistrationId,
      entry.seasonId,
    );
    await assertNoActiveSeasonRegistration(
      tx,
      activePlayer.id,
      entry.seasonId,
    );

    const [existing] = await tx
      .select()
      .from(playerRegistrations)
      .where(
        and(
          eq(playerRegistrations.playerId, activePlayer.id),
          eq(playerRegistrations.teamRegistrationId, input.teamRegistrationId),
        ),
      )
      .for('update');

    if (existing && (ACTIVE_STATUSES as readonly string[]).includes(existing.status)) {
      throw conflict('This player already has an active registration for the team entry.');
    }

    const matriculationNumber =
      requestedMatriculation === undefined
        ? (existing?.matriculationNumber ?? null)
        : requestedMatriculation;
    const shirtNumber =
      requestedShirtNumber === undefined
        ? (existing?.shirtNumber ?? null)
        : requestedShirtNumber;
    await assertMatriculationAvailable(
      tx,
      entry.seasonId,
      matriculationNumber,
      existing?.id,
    );
    await assertShirtNumberAvailable(
      tx,
      input.teamRegistrationId,
      shirtNumber,
      existing?.id,
    );

    const now = new Date();
    let registration: typeof playerRegistrations.$inferSelect;
    if (existing) {
      const [updated] = await tx
        .update(playerRegistrations)
        .set({
          matriculationNumber,
          shirtNumber,
          status: 'submitted',
          eligibilityApproved: false,
          submittedAt: now,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          updatedAt: now,
        })
        .where(eq(playerRegistrations.id, existing.id))
        .returning();
      if (!updated) throw new Error('Registration update did not return a row.');
      registration = updated;
      await writeAudit(
        tx,
        auth.userId,
        'player_registration.resubmitted',
        updated.id,
        existing,
        updated,
        null,
      );
    } else {
      const [created] = await tx
        .insert(playerRegistrations)
        .values({
          playerId: activePlayer.id,
          teamRegistrationId: input.teamRegistrationId,
          seasonId: entry.seasonId,
          matriculationNumber,
          shirtNumber,
          status: 'submitted',
          submittedAt: now,
        })
        .returning();
      if (!created) throw new Error('Registration insert did not return a row.');
      registration = created;
      await writeAudit(
        tx,
        auth.userId,
        'player_registration.submitted',
        created.id,
        null,
        created,
        null,
      );
    }

    return {
      ...(await registrationDetail(tx, registration.id)),
    };
  });
}

export async function listPlayerRegistrations(
  auth: AuthContext,
  filters: ListQuery,
) {
  const globalReviewer =
    isSuperAdmin(auth) || hasPermission(auth, PERMISSIONS.registrationsReview);
  const scopes = competitionScopesFor(auth, PERMISSIONS.registrationsReview);

  const conditions: SQL[] = [];
  if (filters.competitionId) {
    conditions.push(eq(seasons.competitionId, filters.competitionId));
  }
  if (filters.seasonId) {
    conditions.push(eq(playerRegistrations.seasonId, filters.seasonId));
  }
  if (filters.teamId) {
    conditions.push(eq(teamRegistrations.teamId, filters.teamId));
  }
  if (filters.teamRegistrationId) {
    conditions.push(
      eq(playerRegistrations.teamRegistrationId, filters.teamRegistrationId),
    );
  }
  if (filters.status) conditions.push(eq(playerRegistrations.status, filters.status));

  if (!globalReviewer) {
    const [captainEntry] = await db
      .select({ id: teamRegistrations.id })
      .from(teamRegistrations)
      .where(eq(teamRegistrations.captainUserId, auth.userId))
      .limit(1);

    if (scopes.length === 0 && !captainEntry) {
      throw forbidden('Registration review requires an administrative scope.');
    }
    const visibility: SQL[] = [eq(teamRegistrations.captainUserId, auth.userId)];
    if (scopes.length > 0) {
      visibility.push(inArray(seasons.competitionId, scopes));
    }
    conditions.push(or(...visibility)!);
  }

  const rows = await db
    .select({
      registration: playerRegistrations,
      player: players,
      entry: teamRegistrations,
      team: teams,
      season: seasons,
      competition: competitions,
    })
    .from(playerRegistrations)
    .innerJoin(players, eq(playerRegistrations.playerId, players.id))
    .innerJoin(
      teamRegistrations,
      eq(playerRegistrations.teamRegistrationId, teamRegistrations.id),
    )
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .innerJoin(seasons, eq(playerRegistrations.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(playerRegistrations.createdAt));

  return Promise.all(rows.map(async row => ({
    ...row.registration,
    player: row.player,
    team: row.team,
    teamRegistration: row.entry,
    season: row.season,
    competition: row.competition,
    pendingEdit: (await db.select().from(playerRegistrationEdits).where(and(eq(playerRegistrationEdits.registrationId, row.registration.id), eq(playerRegistrationEdits.status, 'pending'))).limit(1))[0] ?? null,
  })));
}

export async function getPlayerRegistration(
  auth: AuthContext,
  registrationId: string,
) {
  const scope = await loadRegistrationScope(registrationId);
  if (!canViewRegistration(auth, scope)) throw notFound('Player registration not found.');
  return registrationDetail(db, registrationId);
}

export async function reviewPlayerRegistration(
  auth: AuthContext,
  registrationId: string,
  input: ReviewInput,
) {
  const scope = await loadRegistrationScope(registrationId);
  if (!canReviewRegistrationsIn(auth, scope.competition.id)) {
    throw forbidden('Registration review requires administrative scope.');
  }
  if (scope.entry.captainUserId === auth.userId) {
    throw forbidden('A captain cannot review their own team registrations.');
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(playerRegistrations)
      .where(eq(playerRegistrations.id, registrationId))
      .for('update');
    if (!current) throw notFound('Player registration not found.');
    if (current.status === 'under_review') {
      throw conflict('This registration is already under review.');
    }
    if (current.status !== 'submitted') {
      throw conflict(`Cannot review a registration in status "${current.status}".`);
    }
    const now = new Date();
    const [updated] = await tx
      .update(playerRegistrations)
      .set({
        status: 'under_review',
        reviewedBy: auth.userId,
        reviewedAt: now,
        reviewNote: input.reviewNote ?? null,
        updatedAt: now,
      })
      .where(eq(playerRegistrations.id, registrationId))
      .returning();
    if (!updated) throw new Error('Registration update did not return a row.');
    await writeAudit(
      tx,
      auth.userId,
      'player_registration.under_review',
      registrationId,
      current,
      updated,
      input.reviewNote ?? null,
    );
    return registrationDetail(tx, registrationId);
  });
}

export async function approvePlayerRegistration(
  auth: AuthContext,
  registrationId: string,
  input: ReviewInput,
) {
  const scope = await loadRegistrationScope(registrationId);
  if (!canReviewRegistrationsIn(auth, scope.competition.id)) {
    throw forbidden('Registration approval requires administrative scope.');
  }
  if (scope.entry.captainUserId === auth.userId) {
    throw forbidden('A captain cannot approve their own team registrations.');
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(playerRegistrations)
      .where(eq(playerRegistrations.id, registrationId))
      .for('update');
    if (!current) throw notFound('Player registration not found.');
    if (current.status === 'approved') {
      throw conflict('This registration is already approved.');
    }
    if (current.status !== 'submitted' && current.status !== 'under_review') {
      throw conflict(`Cannot approve a registration in status "${current.status}".`);
    }

    const [entryLock] = await tx
      .select({ id: teamRegistrations.id })
      .from(teamRegistrations)
      .where(eq(teamRegistrations.id, current.teamRegistrationId))
      .for('update');
    if (!entryLock) throw notFound('Team entry not found.');
    const eligible = await assertEntryEligibleForRegistration(
      tx,
      current.teamRegistrationId,
      current.seasonId,
    );
    const [player] = await tx
      .select()
      .from(players)
      .where(eq(players.id, current.playerId))
      .for('update');
    if (!player) throw notFound('Player not found.');
    if (player.archivedAt) throw conflict('Archived players cannot be approved.');
    await assertNoActiveSeasonRegistration(
      tx,
      current.playerId,
      current.seasonId,
      current.id,
    );
    await assertMatriculationAvailable(
      tx,
      current.seasonId,
      current.matriculationNumber,
      current.id,
    );
    await assertShirtNumberAvailable(
      tx,
      current.teamRegistrationId,
      current.shirtNumber,
      current.id,
    );

    const now = new Date();
    const [updated] = await tx
      .update(playerRegistrations)
      .set({
        status: 'approved',
        eligibilityApproved: true,
        reviewedBy: auth.userId,
        reviewedAt: now,
        reviewNote:
          input.reviewNote !== undefined ? input.reviewNote : current.reviewNote,
        updatedAt: now,
      })
      .where(eq(playerRegistrations.id, registrationId))
      .returning();
    if (!updated) throw new Error('Registration update did not return a row.');

    await writeAudit(
      tx,
      auth.userId,
      'player_registration.approved',
      registrationId,
      current,
      updated,
      `competition=${eligible.competition.id}`,
    );
    await notifyTeamCaptain(tx, current.teamRegistrationId, {
      type: 'registration.approved',
      title: 'Player registration approved',
      body: `A player registration for ${scope.team.name} was approved.`,
      entityType: 'player_registration',
      entityId: registrationId,
      competitionId: scope.competition.id,
      dedupeKey: `registration-approved:${registrationId}:${updated.updatedAt.toISOString()}`,
    });
    return registrationDetail(tx, registrationId);
  });
}

export async function rejectPlayerRegistration(
  auth: AuthContext,
  registrationId: string,
  input: RejectInput,
) {
  const scope = await loadRegistrationScope(registrationId);
  if (!canReviewRegistrationsIn(auth, scope.competition.id)) {
    throw forbidden('Registration rejection requires administrative scope.');
  }
  if (scope.entry.captainUserId === auth.userId) {
    throw forbidden('A captain cannot reject their own team registrations.');
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(playerRegistrations)
      .where(eq(playerRegistrations.id, registrationId))
      .for('update');
    if (!current) throw notFound('Player registration not found.');
    if (current.status !== 'submitted' && current.status !== 'under_review') {
      throw conflict(`Cannot reject a registration in status "${current.status}".`);
    }
    const now = new Date();
    const [updated] = await tx
      .update(playerRegistrations)
      .set({
        status: 'rejected',
        eligibilityApproved: false,
        reviewedBy: auth.userId,
        reviewedAt: now,
        reviewNote: input.reason,
        updatedAt: now,
      })
      .where(eq(playerRegistrations.id, registrationId))
      .returning();
    if (!updated) throw new Error('Registration update did not return a row.');
    await writeAudit(
      tx,
      auth.userId,
      'player_registration.rejected',
      registrationId,
      current,
      updated,
      input.reason,
    );
    await notifyTeamCaptain(tx, current.teamRegistrationId, {
      type: 'registration.rejected',
      title: 'Player registration rejected',
      body: `A player registration for ${scope.team.name} was rejected: ${input.reason}`,
      entityType: 'player_registration',
      entityId: registrationId,
      competitionId: scope.competition.id,
      dedupeKey: `registration-rejected:${registrationId}:${updated.updatedAt.toISOString()}`,
    });
    return registrationDetail(tx, registrationId);
  });
}

export async function withdrawPlayerRegistration(
  auth: AuthContext,
  registrationId: string,
) {
  const scope = await loadRegistrationScope(registrationId);
  if (scope.entry.captainUserId !== auth.userId) {
    throw forbidden('Only the assigned team captain can withdraw this registration.');
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(playerRegistrations)
      .where(eq(playerRegistrations.id, registrationId))
      .for('update');
    if (!current) throw notFound('Player registration not found.');
    if (current.status !== 'submitted' && current.status !== 'under_review') {
      throw conflict(`Cannot withdraw a registration in status "${current.status}".`);
    }
    const now = new Date();
    const [updated] = await tx
      .update(playerRegistrations)
      .set({
        status: 'withdrawn',
        eligibilityApproved: false,
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: now,
      })
      .where(eq(playerRegistrations.id, registrationId))
      .returning();
    if (!updated) throw new Error('Registration update did not return a row.');
    await writeAudit(
      tx,
      auth.userId,
      'player_registration.withdrawn',
      registrationId,
      current,
      updated,
      'Withdrawn by the team captain.',
    );
    return registrationDetail(tx, registrationId);
  });
}

export async function proposePlayerRegistrationEdit(auth: AuthContext, registrationId: string, input: EditInput) {
  const scope = await loadRegistrationScope(registrationId);
  if (scope.entry.captainUserId !== auth.userId) throw forbidden('Only the assigned captain can propose registration edits.');
  if (scope.registration.status !== 'approved' || !scope.registration.eligibilityApproved) {
    throw conflict('Only an approved registration can receive a proposed edit.');
  }
  const proposed: Record<string, unknown> = {};
  if (input.player) proposed.player = input.player;
  if (input.matriculationNumber !== undefined) proposed.matriculationNumber = input.matriculationNumber;
  if (input.shirtNumber !== undefined) proposed.shirtNumber = input.shirtNumber;
  return db.transaction(async tx => {
    const [current] = await tx.select().from(playerRegistrations).where(eq(playerRegistrations.id, registrationId)).for('update');
    if (!current || current.status !== 'approved') throw conflict('Registration is no longer approved.');
    const [pending] = await tx.select({ id: playerRegistrationEdits.id }).from(playerRegistrationEdits).where(and(eq(playerRegistrationEdits.registrationId, registrationId), eq(playerRegistrationEdits.status, 'pending'))).limit(1);
    if (pending) throw conflict('A registration edit is already awaiting review.');
    const [edit] = await tx.insert(playerRegistrationEdits).values({ registrationId, proposedBy: auth.userId, proposed }).returning();
    await writeAudit(tx, auth.userId, 'player_registration.edit_submitted', registrationId, current, { editId: edit!.id, proposed });
    return { registration: await registrationDetail(tx, registrationId), pendingEdit: edit };
  });
}

export async function reviewPlayerRegistrationEdit(auth: AuthContext, registrationId: string, editId: string, input: EditReviewInput) {
  const scope = await loadRegistrationScope(registrationId);
  if (!canReviewRegistrationsIn(auth, scope.competition.id) || scope.entry.captainUserId === auth.userId) {
    throw forbidden('Registration edit review requires authorized administrative scope.');
  }
  return db.transaction(async tx => {
    const [edit] = await tx.select().from(playerRegistrationEdits).where(and(eq(playerRegistrationEdits.id, editId), eq(playerRegistrationEdits.registrationId, registrationId))).for('update');
    if (!edit || edit.status !== 'pending') throw notFound('Pending registration edit not found.');
    const [current] = await tx.select().from(playerRegistrations).where(eq(playerRegistrations.id, registrationId)).for('update');
    if (!current || current.status !== 'approved') throw conflict('The registration must remain approved while edits are reviewed.');
    if (input.decision === 'approve') {
      const proposed = edit.proposed as { player?: Record<string, unknown>; matriculationNumber?: string | null; shirtNumber?: number | null };
      const playerPatch = (proposed.player ?? {}) as Partial<typeof players.$inferInsert>;
      const regPatch = { ...(proposed.matriculationNumber !== undefined ? { matriculationNumber: proposed.matriculationNumber } : {}), ...(proposed.shirtNumber !== undefined ? { shirtNumber: proposed.shirtNumber } : {}) };
      if (regPatch.matriculationNumber !== undefined) await assertMatriculationAvailable(tx, current.seasonId, regPatch.matriculationNumber, current.id);
      if (regPatch.shirtNumber !== undefined) await assertShirtNumberAvailable(tx, current.teamRegistrationId, regPatch.shirtNumber, current.id);
      const [updatedPlayer] = Object.keys(playerPatch).length ? await tx.update(players).set({ ...playerPatch, updatedAt: new Date() }).where(eq(players.id, current.playerId)).returning() : [null];
      const [updatedReg] = Object.keys(regPatch).length ? await tx.update(playerRegistrations).set({ ...regPatch, updatedAt: new Date() }).where(eq(playerRegistrations.id, registrationId)).returning() : [current];
      const [updatedEdit] = await tx.update(playerRegistrationEdits).set({ status: 'approved', reviewedBy: auth.userId, reviewedAt: new Date(), reviewNote: input.reviewNote ?? null, updatedAt: new Date() }).where(eq(playerRegistrationEdits.id, editId)).returning();
      await writeAudit(tx, auth.userId, 'player_registration.edit_approved', registrationId, { registration: current, player: scope.player, edit }, { registration: updatedReg, player: updatedPlayer ?? scope.player, edit: updatedEdit }, input.reviewNote);
    } else {
      const [updatedEdit] = await tx.update(playerRegistrationEdits).set({ status: 'rejected', reviewedBy: auth.userId, reviewedAt: new Date(), reviewNote: input.reviewNote ?? 'Proposed changes rejected.', updatedAt: new Date() }).where(eq(playerRegistrationEdits.id, editId)).returning();
      await writeAudit(tx, auth.userId, 'player_registration.edit_rejected', registrationId, edit, updatedEdit, input.reviewNote);
    }
    return { registration: await registrationDetail(tx, registrationId), edit: (await tx.select().from(playerRegistrationEdits).where(eq(playerRegistrationEdits.id, editId)))[0] };
  });
}

export async function getPlayerRegistrationHistory(
  auth: AuthContext,
  registrationId: string,
) {
  const scope = await loadRegistrationScope(registrationId);
  if (!canViewRegistration(auth, scope)) throw notFound('Player registration not found.');

  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'player_registration'),
        eq(auditLogs.entityId, registrationId),
      ),
    )
    .orderBy(asc(auditLogs.createdAt));
}
