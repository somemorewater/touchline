import { and, asc, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  competitions,
  disputeEntries,
  disputes,
  fixtures,
  matches,
  seasons,
  teamRegistrations,
  users,
  roles,
  userRoles,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import {
  competitionScopesFor,
  hasPermission,
  isSuperAdmin,
  type AuthContext,
} from '../../security/context.js';
import {
  canManageCompetition,
  isCompetitionAdministrator,
  isTeamCaptain,
} from '../../security/access.js';
import { PERMISSIONS, ROLES } from '../../security/permissions.js';
import {
  canManageDispute,
  canReviewDispute,
  canViewDispute,
  disputeTeamSeason,
  isDisputeTeamCaptain,
  requireDisputeManage,
  requireDisputeReview,
  requireDisputeView,
} from './access.js';
import {
  competitionAdministratorIds,
  createNotification,
  createNotifications,
} from '../notifications/service.js';
import { sanitizeAuditValue } from '../audit/service.js';
import type {
  disputeAssignSchema,
  disputeCloseSchema,
  disputeCreateSchema,
  disputeDecisionSchema,
  disputeInformationRequestSchema,
  disputeListQuerySchema,
  disputeResponseSchema,
  disputeReviewSchema,
} from './schemas.js';
import type { z } from 'zod';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CreateInput = z.infer<typeof disputeCreateSchema>;
type ListQuery = z.infer<typeof disputeListQuerySchema>;
type AssignInput = z.infer<typeof disputeAssignSchema>;
type ResponseInput = z.infer<typeof disputeResponseSchema>;
type InformationInput = z.infer<typeof disputeInformationRequestSchema>;
type DecisionInput = z.infer<typeof disputeDecisionSchema>;
type CloseInput = z.infer<typeof disputeCloseSchema>;
type ReviewInput = z.infer<typeof disputeReviewSchema>;

async function auditDispute(
  tx: Transaction,
  actorUserId: string,
  action: string,
  scope: { competitionId: string; seasonId: string | null },
  disputeId: string,
  before: unknown,
  after: unknown,
  reason?: string | null,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId,
    competitionId: scope.competitionId,
    seasonId: scope.seasonId,
    action,
    entityType: 'dispute',
    entityId: disputeId,
    before: before ?? null,
    after: after ?? null,
    reason: reason ?? null,
  });
}

async function addEntry(
  tx: Transaction,
  disputeId: string,
  actorUserId: string,
  entryType: string,
  body: string | null,
  fromStatus: string | null,
  toStatus: string | null,
  isInternal = false,
): Promise<void> {
  await tx.insert(disputeEntries).values({
    disputeId,
    actorUserId,
    entryType,
    body,
    fromStatus,
    toStatus,
    isInternal,
  });
}

async function lockDispute(tx: Transaction, disputeId: string) {
  const [row] = await tx
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .for('update');
  if (!row) throw notFound('Dispute not found.');
  return row;
}

async function assertMatchBelongs(
  tx: Transaction,
  matchId: string,
  competitionId: string,
  seasonId: string | null,
): Promise<{ seasonId: string; home: string; away: string }> {
  const [row] = await tx
    .select({
      seasonId: fixtures.seasonId,
      competitionId: seasons.competitionId,
      home: fixtures.homeTeamRegistrationId,
      away: fixtures.awayTeamRegistrationId,
    })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .where(eq(matches.id, matchId));
  if (!row) throw badRequest('matchId does not identify a match.');
  if (row.competitionId !== competitionId) {
    throw badRequest('The match does not belong to the competition.');
  }
  if (seasonId && row.seasonId !== seasonId) {
    throw badRequest('The match does not belong to the season.');
  }
  return { seasonId: row.seasonId, home: row.home, away: row.away };
}

async function notifyAdmins(
  tx: Transaction,
  competitionId: string,
  input: {
    type: string;
    title: string;
    body: string;
    entityId: string;
  },
  excludeUserId?: string,
): Promise<void> {
  const ids = (await competitionAdministratorIds(tx, competitionId)).filter(
    (id) => id !== excludeUserId,
  );
  await createNotifications(tx, ids, {
    type: input.type,
    title: input.title,
    body: input.body,
    entityType: 'dispute',
    entityId: input.entityId,
    competitionId,
  });
}

