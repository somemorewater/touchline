import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  competitions,
  disciplinaryCaseEntries,
  disciplinaryCases,
  disciplinarySanctions,
  fixtures,
  matchEvents,
  matches,
  playerRegistrations,
  seasons,
  teamRegistrations,
  userRoles,
  roles,
  users,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import {
  competitionScopesFor,
  hasPermissionInCompetition,
  isSuperAdmin,
  type AuthContext,
} from '../../security/context.js';
import {
  canManageCompetition,
  isCompetitionAdministrator,
  isTeamCaptain,
  loadMatchScope,
} from '../../security/access.js';
import { PERMISSIONS, ROLES } from '../../security/permissions.js';
import {
  canManageCase,
  canReviewCase,
  loadCaseScope,
  requireCaseManage,
  requireCaseReview,
  requireCaseView,
} from './access.js';
import {
  competitionAdministratorIds,
  createNotification,
} from '../notifications/service.js';
import { sanitizeAuditValue } from '../audit/service.js';
import type {
  disciplinaryAppealSchema,
  disciplinaryAssignSchema,
  disciplinaryAwaitingResponseSchema,
  disciplinaryCaseCreateSchema,
  disciplinaryCloseSchema,
  disciplinaryDecisionSchema,
  disciplinaryFindingSchema,
  disciplinaryListQuerySchema,
  disciplinaryNoteSchema,
  disciplinaryReviewSchema,
  disciplinarySanctionCreateSchema,
} from './schemas.js';
import type { z } from 'zod';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CaseCreate = z.infer<typeof disciplinaryCaseCreateSchema>;
type ListQuery = z.infer<typeof disciplinaryListQuerySchema>;
type AssignInput = z.infer<typeof disciplinaryAssignSchema>;
type ReviewInput = z.infer<typeof disciplinaryReviewSchema>;
type AwaitingInput = z.infer<typeof disciplinaryAwaitingResponseSchema>;
type FindingInput = z.infer<typeof disciplinaryFindingSchema>;
type DecisionInput = z.infer<typeof disciplinaryDecisionSchema>;
type AppealInput = z.infer<typeof disciplinaryAppealSchema>;
type CloseInput = z.infer<typeof disciplinaryCloseSchema>;
type NoteInput = z.infer<typeof disciplinaryNoteSchema>;
type SanctionCreate = z.infer<typeof disciplinarySanctionCreateSchema>;

async function auditCase(
  tx: Transaction,
  actorUserId: string,
  action: string,
  scope: { competitionId: string; seasonId: string | null },
  caseId: string,
  before: unknown,
  after: unknown,
  reason?: string | null,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId,
    competitionId: scope.competitionId,
    seasonId: scope.seasonId,
    action,
    entityType: 'disciplinary_case',
    entityId: caseId,
    before: before ?? null,
    after: after ?? null,
    reason: reason ?? null,
  });
}

async function addEntry(
  tx: Transaction,
  caseId: string,
  actorUserId: string,
  entryType: string,
  body: string | null,
  fromStatus: string | null,
  toStatus: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(disciplinaryCaseEntries).values({
    caseId,
    actorUserId,
    entryType,
    body,
    fromStatus,
    toStatus,
    metadata,
  });
}

async function lockCase(tx: Transaction, caseId: string) {
  const [row] = await tx
    .select()
    .from(disciplinaryCases)
    .where(eq(disciplinaryCases.id, caseId))
    .for('update');
  if (!row) throw notFound('Disciplinary case not found.');
  return row;
}

async function assertSeasonBelongs(
  tx: Transaction,
  seasonId: string,
  competitionId: string,
): Promise<void> {
  const [row] = await tx
    .select({ competitionId: seasons.competitionId })
    .from(seasons)
    .where(eq(seasons.id, seasonId));
  if (!row) throw badRequest('seasonId does not identify a season.');
  if (row.competitionId !== competitionId) {
    throw badRequest('The season does not belong to the competition.');
  }
}

