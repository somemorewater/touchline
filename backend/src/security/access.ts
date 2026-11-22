import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { db } from '../database/client.js';
import {
  competitions,
  competitionGroups,
  fixtures,
  matchOfficials,
  matches,
  playerRegistrations,
  seasons,
  teamRegistrations,
} from '../database/schema/index.js';
import { forbidden } from '../shared/errors.js';
import {
  competitionScopesFor,
  hasPermission,
  hasPermissionInCompetition,
  isSuperAdmin,
  isSuperAdminIn,
  type AuthContext,
} from './context.js';
import { PERMISSIONS, ROLES, type RoleName } from './permissions.js';

export const PUBLIC_COMPETITION_STATUSES = [
  'published',
  'active',
  'completed',
  'archived',
] as const;

export const PUBLIC_LINEUP_STATUSES = ['published'] as const;

export interface CompetitionVisibility {
  id: string;
  status: string;
  visibility: string;
}

export interface MatchScope {
  matchId: string;
  fixtureId: string;
  seasonId: string;
  competitionId: string;
  competitionStatus: string;
  competitionVisibility: string;
  fixturePublishedAt: Date | null;
  fixtureScheduledAt: Date | null;
  fixtureStatus: string;
  matchStatus: string;
  homeTeamRegistrationId: string;
  awayTeamRegistrationId: string;
}

export function isPublicCompetition(record: { status: string; visibility: string }): boolean {
  return (
    record.visibility === 'public' &&
    (PUBLIC_COMPETITION_STATUSES as readonly string[]).includes(record.status)
  );
}

export function isPublicFixture(fixture: { publishedAt: Date | null }): boolean {
  return fixture.publishedAt !== null && fixture.publishedAt.getTime() <= Date.now();
}

/** SQL predicate matching competitions that anonymous callers may see. */
export function publicCompetitionCondition() {
  return and(
    eq(competitions.visibility, 'public'),
    inArray(competitions.status, [...PUBLIC_COMPETITION_STATUSES]),
  )!;
}

/** SQL predicate matching fixtures that anonymous callers may see. */
export function publicFixtureCondition() {
  return and(
    isNotNull(fixtures.publishedAt),
    lte(fixtures.publishedAt, new Date()),
    inArray(
      fixtures.seasonId,
      db
        .select({ id: seasons.id })
        .from(seasons)
        .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
        .where(publicCompetitionCondition()),
    ),
  )!;
}

/** Subquery of competition IDs that anonymous callers may see. */
export function publicCompetitionIds() {
  return db.select({ id: competitions.id }).from(competitions).where(publicCompetitionCondition());
}

export async function getCompetitionVisibility(
  competitionId: string,
): Promise<CompetitionVisibility | null> {
  const [row] = await db
    .select({ id: competitions.id, status: competitions.status, visibility: competitions.visibility })
    .from(competitions)
    .where(eq(competitions.id, competitionId));
  return row ?? null;
}

export async function resolveCompetitionForSeason(seasonId: string): Promise<string | null> {
  const [row] = await db
    .select({ competitionId: seasons.competitionId })
    .from(seasons)
    .where(eq(seasons.id, seasonId));
  return row?.competitionId ?? null;
}

export async function resolveCompetitionForGroup(groupId: string): Promise<string | null> {
  const [row] = await db
    .select({ competitionId: seasons.competitionId })
    .from(competitionGroups)
    .innerJoin(seasons, eq(competitionGroups.seasonId, seasons.id))
    .where(eq(competitionGroups.id, groupId));
  return row?.competitionId ?? null;
}

export async function resolveCompetitionForTeamRegistration(
  registrationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ competitionId: seasons.competitionId })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(eq(teamRegistrations.id, registrationId));
  return row?.competitionId ?? null;
}

export async function loadMatchScope(matchId: string): Promise<MatchScope | null> {
  const [row] = await db
    .select({
      matchId: matches.id,
      fixtureId: fixtures.id,
      seasonId: fixtures.seasonId,
      competitionId: seasons.competitionId,
      competitionStatus: competitions.status,
      competitionVisibility: competitions.visibility,
      fixturePublishedAt: fixtures.publishedAt,
      fixtureScheduledAt: fixtures.scheduledAt,
      fixtureStatus: fixtures.status,
      matchStatus: matches.status,
      homeTeamRegistrationId: fixtures.homeTeamRegistrationId,
      awayTeamRegistrationId: fixtures.awayTeamRegistrationId,
    })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(matches.id, matchId));
  return row ?? null;
}