export async function createDispute(auth: AuthContext, input: CreateInput) {
  const [competition] = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.id, input.competitionId));
  if (!competition) throw badRequest('competitionId does not identify a competition.');

  const administrator = canManageCompetition(auth, PERMISSIONS.disputesManage, input.competitionId);
  const captain =
    typeof input.teamRegistrationId === 'string' &&
    (await isTeamCaptain(auth.userId, input.teamRegistrationId));
  if (!administrator && !captain) {
    throw forbidden('You can only submit a dispute for a team you captain or a competition you administer.');
  }
  if (!administrator && !hasPermission(auth, PERMISSIONS.disputesSubmit)) {
    throw forbidden('Submitting a dispute requires the disputes.submit permission.');
  }

  const seasonId = input.seasonId ?? null;
  const submit = input.submit === true;

  return db.transaction(async (tx) => {
    if (seasonId) {
      const [season] = await tx
        .select({ competitionId: seasons.competitionId })
        .from(seasons)
        .where(eq(seasons.id, seasonId));
      if (!season) throw badRequest('seasonId does not identify a season.');
      if (season.competitionId !== input.competitionId) {
        throw badRequest('The season does not belong to the competition.');
      }
    }
    if (input.teamRegistrationId) {
      const team = await disputeTeamSeason(input.teamRegistrationId);
      if (!team) throw badRequest('teamRegistrationId does not identify a team entry.');
      if (team.competitionId !== input.competitionId) {
        throw badRequest('The team entry does not belong to the competition.');
      }
      if (seasonId && team.seasonId !== seasonId) {
        throw badRequest('The team entry does not belong to the season.');
      }
    }
    if (input.matchId) {
      const match = await assertMatchBelongs(tx, input.matchId, input.competitionId, seasonId);
      if (
        captain &&
        input.teamRegistrationId &&
        match.home !== input.teamRegistrationId &&
        match.away !== input.teamRegistrationId
      ) {
        throw forbidden('A captain can only dispute a match their team participated in.');
      }
    }

    const now = new Date();
    const [created] = await tx
      .insert(disputes)
      .values({
        competitionId: input.competitionId,
        seasonId,
        matchId: input.matchId ?? null,
        teamRegistrationId: input.teamRegistrationId ?? null,
        subjectType: input.subjectType,
        subjectRefId: input.subjectRefId ?? null,
        title: input.title,
        description: input.description,
        status: submit ? 'submitted' : 'draft',
        submittedBy: auth.userId,
        submittedAt: submit ? now : null,
      })
      .returning();
    if (!created) throw new Error('Dispute insert did not return a row.');

    await addEntry(
      tx,
      created.id,
      auth.userId,
      'status_change',
      null,
      null,
      created.status,
      false,
    );
    await auditDispute(
      tx,
      auth.userId,
      submit ? 'dispute.submitted' : 'dispute.draft_created',
      created,
      created.id,
      null,
      created,
      null,
    );
    if (submit) {
      await notifyAdmins(tx, created.competitionId, {
        type: 'dispute.submitted',
        title: 'New dispute submitted',
        body: created.title,
        entityId: created.id,
      }, auth.userId);
    }
    return created;
  });
}