async function assertTeamEntryBelongs(
  tx: Transaction,
  teamRegistrationId: string,
  competitionId: string,
  seasonId: string | null,
): Promise<void> {
  const [row] = await tx
    .select({ seasonId: teamRegistrations.seasonId, competitionId: seasons.competitionId })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(eq(teamRegistrations.id, teamRegistrationId));
  if (!row) throw badRequest('subjectTeamRegistrationId does not identify a team entry.');
  if (row.competitionId !== competitionId) {
    throw badRequest('The team entry does not belong to the competition.');
  }
  if (seasonId && row.seasonId !== seasonId) {
    throw badRequest('The team entry does not belong to the season.');
  }
}

async function assertPlayerRegBelongs(
  tx: Transaction,
  playerRegistrationId: string,
  competitionId: string,
  seasonId: string | null,
): Promise<void> {
  const [row] = await tx
    .select({
      seasonId: playerRegistrations.seasonId,
      competitionId: seasons.competitionId,
    })
    .from(playerRegistrations)
    .innerJoin(seasons, eq(playerRegistrations.seasonId, seasons.id))
    .where(eq(playerRegistrations.id, playerRegistrationId));
  if (!row) throw badRequest('subjectPlayerRegistrationId does not identify a registration.');
  if (row.competitionId !== competitionId) {
    throw badRequest('The player registration does not belong to the competition.');
  }
  if (seasonId && row.seasonId !== seasonId) {
    throw badRequest('The player registration does not belong to the season.');
  }
}

async function assertOriginMatchBelongs(
  tx: Transaction,
  matchId: string,
  competitionId: string,
  seasonId: string | null,
): Promise<{ seasonId: string }> {
  const [row] = await tx
    .select({ seasonId: fixtures.seasonId, competitionId: seasons.competitionId })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .where(eq(matches.id, matchId));
  if (!row) throw badRequest('originMatchId does not identify a match.');
  if (row.competitionId !== competitionId) {
    throw badRequest('The match does not belong to the competition.');
  }
  if (seasonId && row.seasonId !== seasonId) {
    throw badRequest('The match does not belong to the season.');
  }
  return { seasonId: row.seasonId };
}

export async function createDisciplinaryCase(auth: AuthContext, input: CaseCreate) {
  if (!canManageCompetition(auth, PERMISSIONS.disciplinaryManage, input.competitionId)) {
    throw forbidden('Disciplinary case management requires administrative scope.');
  }
  const seasonId = input.seasonId ?? null;

  return db.transaction(async (tx) => {
    if (seasonId) await assertSeasonBelongs(tx, seasonId, input.competitionId);
    if (input.subjectTeamRegistrationId) {
      await assertTeamEntryBelongs(
        tx,
        input.subjectTeamRegistrationId,
        input.competitionId,
        seasonId,
      );
    }
    if (input.subjectPlayerRegistrationId) {
      await assertPlayerRegBelongs(
        tx,
        input.subjectPlayerRegistrationId,
        input.competitionId,
        seasonId,
      );
    }
    if (input.originMatchId) {
      await assertOriginMatchBelongs(tx, input.originMatchId, input.competitionId, seasonId);
    }
    if (input.originEventId) {
      const [event] = await tx
        .select({ matchId: matchEvents.matchId })
        .from(matchEvents)
        .where(eq(matchEvents.id, input.originEventId));
      if (!event) throw badRequest('originEventId does not identify a match event.');
      if (event.matchId !== input.originMatchId) {
        throw badRequest('The origin event does not belong to the origin match.');
      }
    }

    const [created] = await tx
      .insert(disciplinaryCases)
      .values({
        competitionId: input.competitionId,
        seasonId,
        subjectType: input.subjectType,
        subjectPlayerRegistrationId: input.subjectPlayerRegistrationId ?? null,
        subjectUserId: input.subjectUserId ?? null,
        subjectTeamRegistrationId: input.subjectTeamRegistrationId ?? null,
        originType: input.originType,
        originMatchId: input.originMatchId ?? null,
        originEventId: input.originEventId ?? null,
        title: input.title,
        description: input.description,
        status: 'open',
        createdBy: auth.userId,
      })
      .returning();
    if (!created) throw new Error('Disciplinary case insert did not return a row.');

    await addEntry(tx, created.id, auth.userId, 'status_change', null, null, 'open', {
      created: true,
    });
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.created',
      { competitionId: created.competitionId, seasonId: created.seasonId },
      created.id,
      null,
      created,
      null,
    );

    if (created.subjectUserId && created.subjectUserId !== auth.userId) {
      await createNotification(tx, created.subjectUserId, {
        type: 'disciplinary.case.created',
        title: 'Disciplinary case opened',
        body: `A disciplinary case was opened: ${created.title}`,
        entityType: 'disciplinary_case',
        entityId: created.id,
        competitionId: created.competitionId,
      });
    }
    return created;
  });
}