export function isCompetitionAdministrator(
  auth: AuthContext | null,
  competitionId: string,
): boolean {
  if (!auth) return false;
  if (isSuperAdminIn(auth, competitionId)) return true;
  return (
    auth.globalRoles.has(ROLES.competitionAdmin) ||
    (auth.scopedRoles.get(competitionId)?.has(ROLES.competitionAdmin) ?? false)
  );
}

export function canViewCompetition(
  auth: AuthContext | null,
  record: CompetitionVisibility,
): boolean {
  if (isPublicCompetition(record)) return true;
  if (!auth) return false;
  return (
    hasPermissionInCompetition(auth, PERMISSIONS.competitionsRead, record.id) ||
    hasPermissionInCompetition(auth, PERMISSIONS.competitionsUpdate, record.id) ||
    hasPermissionInCompetition(auth, PERMISSIONS.competitionsPublish, record.id)
  );
}

export async function canViewCompetitionById(
  auth: AuthContext | null,
  competitionId: string,
): Promise<boolean> {
  const record = await getCompetitionVisibility(competitionId);
  return record ? canViewCompetition(auth, record) : false;
}

export function canManageCompetition(
  auth: AuthContext | null,
  permission: string,
  competitionId: string,
): boolean {
  if (!auth) return false;
  return (
    isCompetitionAdministrator(auth, competitionId) &&
    hasPermissionInCompetition(auth, permission, competitionId)
  );
}

/** Registration review is administrative: captains and officials never qualify. */
export function canReviewRegistrationsIn(
  auth: AuthContext | null,
  competitionId: string,
): boolean {
  return canManageCompetition(auth, PERMISSIONS.registrationsReview, competitionId);
}

/**
 * A team entity is global, so administrative authority is derived from the
 * competitions where it has participation records. Teams with no entries are
 * super-admin only, because there is no scope to prove authority against.
 */
export async function canManageTeamEntity(
  auth: AuthContext | null,
  teamId: string,
  permission: string,
): Promise<boolean> {
  if (!auth) return false;
  if (isSuperAdmin(auth)) return true;
  const rows = await db
    .select({ competitionId: seasons.competitionId })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(eq(teamRegistrations.teamId, teamId))
    .groupBy(seasons.competitionId);
  return rows.some((row) => canManageCompetition(auth, permission, row.competitionId));
}

/** Administrative team-entry operations exclude the captain ownership path. */
export async function canAdministerTeamRegistration(
  auth: AuthContext | null,
  registrationId: string,
  permission: string,
): Promise<boolean> {
  if (!auth) return false;
  const competitionId = await resolveCompetitionForTeamRegistration(registrationId);
  if (!competitionId) return false;
  return (
    isCompetitionAdministrator(auth, competitionId) &&
    hasPermissionInCompetition(auth, permission, competitionId)
  );
}