export async function listDisputes(auth: AuthContext, query: ListQuery) {
  const conditions: SQL[] = [];

  if (isSuperAdmin(auth)) {
    // global access
  } else {
    const scopes = competitionScopesFor(auth, PERMISSIONS.disputesManage);
    const captainEntries = await db
      .select({ id: teamRegistrations.id })
      .from(teamRegistrations)
      .where(eq(teamRegistrations.captainUserId, auth.userId));
    const visibility: SQL[] = [eq(disputes.submittedBy, auth.userId)];
    if (scopes.length > 0) visibility.push(inArray(disputes.competitionId, scopes));
    if (captainEntries.length > 0) {
      visibility.push(inArray(disputes.teamRegistrationId, captainEntries.map((entry) => entry.id)));
    }
    if (visibility.length === 0) {
      throw forbidden('Dispute access requires administrative scope or team ownership.');
    }
    conditions.push(or(...visibility)!);
  }

  if (query.competitionId) conditions.push(eq(disputes.competitionId, query.competitionId));
  if (query.seasonId) conditions.push(eq(disputes.seasonId, query.seasonId));
  if (query.status) conditions.push(eq(disputes.status, query.status));
  if (query.subjectType) conditions.push(eq(disputes.subjectType, query.subjectType));
  if (query.assignedToMe) conditions.push(eq(disputes.assignedReviewerId, auth.userId));

  const rows = await db
    .select({
      id: disputes.id,
      competitionId: disputes.competitionId,
      seasonId: disputes.seasonId,
      matchId: disputes.matchId,
      teamRegistrationId: disputes.teamRegistrationId,
      subjectType: disputes.subjectType,
      subjectRefId: disputes.subjectRefId,
      title: disputes.title,
      status: disputes.status,
      outcome: disputes.outcome,
      assignedReviewerId: disputes.assignedReviewerId,
      submittedBy: disputes.submittedBy,
      submittedAt: disputes.submittedAt,
      decidedAt: disputes.decidedAt,
      closedAt: disputes.closedAt,
      createdAt: disputes.createdAt,
      updatedAt: disputes.updatedAt,
    })
    .from(disputes)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(disputes.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return {
    items: rows,
    pagination: { limit: query.limit, offset: query.offset, returned: rows.length },
  };
}

export async function getDispute(auth: AuthContext, disputeId: string) {
  const scope = await requireDisputeView(auth, disputeId);
  const reviewer = canReviewDispute(auth, scope);
  const entries = await db
    .select()
    .from(disputeEntries)
    .where(
      reviewer
        ? eq(disputeEntries.disputeId, disputeId)
        : and(
            eq(disputeEntries.disputeId, disputeId),
            eq(disputeEntries.isInternal, false),
          ),
    )
    .orderBy(asc(disputeEntries.createdAt));
  return {
    ...scope.dispute,
    competition: scope.competition,
    season: scope.season,
    entries,
  };
}

export async function getDisputeHistory(auth: AuthContext, disputeId: string) {
  await requireDisputeView(auth, disputeId);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, 'dispute'), eq(auditLogs.entityId, disputeId)))
    .orderBy(asc(auditLogs.createdAt));
  return rows.map((row) => ({
    ...row,
    before: sanitizeAuditValue(row.before),
    after: sanitizeAuditValue(row.after),
  }));
}

export async function submitDispute(auth: AuthContext, disputeId: string) {
  const scope = await requireDisputeView(auth, disputeId);
  const canSubmit =
    scope.dispute.submittedBy === auth.userId ||
    (await isDisputeTeamCaptain(auth, scope)) ||
    canManageDispute(auth, scope);
  if (!canSubmit) throw forbidden('Only the submitter or an administrator can submit this dispute.');

  return db.transaction(async (tx) => {
    const current = await lockDispute(tx, disputeId);
    if (current.status !== 'draft') {
      throw conflict(`Only a draft dispute can be submitted, not "${current.status}".`);
    }
    const now = new Date();
    const [updated] = await tx
      .update(disputes)
      .set({ status: 'submitted', submittedAt: now, submittedBy: auth.userId, updatedAt: now })
      .where(eq(disputes.id, disputeId))
      .returning();
    if (!updated) throw notFound('Dispute not found.');
    await addEntry(tx, disputeId, auth.userId, 'status_change', null, 'draft', 'submitted');
    await auditDispute(
      tx,
      auth.userId,
      'dispute.submitted',
      current,
      disputeId,
      { status: 'draft' },
      { status: 'submitted', submittedAt: now },
      null,
    );
    await notifyAdmins(
      tx,
      current.competitionId,
      {
        type: 'dispute.submitted',
        title: 'New dispute submitted',
        body: current.title,
        entityId: disputeId,
      },
      auth.userId,
    );
    return updated;
  });
}

async function reviewerIsAdministrator(
  tx: Transaction,
  reviewerId: string,
  competitionId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ competitionId: userRoles.competitionId, role: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(
      and(
        eq(userRoles.userId, reviewerId),
        eq(users.isActive, true),
        inArray(roles.name, [ROLES.competitionAdmin, ROLES.superAdmin]),
      ),
    );
  return rows.some(
    (row) =>
      row.role === ROLES.superAdmin ||
      row.competitionId === null ||
      row.competitionId === competitionId,
  );
}