export async function listDisciplinaryCases(auth: AuthContext, query: ListQuery) {
  const conditions: SQL[] = [];
  if (isSuperAdmin(auth)) {
    // global access
  } else {
    const scopes = competitionScopesFor(auth, PERMISSIONS.disciplinaryManage);
    if (scopes.length === 0) {
      throw forbidden('Disciplinary case access requires an administrative scope.');
    }
    const scopeCondition = inArray(disciplinaryCases.competitionId, scopes);
    conditions.push(
      query.assignedToMe
        ? and(scopeCondition, eq(disciplinaryCases.assignedReviewerId, auth.userId))!
        : scopeCondition,
    );
  }
  if (query.competitionId) {
    conditions.push(eq(disciplinaryCases.competitionId, query.competitionId));
  }
  if (query.seasonId) conditions.push(eq(disciplinaryCases.seasonId, query.seasonId));
  if (query.status) conditions.push(eq(disciplinaryCases.status, query.status));
  if (query.subjectType) conditions.push(eq(disciplinaryCases.subjectType, query.subjectType));
  if (query.assignedToMe && isSuperAdmin(auth)) {
    conditions.push(eq(disciplinaryCases.assignedReviewerId, auth.userId));
  }

  const rows = await db
    .select({
      id: disciplinaryCases.id,
      competitionId: disciplinaryCases.competitionId,
      seasonId: disciplinaryCases.seasonId,
      subjectType: disciplinaryCases.subjectType,
      subjectPlayerRegistrationId: disciplinaryCases.subjectPlayerRegistrationId,
      subjectUserId: disciplinaryCases.subjectUserId,
      subjectTeamRegistrationId: disciplinaryCases.subjectTeamRegistrationId,
      originType: disciplinaryCases.originType,
      originMatchId: disciplinaryCases.originMatchId,
      title: disciplinaryCases.title,
      status: disciplinaryCases.status,
      assignedReviewerId: disciplinaryCases.assignedReviewerId,
      createdBy: disciplinaryCases.createdBy,
      openedAt: disciplinaryCases.openedAt,
      decidedAt: disciplinaryCases.decidedAt,
      closedAt: disciplinaryCases.closedAt,
      createdAt: disciplinaryCases.createdAt,
      updatedAt: disciplinaryCases.updatedAt,
    })
    .from(disciplinaryCases)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(disciplinaryCases.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return {
    items: rows,
    pagination: { limit: query.limit, offset: query.offset, returned: rows.length },
  };
}

/**
 * Case entries for a caller. Reviewer-only notes are stored with
 * `metadata.isInternal = true` and must be filtered out of every response
 * returned to a caller who cannot review the case.
 */
export async function listCaseEntries(caseId: string, includeInternal: boolean) {
  return db
    .select()
    .from(disciplinaryCaseEntries)
    .where(
      includeInternal
        ? eq(disciplinaryCaseEntries.caseId, caseId)
        : and(
            eq(disciplinaryCaseEntries.caseId, caseId),
            sql`coalesce(${disciplinaryCaseEntries.metadata}->>'isInternal', 'false') <> 'true'`,
          ),
    )
    .orderBy(asc(disciplinaryCaseEntries.createdAt));
}

export async function getDisciplinaryCase(auth: AuthContext, caseId: string) {
  const scope = await requireCaseView(auth, caseId);
  const [sanctions, entries] = await Promise.all([
    db
      .select()
      .from(disciplinarySanctions)
      .where(eq(disciplinarySanctions.caseId, caseId))
      .orderBy(asc(disciplinarySanctions.createdAt)),
    listCaseEntries(caseId, canReviewCase(auth, scope)),
  ]);
  return { ...scope.case, competition: scope.competition, season: scope.season, sanctions, entries };
}

/** Remove a reviewer-only note body from an audit snapshot shown to ordinary viewers. */
function visibleCaseAuditValue(action: string, value: unknown, includeInternal: boolean) {
  const sanitized = sanitizeAuditValue(value);
  if (includeInternal || action !== 'disciplinary.case.note_added') return sanitized;
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return sanitized;
  const record = sanitized as Record<string, unknown>;
  // Notes default to internal. Only an explicitly shared note is exposed.
  if (record.isInternal === false) return sanitized;
  const rest = { ...record };
  delete rest.note;
  return rest;
}

export async function getDisciplinaryCaseHistory(auth: AuthContext, caseId: string) {
  const scope = await requireCaseView(auth, caseId);
  const includeInternal = canReviewCase(auth, scope);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'disciplinary_case'),
        eq(auditLogs.entityId, caseId),
      ),
    )
    .orderBy(asc(auditLogs.createdAt));
  return rows.map((row) => ({
    ...row,
    before: visibleCaseAuditValue(row.action, row.before, includeInternal),
    after: visibleCaseAuditValue(row.action, row.after, includeInternal),
  }));
}