export async function isCaptainOfTeam(
  auth: AuthContext | null,
  teamId: string,
): Promise<boolean> {
  if (!auth) return false;
  const [row] = await db
    .select({ id: teamRegistrations.id })
    .from(teamRegistrations)
    .where(
      and(
        eq(teamRegistrations.teamId, teamId),
        eq(teamRegistrations.captainUserId, auth.userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Team entities are global, but their visibility comes from participation.
 * Anonymous callers only see teams with an approved entry in a public
 * competition. Captains see teams they own; administrators see teams with an
 * entry in a competition where they hold a team permission.
 */
export async function canViewTeamEntity(
  auth: AuthContext | null,
  teamId: string,
): Promise<boolean> {
  if (auth && isSuperAdmin(auth)) return true;
  if (await isCaptainOfTeam(auth, teamId)) return true;

  if (auth) {
    const scopes = [
      ...new Set([
        ...competitionScopesFor(auth, PERMISSIONS.teamsManage),
        ...competitionScopesFor(auth, PERMISSIONS.teamsRead),
      ]),
    ];
    if (scopes.length > 0) {
      const [managed] = await db
        .select({ id: teamRegistrations.id })
        .from(teamRegistrations)
        .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
        .where(
          and(
            eq(teamRegistrations.teamId, teamId),
            inArray(seasons.competitionId, scopes),
          ),
        )
        .limit(1);
      if (managed) return true;
    }
  }

  const [publicEntry] = await db
    .select({ id: teamRegistrations.id })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(
      and(
        eq(teamRegistrations.teamId, teamId),
        eq(teamRegistrations.status, 'approved'),
        publicCompetitionCondition(),
      ),
    )
    .limit(1);
  return Boolean(publicEntry);
}

export function canReadPrivateMatch(auth: AuthContext | null, scope: MatchScope): boolean {
  if (!auth) return false;
  return (
    hasPermissionInCompetition(auth, PERMISSIONS.fixturesManage, scope.competitionId) ||
    hasPermissionInCompetition(auth, PERMISSIONS.matchesManage, scope.competitionId) ||
    hasPermissionInCompetition(auth, PERMISSIONS.competitionsUpdate, scope.competitionId)
  );
}

export async function isMatchOfficial(userId: string, matchId: string): Promise<boolean> {
  const [row] = await db
    .select({ matchId: matchOfficials.matchId })
    .from(matchOfficials)
    .where(and(eq(matchOfficials.matchId, matchId), eq(matchOfficials.userId, userId)));
  return Boolean(row);
}

export async function isTeamCaptain(userId: string, registrationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: teamRegistrations.id })
    .from(teamRegistrations)
    .where(
      and(
        eq(teamRegistrations.id, registrationId),
        eq(teamRegistrations.captainUserId, userId),
      ),
    );
  return Boolean(row);
}

export function isPublicMatch(scope: MatchScope): boolean {
  return (
    isPublicFixture({ publishedAt: scope.fixturePublishedAt }) &&
    isPublicCompetition({
      status: scope.competitionStatus,
      visibility: scope.competitionVisibility,
    })
  );
}

/** Assigned match officials may publish only lineups for their own matches. */
export async function canPublishMatchLineup(
  auth: AuthContext | null,
  scope: MatchScope,
): Promise<boolean> {
  if (!auth) return false;
  if (hasPermissionInCompetition(auth, PERMISSIONS.matchesManage, scope.competitionId) ||
      hasPermissionInCompetition(auth, PERMISSIONS.fixturesManage, scope.competitionId)) return true;
  if (!hasPermission(auth, PERMISSIONS.lineupsManage)) return false;
  return isMatchOfficial(auth.userId, scope.matchId);
}

export async function canReadMatch(
  auth: AuthContext | null,
  scope: MatchScope,
): Promise<boolean> {
  if (isPublicMatch(scope)) return true;
  if (!auth) return false;
  if (canReadPrivateMatch(auth, scope)) return true;
  if (await isMatchOfficial(auth.userId, scope.matchId)) return true;
  return (
    (await isTeamCaptain(auth.userId, scope.homeTeamRegistrationId)) ||
    (await isTeamCaptain(auth.userId, scope.awayTeamRegistrationId))
  );
}

/** Match reporting requires an administrative grant or an explicit official assignment. */
export async function canReportMatch(auth: AuthContext | null, scope: MatchScope): Promise<boolean> {
  if (!auth) return false;
  if (hasPermissionInCompetition(auth, PERMISSIONS.matchesManage, scope.competitionId)) {
    return true;
  }
  if (!hasPermissionInCompetition(auth, PERMISSIONS.matchesReport, scope.competitionId)) {
    return false;
  }
  return isMatchOfficial(auth.userId, scope.matchId);
}

/**
 * Team management is ownership-first. A captain manages only registrations
 * where they are the captain; competition administrators manage within their
 * explicit competition scope.
 */
export async function canManageTeamRegistration(
  auth: AuthContext | null,
  registrationId: string,
  permission: string,
): Promise<boolean> {
  if (!auth) return false;
  if (
    hasPermission(auth, permission) &&
    (await isTeamCaptain(auth.userId, registrationId))
  ) {
    return true;
  }
  const competitionId = await resolveCompetitionForTeamRegistration(registrationId);
  if (!competitionId) return false;
  return (
    isCompetitionAdministrator(auth, competitionId) &&
    hasPermissionInCompetition(auth, permission, competitionId)
  );
}

export interface LineupOwnership {
  matchId: string;
  teamRegistrationId: string;
}

/** Player records inherit the ownership/scope of their team registration. */
export async function canManagePlayerRegistration(
  auth: AuthContext | null,
  playerRegistrationId: string,
  permission: string,
): Promise<boolean> {
  const [row] = await db
    .select({ teamRegistrationId: playerRegistrations.teamRegistrationId })
    .from(playerRegistrations)
    .where(eq(playerRegistrations.id, playerRegistrationId));
  if (!row) return false;
  return canManageTeamRegistration(auth, row.teamRegistrationId, permission);
}

export async function canManageLineup(
  auth: AuthContext | null,
  lineup: LineupOwnership,
  permission: string,
): Promise<boolean> {
  if (!auth) return false;
  if (!hasPermission(auth, permission)) return false;
  if (await isTeamCaptain(auth.userId, lineup.teamRegistrationId)) return true;
  if (await isMatchOfficial(auth.userId, lineup.matchId)) return true;
  const scope = await loadMatchScope(lineup.matchId);
  if (!scope) return false;
  return (
    isCompetitionAdministrator(auth, scope.competitionId) &&
    hasPermissionInCompetition(auth, permission, scope.competitionId)
  );
}

export interface RoleAssignmentRequest {
  targetUserId: string;
  role: RoleName;
  competitionId: string | null;
}

const SELF_SERVICE_ROLES: readonly string[] = [ROLES.registeredUser, ROLES.visitor];
const COMPETITION_ADMIN_ONLY_ROLES: readonly string[] = [ROLES.competitionAdmin, ROLES.superAdmin];

/**
 * Central privilege-escalation guard for role-management routes.
 *
 * - A global super administrator may grant any non-system role globally or in
 *   a competition scope.
 * - A competition administrator may grant only team_captain or match_official
 *   inside a competition they administer and for which they hold roles.manage.
 * - Nobody may assign roles to themselves, and system roles cannot be granted.
 */
export async function assertRoleAssignmentAllowed(
  actor: AuthContext,
  request: RoleAssignmentRequest,
): Promise<void> {
  if (actor.userId === request.targetUserId) throw forbidden('You cannot modify your own roles.');
  if (SELF_SERVICE_ROLES.includes(request.role)) {
    throw forbidden('This role is assigned by the system and cannot be granted manually.');
  }

  if (isSuperAdmin(actor)) return;

  if (request.competitionId === null) {
    throw forbidden('Only a super administrator can grant a global role.');
  }
  if (
    !isCompetitionAdministrator(actor, request.competitionId) ||
    !hasPermissionInCompetition(actor, PERMISSIONS.rolesManage, request.competitionId)
  ) {
    throw forbidden('You cannot assign roles outside a competition you administer.');
  }
  if (COMPETITION_ADMIN_ONLY_ROLES.includes(request.role)) {
    throw forbidden('Competition administrators cannot grant administrator roles.');
  }
  const competition = await getCompetitionVisibility(request.competitionId);
  if (!competition) throw forbidden();
}

/**
 * Competition-level lineup administration. Deliberately based on match or
 * fixture management rather than `lineups.manage`: match officials also hold
 * the lineups permission but must not become competition-wide lineup
 * administrators through a match assignment.
 */
export function canManageCompetitionLineups(
  auth: AuthContext | null,
  competitionId: string,
): boolean {
  if (!auth) return false;
  return (
    hasPermissionInCompetition(auth, PERMISSIONS.matchesManage, competitionId) ||
    hasPermissionInCompetition(auth, PERMISSIONS.fixturesManage, competitionId)
  );
}

/** Captains own one team entry; competition administrators own the scope. */
export async function canManageTeamLineup(
  auth: AuthContext | null,
  scope: MatchScope,
  teamRegistrationId: string,
): Promise<boolean> {
  if (!auth) return false;
  if (canManageCompetitionLineups(auth, scope.competitionId)) return true;
  return isTeamCaptain(auth.userId, teamRegistrationId);
}

/** Only competition administrators/super admins may review or confirm lineups. */
export function canReviewLineups(
  auth: AuthContext | null,
  competitionId: string,
): boolean {
  return canManageCompetitionLineups(auth, competitionId);
}