export async function assignDisputeReviewer(
  auth: AuthContext,
  disputeId: string,
  input: AssignInput,
) {
  await requireDisputeManage(auth, disputeId);
  return db.transaction(async (tx) => {
    const current = await lockDispute(tx, disputeId);
    if (!(await reviewerIsAdministrator(tx, input.reviewerId, current.competitionId))) {
      throw badRequest('The reviewer must be an active administrator in this competition.');
    }
    const [reviewer] = await tx
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.id, input.reviewerId), eq(users.isActive, true)));
    if (!reviewer) throw badRequest('The reviewer account is not active.');
    if (['decided', 'closed'].includes(current.status)) {
      throw conflict('A decided or closed dispute cannot be reassigned.');
    }
    const [updated] = await tx
      .update(disputes)
      .set({ assignedReviewerId: reviewer.id, updatedAt: new Date() })
      .where(eq(disputes.id, disputeId))
      .returning();
    if (!updated) throw notFound('Dispute not found.');
    await addEntry(
      tx,
      disputeId,
      auth.userId,
      'reviewer_assigned',
      input.reason ?? null,
      current.status,
      current.status,
      true,
    );
    await auditDispute(
      tx,
      auth.userId,
      'dispute.reviewer_assigned',
      current,
      disputeId,
      { assignedReviewerId: current.assignedReviewerId },
      { assignedReviewerId: reviewer.id },
      input.reason ?? null,
    );
    if (reviewer.id !== auth.userId) {
      await createNotification(tx, reviewer.id, {
        type: 'dispute.assigned',
        title: 'Dispute assigned',
        body: `You were assigned to review: ${current.title}`,
        entityType: 'dispute',
        entityId: disputeId,
        competitionId: current.competitionId,
      });
    }
    return updated;
  });
}

export async function startDisputeReview(
  auth: AuthContext,
  disputeId: string,
  input: ReviewInput,
) {
  await requireDisputeReview(auth, disputeId);
  return db.transaction(async (tx) => {
    const current = await lockDispute(tx, disputeId);
    if (current.status !== 'submitted') {
      throw conflict(`Review can only start from submitted, not "${current.status}".`);
    }
    const [updated] = await tx
      .update(disputes)
      .set({ status: 'under_review', updatedAt: new Date() })
      .where(eq(disputes.id, disputeId))
      .returning();
    if (!updated) throw notFound('Dispute not found.');
    await addEntry(tx, disputeId, auth.userId, 'status_change', input.reason ?? null, 'submitted', 'under_review');
    await auditDispute(
      tx,
      auth.userId,
      'dispute.review_started',
      current,
      disputeId,
      { status: 'submitted' },
      { status: 'under_review' },
      input.reason ?? null,
    );
    return updated;
  });
}

export async function addDisputeResponse(
  auth: AuthContext,
  disputeId: string,
  input: ResponseInput,
) {
  const scope = await requireDisputeView(auth, disputeId);
  const canRespond =
    scope.dispute.submittedBy === auth.userId ||
    (await isDisputeTeamCaptain(auth, scope)) ||
    canReviewDispute(auth, scope);
  if (!canRespond) throw forbidden('You cannot respond to this dispute.');
  const isInternal = canReviewDispute(auth, scope) && input.isInternal === true;

  return db.transaction(async (tx) => {
    const current = await lockDispute(tx, disputeId);
    if (current.status === 'closed') throw conflict('A closed dispute cannot receive responses.');
    await addEntry(
      tx,
      disputeId,
      auth.userId,
      'response',
      input.body,
      current.status,
      current.status,
      isInternal,
    );
    await auditDispute(
      tx,
      auth.userId,
      'dispute.response_recorded',
      current,
      disputeId,
      null,
      { response: input.body, isInternal },
      null,
    );
    await notifyAdmins(
      tx,
      current.competitionId,
      {
        type: 'dispute.response_recorded',
        title: 'Dispute response recorded',
        body: input.body.slice(0, 300),
        entityId: disputeId,
      },
      auth.userId,
    );
    if (current.submittedBy && current.submittedBy !== auth.userId) {
      await createNotification(tx, current.submittedBy, {
        type: 'dispute.response_recorded',
        title: 'Dispute response recorded',
        body: input.body.slice(0, 300),
        entityType: 'dispute',
        entityId: disputeId,
        competitionId: current.competitionId,
      });
    }
    return { disputeId, body: input.body, status: current.status };
  });
}

export async function requestDisputeInformation(
  auth: AuthContext,
  disputeId: string,
  input: InformationInput,
) {
  await requireDisputeReview(auth, disputeId);
  return db.transaction(async (tx) => {
    const current = await lockDispute(tx, disputeId);
    if (current.status !== 'under_review') {
      throw conflict('Additional information can only be requested while under review.');
    }
    const [updated] = await tx
      .update(disputes)
      .set({ status: 'awaiting_information', updatedAt: new Date() })
      .where(eq(disputes.id, disputeId))
      .returning();
    if (!updated) throw notFound('Dispute not found.');
    await addEntry(
      tx,
      disputeId,
      auth.userId,
      'information_request',
      input.body,
      'under_review',
      'awaiting_information',
    );
    await auditDispute(
      tx,
      auth.userId,
      'dispute.information_requested',
      current,
      disputeId,
      { status: 'under_review' },
      { status: 'awaiting_information' },
      input.body,
    );
    if (current.submittedBy) {
      await createNotification(tx, current.submittedBy, {
        type: 'dispute.information_requested',
        title: 'Additional information requested',
        body: input.body,
        entityType: 'dispute',
        entityId: disputeId,
        competitionId: current.competitionId,
      });
    }
    return updated;
  });
}