async function reviewerIsAdministrator(
  tx: Transaction,
  reviewerId: string,
  competitionId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ userId: userRoles.userId, competitionId: userRoles.competitionId, role: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(
      and(
        eq(userRoles.userId, reviewerId),
        eq(users.isActive, true),
        inArray(roles.name, [ROLES.competitionAdmin, ROLES.superAdmin]),
      ),
    )
    .limit(1);
  if (!row) return false;
  return row.role === ROLES.superAdmin || row.competitionId === null || row.competitionId === competitionId;
}

export async function assignDisciplinaryReviewer(
  auth: AuthContext,
  caseId: string,
  input: AssignInput,
) {
  await requireCaseManage(auth, caseId);
  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (!(await reviewerIsAdministrator(tx, input.reviewerId, current.competitionId))) {
      throw badRequest('The reviewer must be an active administrator in this competition.');
    }
    const [reviewer] = await tx
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.id, input.reviewerId), eq(users.isActive, true)));
    if (!reviewer) throw badRequest('The reviewer account is not active.');

    const now = new Date();
    const [updated] = await tx
      .update(disciplinaryCases)
      .set({
        assignedReviewerId: reviewer.id,
        updatedAt: now,
      })
      .where(eq(disciplinaryCases.id, caseId))
      .returning();
    if (!updated) throw notFound('Disciplinary case not found.');

    await addEntry(
      tx,
      caseId,
      auth.userId,
      'reviewer_assigned',
      input.reason ?? null,
      current.status,
      updated.status,
      { reviewerId: reviewer.id, reviewerName: reviewer.displayName },
    );
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.reviewer_assigned',
      current,
      caseId,
      { assignedReviewerId: current.assignedReviewerId, status: current.status },
      { assignedReviewerId: reviewer.id, status: updated.status },
      input.reason ?? null,
    );
    await createNotification(tx, reviewer.id, {
      type: 'disciplinary.case.assigned',
      title: 'Disciplinary case assigned',
      body: `You were assigned to review: ${current.title}`,
      entityType: 'disciplinary_case',
      entityId: caseId,
      competitionId: current.competitionId,
    });
    return updated;
  });
}

export async function reviewDisciplinaryCase(
  auth: AuthContext,
  caseId: string,
  input: ReviewInput,
) {
  await requireCaseReview(auth, caseId);
  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (!['open', 'awaiting_response', 'appealed'].includes(current.status)) {
      throw conflict(`Cannot start review from status "${current.status}".`);
    }
    const [updated] = await tx
      .update(disciplinaryCases)
      .set({ status: 'under_review', updatedAt: new Date() })
      .where(eq(disciplinaryCases.id, caseId))
      .returning();
    if (!updated) throw notFound('Disciplinary case not found.');
    await addEntry(
      tx,
      caseId,
      auth.userId,
      'status_change',
      input.reason ?? null,
      current.status,
      'under_review',
    );
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.review_started',
      current,
      caseId,
      { status: current.status },
      { status: updated.status },
      input.reason ?? null,
    );
    return updated;
  });
}

