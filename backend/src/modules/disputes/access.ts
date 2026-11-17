import { eq } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  competitions,
  disputes,
  seasons,
  teamRegistrations,
} from '../../database/schema/index.js';
import { forbidden, notFound } from '../../shared/errors.js';
import {
  hasPermissionInCompetition,
  isSuperAdmin,
  type AuthContext,
} from '../../security/context.js';
import { isCompetitionAdministrator, isTeamCaptain } from '../../security/access.js';
import { PERMISSIONS } from '../../security/permissions.js';

export interface DisputeScope {
  dispute: typeof disputes.$inferSelect;
  competition: typeof competitions.$inferSelect;
  season: typeof seasons.$inferSelect | null;
}

export async function loadDisputeScope(disputeId: string): Promise<DisputeScope> {
  const [row] = await db
    .select({
      dispute: disputes,
      competition: competitions,
      season: seasons,
    })
    .from(disputes)
    .innerJoin(competitions, eq(disputes.competitionId, competitions.id))
    .leftJoin(seasons, eq(disputes.seasonId, seasons.id))
    .where(eq(disputes.id, disputeId));
  if (!row) throw notFound('Dispute not found.');
  return row;
}

export function canManageDispute(auth: AuthContext | null, scope: DisputeScope): boolean {
  if (!auth) return false;
  if (isSuperAdmin(auth)) return true;
  return (
    isCompetitionAdministrator(auth, scope.competition.id) &&
    hasPermissionInCompetition(auth, PERMISSIONS.disputesManage, scope.competition.id)
  );
}

export function canReviewDispute(auth: AuthContext | null, scope: DisputeScope): boolean {
  if (!auth) return false;
  return canManageDispute(auth, scope) || scope.dispute.assignedReviewerId === auth.userId;
}

export async function isDisputeTeamCaptain(
  auth: AuthContext,
  scope: DisputeScope,
): Promise<boolean> {
  if (!scope.dispute.teamRegistrationId) return false;
  return isTeamCaptain(auth.userId, scope.dispute.teamRegistrationId);
}

/** Disputes are private by default. Non-visible callers receive `404`. */
export async function canViewDispute(
  auth: AuthContext | null,
  scope: DisputeScope,
): Promise<boolean> {
  if (!auth) return false;
  if (canReviewDispute(auth, scope)) return true;
  if (scope.dispute.submittedBy === auth.userId) return true;
  return isDisputeTeamCaptain(auth, scope);
}

export async function requireDisputeView(
  auth: AuthContext,
  disputeId: string,
): Promise<DisputeScope> {
  const scope = await loadDisputeScope(disputeId);
  if (!(await canViewDispute(auth, scope))) throw notFound('Dispute not found.');
  return scope;
}

export async function requireDisputeManage(
  auth: AuthContext,
  disputeId: string,
): Promise<DisputeScope> {
  const scope = await loadDisputeScope(disputeId);
  if (!(await canViewDispute(auth, scope))) throw notFound('Dispute not found.');
  if (!canManageDispute(auth, scope)) {
    throw forbidden('Dispute management requires administrative scope.');
  }
  return scope;
}

export async function requireDisputeReview(
  auth: AuthContext,
  disputeId: string,
): Promise<DisputeScope> {
  const scope = await loadDisputeScope(disputeId);
  if (!(await canViewDispute(auth, scope))) throw notFound('Dispute not found.');
  if (!canReviewDispute(auth, scope)) {
    throw forbidden('Only the assigned reviewer or an administrator can review this dispute.');
  }
  return scope;
}

export async function disputeTeamSeason(
  teamRegistrationId: string,
): Promise<{ seasonId: string; competitionId: string } | null> {
  const [row] = await db
    .select({
      seasonId: teamRegistrations.seasonId,
      competitionId: seasons.competitionId,
    })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(eq(teamRegistrations.id, teamRegistrationId));
  return row ?? null;
}