export async function provideDisputeInformation(
  auth: AuthContext,
  disputeId: string,
  input: InformationInput,
) {
  const scope = await requireDisputeView(auth, disputeId);
  const canProvide =
    scope.dispute.submittedBy === auth.userId ||
    (await isDisputeTeamCaptain(auth, scope)) ||
    canReviewDispute(auth, scope);
  if (!canProvide) throw forbidden('You cannot provide information for this dispute.');

  return db.transaction(async (tx) => {
    const current = await lockDispute(tx, disputeId);
    if (current.status !== 'awaiting_information') {
      throw conflict('Information can only be provided while the dispute is awaiting information.');
    }
    const [updated] = await tx
      .update(disputes)
      .set({ status: 'under_review', updatedAt: new Date() })
      .where(eq(disputes.id, disputeId))
      .returning();
    if (!updated) throw notFound('Dispute not found.');
    await addEntry(
      tx,
      disputeId,
      auth.userId,
      'information_provided',
      input.body,
      'awaiting_information',
      'under_review',
    );
    await auditDispute(
      tx,
      auth.userId,
      'dispute.information_provided',
      current,
      disputeId,
      { status: 'awaiting_information' },
      { status: 'under_review' },
      input.body,
    );
    return updated;
  });
}

export async function decideDispute(
  auth: AuthContext,
  disputeId: string,
  input: DecisionInput,
) {
  await requireDisputeReview(auth, disputeId);
  return db.transaction(async (tx) => {
    const current = await lockDispute(tx, disputeId);
    if (!['under_review', 'awaiting_information'].includes(current.status)) {
      throw conflict(`A decision cannot be recorded from status "${current.status}".`);
    }
    const now = new Date();
    const [updated] = await tx
      .update(disputes)
      .set({
        status: 'decided',
        outcome: input.outcome,
        decision: input.decision,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(disputes.id, disputeId))
      .returning();
    if (!updated) throw notFound('Dispute not found.');
    await addEntry(
      tx,
      disputeId,
      auth.userId,
      'decision',
      input.decision,
      current.status,
      'decided',
    );
    await auditDispute(
      tx,
      auth.userId,
      'dispute.decided',
      current,
      disputeId,
      { status: current.status },
      { status: 'decided', outcome: input.outcome, decision: input.decision },
      input.reason ?? null,
    );
    if (current.submittedBy) {
      await createNotification(tx, current.submittedBy, {
        type: 'dispute.decided',
        title: `Dispute decided: ${input.outcome}`,
        body: input.decision,
        entityType: 'dispute',
        entityId: disputeId,
        competitionId: current.competitionId,
      });
    }
    // A dispute decision never mutates match results or events directly.
    // Result changes must use the Phase 5 correction endpoints separately.
    return updated;
  });
}

export async function closeDispute(
  auth: AuthContext,
  disputeId: string,
  input: CloseInput,
) {
  await requireDisputeReview(auth, disputeId);
  return db.transaction(async (tx) => {
    const current = await lockDispute(tx, disputeId);
    if (current.status === 'closed') throw conflict('The dispute is already closed.');
    if (current.status !== 'decided') {
      throw conflict('Only a decided dispute can be closed.');
    }
    const now = new Date();
    const [updated] = await tx
      .update(disputes)
      .set({
        status: 'closed',
        closedAt: now,
        closureReason: input.reason,
        updatedAt: now,
      })
      .where(eq(disputes.id, disputeId))
      .returning();
    if (!updated) throw notFound('Dispute not found.');
    await addEntry(tx, disputeId, auth.userId, 'status_change', input.reason, 'decided', 'closed');
    await auditDispute(
      tx,
      auth.userId,
      'dispute.closed',
      current,
      disputeId,
      { status: 'decided' },
      { status: 'closed', closedAt: now },
      input.reason,
    );
    return updated;
  });
}