export async function requestDisciplinaryResponse(
  auth: AuthContext,
  caseId: string,
  input: AwaitingInput,
) {
  await requireCaseReview(auth, caseId);
  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (current.status !== 'under_review') {
      throw conflict(`A response can only be requested from under_review, not "${current.status}".`);
    }
    const [updated] = await tx
      .update(disciplinaryCases)
      .set({ status: 'awaiting_response', updatedAt: new Date() })
      .where(eq(disciplinaryCases.id, caseId))
      .returning();
    if (!updated) throw notFound('Disciplinary case not found.');
    await addEntry(tx, caseId, auth.userId, 'status_change', input.reason, 'under_review', 'awaiting_response');
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.response_requested',
      current,
      caseId,
      { status: current.status },
      { status: updated.status },
      input.reason,
    );
    if (current.subjectUserId) {
      await createNotification(tx, current.subjectUserId, {
        type: 'disciplinary.case.response_requested',
        title: 'Response requested',
        body: input.reason,
        entityType: 'disciplinary_case',
        entityId: caseId,
        competitionId: current.competitionId,
      });
    }
    return updated;
  });
}

export async function addDisciplinaryFinding(
  auth: AuthContext,
  caseId: string,
  input: FindingInput,
) {
  await requireCaseReview(auth, caseId);
  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (!['under_review', 'awaiting_response'].includes(current.status)) {
      throw conflict('Findings can only be recorded while the case is under review.');
    }
    await addEntry(tx, caseId, auth.userId, 'finding', input.body, current.status, current.status);
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.finding_recorded',
      current,
      caseId,
      null,
      { finding: input.body },
      null,
    );
    return { caseId, finding: input.body, status: current.status };
  });
}

export async function decideDisciplinaryCase(
  auth: AuthContext,
  caseId: string,
  input: DecisionInput,
) {
  await requireCaseReview(auth, caseId);
  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (!['under_review', 'awaiting_response'].includes(current.status)) {
      throw conflict(`A decision cannot be recorded from status "${current.status}".`);
    }
    const now = new Date();
    const [updated] = await tx
      .update(disciplinaryCases)
      .set({ status: 'decided', decidedAt: now, updatedAt: now })
      .where(eq(disciplinaryCases.id, caseId))
      .returning();
    if (!updated) throw notFound('Disciplinary case not found.');
    await addEntry(tx, caseId, auth.userId, 'decision', input.decision, current.status, 'decided');
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.decided',
      current,
      caseId,
      { status: current.status },
      { status: updated.status, decision: input.decision, decidedAt: now },
      input.reason ?? null,
    );
    if (current.subjectUserId) {
      await createNotification(tx, current.subjectUserId, {
        type: 'disciplinary.case.decided',
        title: 'Disciplinary case decided',
        body: input.decision,
        entityType: 'disciplinary_case',
        entityId: caseId,
        competitionId: current.competitionId,
      });
    }
    return updated;
  });
}

export async function appealDisciplinaryCase(
  auth: AuthContext,
  caseId: string,
  input: AppealInput,
) {
  const scope = await requireCaseView(auth, caseId);
  const canAppeal =
    canManageCase(auth, scope) ||
    scope.case.subjectUserId === auth.userId ||
    (scope.case.subjectTeamRegistrationId
      ? await isTeamCaptain(auth.userId, scope.case.subjectTeamRegistrationId)
      : false);
  if (!canAppeal) throw forbidden('Only the subject or an administrator can appeal a decision.');

  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (current.status !== 'decided') {
      throw conflict('Only a decided case can be appealed.');
    }
    const [updated] = await tx
      .update(disciplinaryCases)
      .set({ status: 'appealed', updatedAt: new Date() })
      .where(eq(disciplinaryCases.id, caseId))
      .returning();
    if (!updated) throw notFound('Disciplinary case not found.');
    await addEntry(tx, caseId, auth.userId, 'appeal', input.reason, 'decided', 'appealed');
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.appealed',
      current,
      caseId,
      { status: current.status },
      { status: updated.status },
      input.reason,
    );
    const admins = await competitionAdministratorIds(tx, current.competitionId);
    for (const adminId of admins) {
      await createNotification(tx, adminId, {
        type: 'disciplinary.case.appealed',
        title: 'Disciplinary decision appealed',
        body: input.reason,
        entityType: 'disciplinary_case',
        entityId: caseId,
        competitionId: current.competitionId,
      });
    }
    return updated;
  });
}

