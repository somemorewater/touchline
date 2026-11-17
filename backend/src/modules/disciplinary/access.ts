import { eq } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  competitions,
  disciplinaryCases,
  playerRegistrations,
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

export interface CaseScope {
  case: typeof disciplinaryCases.$inferSelect;
  competition: typeof competitions.$inferSelect;
  season: typeof seasons.$inferSelect | null;
}

export async function loadCaseScope(caseId: string): Promise<CaseScope> {
  const [row] = await db
    .select({
      case: disciplinaryCases,
      competition: competitions,
      season: seasons,
    })
    .from(disciplinaryCases)
    .innerJoin(competitions, eq(disciplinaryCases.competitionId, competitions.id))
    .leftJoin(seasons, eq(disciplinaryCases.seasonId, seasons.id))
    .where(eq(disciplinaryCases.id, caseId));
  if (!row) throw notFound('Disciplinary case not found.');
  return row;
}

export function canManageCase(auth: AuthContext | null, scope: CaseScope): boolean {
  if (!auth) return false;
  if (isSuperAdmin(auth)) return true;
  return (
    isCompetitionAdministrator(auth, scope.competition.id) &&
    hasPermissionInCompetition(auth, PERMISSIONS.disciplinaryManage, scope.competition.id)
  );
}

export function canReviewCase(auth: AuthContext | null, scope: CaseScope): boolean {
  if (!auth) return false;
  if (canManageCase(auth, scope)) return true;
  return scope.case.assignedReviewerId === auth.userId;
}

async function isCaseSubjectCaptain(
  auth: AuthContext,
  scope: CaseScope,
): Promise<boolean> {
  if (scope.case.subjectUserId === auth.userId) return true;
  if (scope.case.subjectTeamRegistrationId) {
    if (await isTeamCaptain(auth.userId, scope.case.subjectTeamRegistrationId)) return true;
  }
  if (scope.case.subjectPlayerRegistrationId) {
    const [row] = await db
      .select({ teamRegistrationId: playerRegistrations.teamRegistrationId })
      .from(playerRegistrations)
      .where(eq(playerRegistrations.id, scope.case.subjectPlayerRegistrationId));
    if (row && (await isTeamCaptain(auth.userId, row.teamRegistrationId))) return true;
  }
  return false;
}

/** Private case visibility. Non-visible callers receive `404`. */
export async function canViewCase(auth: AuthContext | null, scope: CaseScope): Promise<boolean> {
  if (!auth) return false;
  if (canReviewCase(auth, scope)) return true;
  if (scope.case.createdBy === auth.userId) return true;
  return isCaseSubjectCaptain(auth, scope);
}

export async function requireCaseView(auth: AuthContext, caseId: string): Promise<CaseScope> {
  const scope = await loadCaseScope(caseId);
  if (!(await canViewCase(auth, scope))) throw notFound('Disciplinary case not found.');
  return scope;
}

export async function requireCaseManage(auth: AuthContext, caseId: string): Promise<CaseScope> {
  const scope = await loadCaseScope(caseId);
  if (!(await canViewCase(auth, scope))) throw notFound('Disciplinary case not found.');
  if (!canManageCase(auth, scope)) {
    throw forbidden('Disciplinary case management requires administrative scope.');
  }
  return scope;
}

export async function requireCaseReview(auth: AuthContext, caseId: string): Promise<CaseScope> {
  const scope = await loadCaseScope(caseId);
  if (!(await canViewCase(auth, scope))) throw notFound('Disciplinary case not found.');
  if (!canReviewCase(auth, scope)) {
    throw forbidden('Only the assigned reviewer or an administrator can review this case.');
  }
  return scope;
}

export async function teamRegistrationSeason(
  teamRegistrationId: string,
): Promise<{ id: string; seasonId: string } | null> {
  const [row] = await db
    .select({ id: teamRegistrations.id, seasonId: teamRegistrations.seasonId })
    .from(teamRegistrations)
    .where(eq(teamRegistrations.id, teamRegistrationId));
  return row ?? null;
}