export async function closeDisciplinaryCase(
  auth: AuthContext,
  caseId: string,
  input: CloseInput,
) {
  await requireCaseReview(auth, caseId);
  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (current.status === 'closed') throw conflict('The case is already closed.');
    if (!['open', 'decided', 'appealed'].includes(current.status)) {
      throw conflict(`A case cannot be closed from status "${current.status}".`);
    }
    const now = new Date();
    const [updated] = await tx
      .update(disciplinaryCases)
      .set({
        status: 'closed',
        closedAt: now,
        closureReason: input.reason,
        updatedAt: now,
      })
      .where(eq(disciplinaryCases.id, caseId))
      .returning();
    if (!updated) throw notFound('Disciplinary case not found.');
    await addEntry(tx, caseId, auth.userId, 'status_change', input.reason, current.status, 'closed');
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.closed',
      current,
      caseId,
      { status: current.status },
      { status: 'closed', closedAt: now },
      input.reason,
    );
    if (current.subjectUserId) {
      await createNotification(tx, current.subjectUserId, {
        type: 'disciplinary.case.closed',
        title: 'Disciplinary case closed',
        body: input.reason,
        entityType: 'disciplinary_case',
        entityId: caseId,
        competitionId: current.competitionId,
      });
    }
    return updated;
  });
}

export async function addDisciplinaryNote(
  auth: AuthContext,
  caseId: string,
  input: NoteInput,
) {
  await requireCaseReview(auth, caseId);
  const isInternal = input.isInternal ?? true;
  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (current.status === 'closed') throw conflict('A closed case cannot be edited.');
    await addEntry(
      tx,
      caseId,
      auth.userId,
      'note',
      input.body,
      current.status,
      current.status,
      { isInternal },
    );
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.note_added',
      current,
      caseId,
      null,
      { note: input.body, isInternal },
      null,
    );
    return { caseId, note: input.body };
  });
}

export async function addDisciplinaryResponse(
  auth: AuthContext,
  caseId: string,
  body: string,
) {
  const scope = await requireCaseView(auth, caseId);
  const isSubject =
    scope.case.subjectUserId === auth.userId ||
    (scope.case.subjectTeamRegistrationId
      ? await isTeamCaptain(auth.userId, scope.case.subjectTeamRegistrationId)
      : false);
  if (!isSubject && !canReviewCase(auth, scope)) {
    throw forbidden('Only the subject or the assigned reviewer can respond.');
  }
  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (current.status === 'closed') throw conflict('A closed case cannot receive responses.');
    await addEntry(tx, caseId, auth.userId, 'response', body, current.status, current.status);
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.case.response_recorded',
      current,
      caseId,
      null,
      { response: body },
      null,
    );
    return { caseId, response: body, status: current.status };
  });
}

export async function addDisciplinarySanction(
  auth: AuthContext,
  caseId: string,
  input: SanctionCreate,
) {
  await requireCaseReview(auth, caseId);
  return db.transaction(async (tx) => {
    const current = await lockCase(tx, caseId);
    if (!['under_review', 'awaiting_response', 'decided'].includes(current.status)) {
      throw conflict('A sanction can only be recorded while the case is under review or decided.');
    }
    if (input.subjectPlayerRegistrationId) {
      await assertPlayerRegBelongs(
        tx,
        input.subjectPlayerRegistrationId,
        current.competitionId,
        current.seasonId,
      );
    }
    if (input.subjectTeamRegistrationId) {
      await assertTeamEntryBelongs(
        tx,
        input.subjectTeamRegistrationId,
        current.competitionId,
        current.seasonId,
      );
    }

    const [sanction] = await tx
      .insert(disciplinarySanctions)
      .values({
        caseId,
        competitionId: current.competitionId,
        seasonId: current.seasonId,
        subjectType: input.subjectType,
        subjectPlayerRegistrationId: input.subjectPlayerRegistrationId ?? null,
        subjectUserId: input.subjectUserId ?? null,
        subjectTeamRegistrationId: input.subjectTeamRegistrationId ?? null,
        sanctionType: input.sanctionType,
        reason: input.reason,
        matchesCount: input.matchesCount ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        status: 'active',
        issuedBy: auth.userId,
      })
      .returning();
    if (!sanction) throw new Error('Sanction insert did not return a row.');

    await addEntry(
      tx,
      caseId,
      auth.userId,
      'sanction',
      input.reason,
      current.status,
      current.status,
      {
        sanctionId: sanction.id,
        sanctionType: sanction.sanctionType,
        matchesCount: sanction.matchesCount,
      },
    );
    await auditCase(
      tx,
      auth.userId,
      'disciplinary.sanction.issued',
      current,
      caseId,
      null,
      sanction,
      input.reason,
    );

    const subjectUserId =
      input.subjectUserId ??
      (current.subjectType === 'official' ? current.subjectUserId : null);
    if (subjectUserId) {
      await createNotification(tx, subjectUserId, {
        type: 'disciplinary.sanction.issued',
        title: 'Disciplinary sanction issued',
        body: `${input.sanctionType}: ${input.reason}`,
        entityType: 'disciplinary_case',
        entityId: caseId,
        competitionId: current.competitionId,
      });
    }
    return sanction;
  });
}

export async function listCaseSanctions(auth: AuthContext, caseId: string) {
  await requireCaseView(auth, caseId);
  return db
    .select()
    .from(disciplinarySanctions)
    .where(eq(disciplinarySanctions.caseId, caseId))
    .orderBy(asc(disciplinarySanctions.createdAt));
}

export async function requireCaseReviewerOrManage(auth: AuthContext, caseId: string) {
  const scope = await loadCaseScope(caseId);
  if (!canReviewCase(auth, scope)) throw forbidden();
  return scope;
}

async function servedMatches(
  playerOrTeam: { teamRegistrationId: string },
  since: Date,
  excludeMatchId: string | null,
): Promise<number> {
  const conditions: SQL[] = [
    eq(fixtures.homeTeamRegistrationId, playerOrTeam.teamRegistrationId),
    sql`${matches.resultConfirmedAt} is not null`,
  ];
  const away: SQL[] = [
    eq(fixtures.awayTeamRegistrationId, playerOrTeam.teamRegistrationId),
    sql`${matches.resultConfirmedAt} is not null`,
  ];
  const [homeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .where(
      and(
        ...conditions,
        sql`coalesce(${fixtures.scheduledAt}, ${matches.endedAt}, ${matches.createdAt}) >= ${since}`,
        excludeMatchId ? sql`${matches.id} <> ${excludeMatchId}` : sql`true`,
      ),
    );
  const [awayRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .where(
      and(
        ...away,
        sql`coalesce(${fixtures.scheduledAt}, ${matches.endedAt}, ${matches.createdAt}) >= ${since}`,
        excludeMatchId ? sql`${matches.id} <> ${excludeMatchId}` : sql`true`,
      ),
    );
  return (homeRow?.count ?? 0) + (awayRow?.count ?? 0);
}

async function activeSuspensionsFor(
  subject: {
    playerRegistrationId?: string;
    teamRegistrationId?: string;
  },
  competitionId: string,
  at: Date,
  matchId: string | null,
): Promise<Array<typeof disciplinarySanctions.$inferSelect>> {
  const conditions: SQL[] = [
    eq(disciplinarySanctions.competitionId, competitionId),
    eq(disciplinarySanctions.status, 'active'),
    inArray(disciplinarySanctions.sanctionType, ['match_suspension', 'competition_suspension']),
  ];
  if (subject.playerRegistrationId) {
    conditions.push(
      eq(disciplinarySanctions.subjectPlayerRegistrationId, subject.playerRegistrationId),
    );
  } else if (subject.teamRegistrationId) {
    conditions.push(
      eq(disciplinarySanctions.subjectTeamRegistrationId, subject.teamRegistrationId),
    );
  } else {
    return [];
  }
  const rows = await db
    .select()
    .from(disciplinarySanctions)
    .where(and(...conditions));

  const active: Array<typeof disciplinarySanctions.$inferSelect> = [];
  for (const sanction of rows) {
    const withinDates =
      (!sanction.startsAt || sanction.startsAt.getTime() <= at.getTime()) &&
      (!sanction.endsAt || sanction.endsAt.getTime() >= at.getTime());
    if (!withinDates) continue;
    if (sanction.sanctionType === 'match_suspension' && matchId === null) {
      active.push(sanction);
      continue;
    }
    if (sanction.matchesCount && subject.teamRegistrationId) {
      const served = await servedMatches(
        { teamRegistrationId: subject.teamRegistrationId },
        sanction.startsAt ?? sanction.createdAt,
        matchId,
      );
      if (served >= sanction.matchesCount) continue;
    }
    active.push(sanction);
  }
  return active;
}

export async function checkPlayerEligibility(
  auth: AuthContext,
  playerRegistrationId: string,
  options: { matchId?: string | undefined; at?: string | undefined },
) {
  const [row] = await db
    .select({
      registration: playerRegistrations,
      seasonId: seasons.id,
      competitionId: seasons.competitionId,
      teamRegistrationId: playerRegistrations.teamRegistrationId,
    })
    .from(playerRegistrations)
    .innerJoin(seasons, eq(playerRegistrations.seasonId, seasons.id))
    .where(eq(playerRegistrations.id, playerRegistrationId));
  if (!row) throw notFound('Player registration not found.');

  const permitted =
    isSuperAdmin(auth) ||
    canManageCompetition(auth, PERMISSIONS.disciplinaryManage, row.competitionId) ||
    canManageCompetition(auth, PERMISSIONS.matchesRead, row.competitionId) ||
    (await isTeamCaptain(auth.userId, row.teamRegistrationId));
  if (!permitted) throw notFound('Player registration not found.');

  let matchScope: Awaited<ReturnType<typeof loadMatchScope>> = null;
  if (options.matchId) {
    matchScope = await loadMatchScope(options.matchId);
    if (!matchScope) throw notFound('Match not found.');
    if (matchScope.competitionId !== row.competitionId) {
      throw badRequest('The match does not belong to the player registration competition.');
    }
  }

  const at = options.at ? new Date(options.at) : new Date();
  const suspensions = await activeSuspensionsFor(
    { playerRegistrationId, teamRegistrationId: row.teamRegistrationId },
    row.competitionId,
    at,
    matchScope?.matchId ?? null,
  );

  const reasons = suspensions.map(
    (sanction) =>
      `${sanction.sanctionType}: ${sanction.reason}` +
      (sanction.matchesCount ? ` (${sanction.matchesCount} match(es))` : '') +
      (sanction.endsAt ? ` until ${sanction.endsAt.toISOString()}` : ''),
  );
  return {
    playerRegistrationId,
    competitionId: row.competitionId,
    seasonId: row.seasonId,
    matchId: matchScope?.matchId ?? null,
    checkedAt: at.toISOString(),
    eligible: suspensions.length === 0,
    reasons,
    sanctions: suspensions.map((sanction) => ({
      id: sanction.id,
      caseId: sanction.caseId,
      sanctionType: sanction.sanctionType,
      reason: sanction.reason,
      matchesCount: sanction.matchesCount,
      startsAt: sanction.startsAt,
      endsAt: sanction.endsAt,
    })),
  };
}

export async function checkTeamEligibility(
  auth: AuthContext,
  teamRegistrationId: string,
  options: { matchId?: string | undefined; at?: string | undefined },
) {
  const [row] = await db
    .select({
      seasonId: seasons.id,
      competitionId: seasons.competitionId,
    })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(eq(teamRegistrations.id, teamRegistrationId));
  if (!row) throw notFound('Team entry not found.');

  const permitted =
    isSuperAdmin(auth) ||
    isCompetitionAdministrator(auth, row.competitionId) ||
    (await isTeamCaptain(auth.userId, teamRegistrationId));
  if (!permitted) throw notFound('Team entry not found.');

  const at = options.at ? new Date(options.at) : new Date();
  const suspensions = await activeSuspensionsFor(
    { teamRegistrationId },
    row.competitionId,
    at,
    options.matchId ?? null,
  );
  return {
    teamRegistrationId,
    competitionId: row.competitionId,
    seasonId: row.seasonId,
    checkedAt: at.toISOString(),
    eligible: suspensions.length === 0,
    reasons: suspensions.map((sanction) => `${sanction.sanctionType}: ${sanction.reason}`),
    sanctions: suspensions.map((sanction) => ({
      id: sanction.id,
      caseId: sanction.caseId,
      sanctionType: sanction.sanctionType,
      reason: sanction.reason,
      startsAt: sanction.startsAt,
      endsAt: sanction.endsAt,
    })),
  };
}
