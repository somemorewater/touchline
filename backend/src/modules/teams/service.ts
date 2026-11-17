import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  competitionGroups,
  competitions,
  playerRegistrations,
  roles,
  seasons,
  teamRegistrations,
  teams,
  userRoles,
  users,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import {
  competitionScopesFor,
  hasPermission,
  isSuperAdmin,
} from '../../security/context.js';
import {
  canAdministerTeamRegistration,
  canManageCompetition,
  canManageTeamEntity,
  canViewCompetition,
  canViewTeamEntity,
  isCaptainOfTeam,
  publicCompetitionCondition,
  resolveCompetitionForSeason,
} from '../../security/access.js';
import { PERMISSIONS, ROLES } from '../../security/permissions.js';
import { hashPassword } from '../../security/passwords.js';
import type {
  captainAccountCreateSchema,
  teamCreateSchema,
  teamEntryCreateSchema,
  teamEntryUpdateSchema,
  teamListQuerySchema,
  teamUpdateSchema,
} from './schemas.js';
import type { z } from 'zod';

type TeamCreate = z.infer<typeof teamCreateSchema>;
type TeamUpdate = z.infer<typeof teamUpdateSchema>;
type TeamListQuery = z.infer<typeof teamListQuerySchema>;
type TeamEntryCreate = z.infer<typeof teamEntryCreateSchema>;
type TeamEntryUpdate = z.infer<typeof teamEntryUpdateSchema>;
type CaptainAccountCreate = z.infer<typeof captainAccountCreateSchema>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const TEAM_ENTRY_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['submitted', 'under_review', 'approved', 'rejected'],
  submitted: ['under_review', 'approved', 'rejected', 'withdrawn'],
  under_review: ['approved', 'rejected', 'withdrawn'],
  approved: ['rejected', 'withdrawn'],
  rejected: ['submitted'],
  withdrawn: ['submitted'],
};

async function assertTeamNameAvailable(name: string, excludeTeamId?: string): Promise<void> {
  const conditions: SQL[] = [
    sql`lower(${teams.name}) = ${name.toLowerCase()}`,
    isNull(teams.archivedAt),
  ];
  if (excludeTeamId) conditions.push(ne(teams.id, excludeTeamId));
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(...conditions))
    .limit(1);
  if (row) throw conflict('An active team with this name already exists.');
}

function assertSeasonAcceptsTeams(status: string): void {
  if (status !== 'planned' && status !== 'active') {
    throw conflict('Team entries require a planned or active season.');
  }
}

function assertSeasonSupportsTeamManagement(status: string): void {
  if (status !== 'planned' && status !== 'active') {
    throw conflict('Team management requires a planned or active season.');
  }
}

async function assertGroupInSeason(groupId: string, seasonId: string): Promise<void> {
  const [group] = await db
    .select({ id: competitionGroups.id, archivedAt: competitionGroups.archivedAt })
    .from(competitionGroups)
    .where(
      and(eq(competitionGroups.id, groupId), eq(competitionGroups.seasonId, seasonId)),
    );
  if (!group) throw badRequest('groupId does not belong to this season.');
  if (group.archivedAt) throw conflict('Archived groups cannot receive team entries.');
}

async function loadSeasonForTeamWrite(auth: AuthContext, seasonId: string) {
  const [row] = await db
    .select({ season: seasons, competition: competitions })
    .from(seasons)
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(seasons.id, seasonId));
  if (!row) throw notFound('Season not found.');
  if (!canManageCompetition(auth, PERMISSIONS.teamsManage, row.competition.id)) {
    if (!canViewCompetition(auth, row.competition)) throw notFound('Season not found.');
    throw forbidden();
  }
  if (row.competition.status === 'archived') {
    throw conflict('Archived competitions are read-only.');
  }
  return row;
}

interface TeamEntryScope {
  registration: typeof teamRegistrations.$inferSelect;
  team: typeof teams.$inferSelect;
  season: typeof seasons.$inferSelect;
  competition: typeof competitions.$inferSelect;
}

async function loadTeamEntryScope(registrationId: string): Promise<TeamEntryScope> {
  const [row] = await db
    .select({
      registration: teamRegistrations,
      team: teams,
      season: seasons,
      competition: competitions,
    })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(teamRegistrations.id, registrationId));
  if (!row) throw notFound('Team entry not found.');
  return row;
}

function canViewTeamEntry(auth: AuthContext | null, scope: TeamEntryScope): boolean {
  if (auth) {
    if (isSuperAdmin(auth)) return true;
    if (scope.registration.captainUserId === auth.userId) return true;
    if (
      canManageCompetition(auth, PERMISSIONS.teamsRead, scope.competition.id) ||
      canManageCompetition(auth, PERMISSIONS.teamsManage, scope.competition.id)
    ) {
      return true;
    }
  }
  return (
    scope.registration.status === 'approved' &&
    scope.competition.visibility === 'public' &&
    ['published', 'active', 'completed', 'archived'].includes(scope.competition.status)
  );
}

async function assertCanAdministerEntry(
  auth: AuthContext,
  registrationId: string,
  permission: string,
): Promise<void> {
  if (await canAdministerTeamRegistration(auth, registrationId, permission)) return;
  const competitionId = await resolveCompetitionForSeason(
    (await loadTeamEntryScope(registrationId)).registration.seasonId,
  );
  if (!competitionId) throw notFound('Team entry not found.');
  if (!canManageCompetition(auth, permission, competitionId)) {
    if (await canViewCompetitionByIdOrNull(auth, competitionId)) throw forbidden();
    throw notFound('Team entry not found.');
  }
}

async function canViewCompetitionByIdOrNull(
  auth: AuthContext | null,
  competitionId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ status: competitions.status, visibility: competitions.visibility })
    .from(competitions)
    .where(eq(competitions.id, competitionId));
  return row ? canViewCompetition(auth, { id: competitionId, ...row }) : false;
}

export async function createTeam(auth: AuthContext, input: TeamCreate) {
  if (!input.seasonId) {
    if (!isSuperAdmin(auth)) {
      throw forbidden('seasonId is required to prove competition scope.');
    }
    await assertTeamNameAvailable(input.name);
    const [team] = await db
      .insert(teams)
      .values({
        name: input.name,
        shortName: input.shortName ?? null,
        department: input.department ?? null,
      })
      .returning();
    if (!team) throw new Error('Team insert did not return a row.');
    return { ...team, registration: null };
  }

  const { season, competition } = await loadSeasonForTeamWrite(auth, input.seasonId);
  assertSeasonAcceptsTeams(season.status);
  if (input.groupId) await assertGroupInSeason(input.groupId, season.id);
  await assertTeamNameAvailable(input.name);

  const team = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(teams)
      .values({
        name: input.name,
        shortName: input.shortName ?? null,
        department: input.department ?? null,
      })
      .returning();
    if (!created) throw new Error('Team insert did not return a row.');

    const [registration] = await tx
      .insert(teamRegistrations)
      .values({
        teamId: created.id,
        seasonId: season.id,
        groupId: input.groupId ?? null,
        status: 'draft',
      })
      .returning();
    if (!registration) throw new Error('Team entry insert did not return a row.');

    return { ...created, registration };
  });

  return { ...team, competitionId: competition.id, seasonId: season.id };
}

export async function listTeams(auth: AuthContext | null, filters: TeamListQuery) {
  const conditions: SQL[] = [isNull(teams.archivedAt)];
  if (filters.seasonId) conditions.push(eq(teamRegistrations.seasonId, filters.seasonId));
  if (filters.competitionId) {
    conditions.push(eq(seasons.competitionId, filters.competitionId));
  }

  const globalManager = Boolean(
    auth && (isSuperAdmin(auth) || hasPermission(auth, PERMISSIONS.teamsManage)),
  );

  if (!globalManager) {
    const visibility: SQL[] = [
      and(
        eq(teamRegistrations.status, 'approved'),
        publicCompetitionCondition(),
      )!,
    ];
    if (auth) {
      visibility.push(eq(teamRegistrations.captainUserId, auth.userId));
      const scopes = [
        ...new Set([
          ...competitionScopesFor(auth, PERMISSIONS.teamsManage),
          ...competitionScopesFor(auth, PERMISSIONS.teamsRead),
        ]),
      ];
      if (scopes.length > 0) {
        visibility.push(inArray(seasons.competitionId, scopes));
      }
    }
    conditions.push(or(...visibility)!);
  }

  const rows = await db
    .select({ team: teams })
    .from(teams)
    .innerJoin(teamRegistrations, eq(teamRegistrations.teamId, teams.id))
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(and(...conditions))
    .orderBy(asc(teams.name));

  const unique = new Map(rows.map((row) => [row.team.id, row.team]));
  return [...unique.values()];
}

export async function getTeam(auth: AuthContext | null, teamId: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) throw notFound('Team not found.');

  const manager = await canManageTeamEntity(auth, teamId, PERMISSIONS.teamsRead);
  const captain = await isCaptainOfTeam(auth, teamId);
  if (team.archivedAt && !manager && !captain) throw notFound('Team not found.');
  if (!(await canViewTeamEntity(auth, teamId))) throw notFound('Team not found.');

  const conditions: SQL[] = [eq(teamRegistrations.teamId, teamId)];
  if (!manager) {
    if (captain) {
      conditions.push(eq(teamRegistrations.captainUserId, auth!.userId));
    } else {
      conditions.push(eq(teamRegistrations.status, 'approved'));
      conditions.push(publicCompetitionCondition());
    }
  }

  const entries = await db
    .select({
      registration: teamRegistrations,
      season: seasons,
      competition: competitions,
    })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(and(...conditions))
    .orderBy(asc(seasons.startsOn));

  return { ...team, entries };
}

export async function updateTeam(
  auth: AuthContext,
  teamId: string,
  input: TeamUpdate,
) {
  if (!(await canManageTeamEntity(auth, teamId, PERMISSIONS.teamsManage))) {
    throw forbidden();
  }
  const [existing] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!existing) throw notFound('Team not found.');
  if (existing.archivedAt) throw conflict('Archived teams are read-only.');
  if (input.name !== undefined) await assertTeamNameAvailable(input.name, teamId);

  const [row] = await db
    .update(teams)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
      ...(input.department !== undefined ? { department: input.department } : {}),
      updatedAt: new Date(),
    })
    .where(eq(teams.id, teamId))
    .returning();
  if (!row) throw notFound('Team not found.');
  return row;
}

export async function archiveTeam(auth: AuthContext, teamId: string) {
  if (!(await canManageTeamEntity(auth, teamId, PERMISSIONS.teamsManage))) {
    throw forbidden();
  }
  const [existing] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!existing) throw notFound('Team not found.');
  if (existing.archivedAt) throw conflict('Team is already archived.');

  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(
      and(
        eq(teamRegistrations.teamId, teamId),
        inArray(teamRegistrations.status, ['submitted', 'under_review', 'approved']),
        inArray(seasons.status, ['planned', 'active']),
      ),
    );
  if ((active?.count ?? 0) > 0) {
    throw conflict('The team has an active participation record and cannot be archived.');
  }

  const [row] = await db
    .update(teams)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(teams.id, teamId))
    .returning();
  if (!row) throw notFound('Team not found.');
  return row;
}

export async function restoreTeam(auth: AuthContext, teamId: string) {
  if (!(await canManageTeamEntity(auth, teamId, PERMISSIONS.teamsManage))) {
    throw forbidden();
  }
  const [existing] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!existing) throw notFound('Team not found.');
  if (!existing.archivedAt) throw conflict('Team is not archived.');
  await assertTeamNameAvailable(existing.name, teamId);

  const [row] = await db
    .update(teams)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(teams.id, teamId))
    .returning();
  if (!row) throw notFound('Team not found.');
  return row;
}

export async function createTeamEntry(
  auth: AuthContext,
  seasonId: string,
  input: TeamEntryCreate,
) {
  const { season } = await loadSeasonForTeamWrite(auth, seasonId);
  assertSeasonAcceptsTeams(season.status);

  const [team] = await db.select().from(teams).where(eq(teams.id, input.teamId));
  if (!team) throw badRequest('teamId does not identify a team.');
  if (team.archivedAt) throw conflict('Archived teams cannot enter a season.');
  if (input.groupId) await assertGroupInSeason(input.groupId, seasonId);

  const [existing] = await db
    .select({ id: teamRegistrations.id })
    .from(teamRegistrations)
    .where(
      and(
        eq(teamRegistrations.teamId, input.teamId),
        eq(teamRegistrations.seasonId, seasonId),
      ),
    );
  if (existing) throw conflict('This team already has an entry in the season.');

  const [row] = await db
    .insert(teamRegistrations)
    .values({
      teamId: input.teamId,
      seasonId,
      groupId: input.groupId ?? null,
      status: 'draft',
    })
    .returning();
  if (!row) throw new Error('Team entry insert did not return a row.');
  return { registration: row, team };
}

export async function listTeamEntries(auth: AuthContext | null, seasonId: string) {
  const competitionId = await resolveCompetitionForSeason(seasonId);
  if (!competitionId) throw notFound('Season not found.');

  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, competitionId));
  if (!competition || !canViewCompetition(auth, competition)) {
    throw notFound('Season not found.');
  }

  const manager = canManageCompetition(auth, PERMISSIONS.teamsRead, competitionId);
  const conditions: SQL[] = [eq(teamRegistrations.seasonId, seasonId)];
  if (!manager) {
    const visibility: SQL[] =
      competition.visibility === 'public'
        ? [eq(teamRegistrations.status, 'approved')]
        : [];
    if (auth) visibility.push(eq(teamRegistrations.captainUserId, auth.userId));
    if (visibility.length === 0) return [];
    conditions.push(or(...visibility)!);
  }

  const rows = await db
    .select({ registration: teamRegistrations, team: teams })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .where(and(...conditions))
    .orderBy(asc(teams.name));
  return rows;
}

export async function getTeamEntry(auth: AuthContext | null, registrationId: string) {
  const scope = await loadTeamEntryScope(registrationId);
  if (!canViewTeamEntry(auth, scope)) throw notFound('Team entry not found.');
  return scope;
}

export async function updateTeamEntry(
  auth: AuthContext,
  registrationId: string,
  input: TeamEntryUpdate,
) {
  const scope = await loadTeamEntryScope(registrationId);
  await assertCanAdministerEntry(auth, registrationId, PERMISSIONS.teamsManage);
  if (scope.competition.status === 'archived') {
    throw conflict('Archived competitions are read-only.');
  }
  assertSeasonSupportsTeamManagement(scope.season.status);
  if (input.groupId !== undefined && input.groupId !== null) {
    await assertGroupInSeason(input.groupId, scope.registration.seasonId);
  }

  const now = new Date();
  const nextStatus = input.status;
  let submittedAt = scope.registration.submittedAt;
  let reviewedBy = scope.registration.reviewedBy;
  let reviewedAt = scope.registration.reviewedAt;
  let reviewNote = scope.registration.reviewNote;

  if (nextStatus !== undefined && nextStatus !== scope.registration.status) {
    const allowed = TEAM_ENTRY_TRANSITIONS[scope.registration.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw conflict(
        `Cannot move a team entry from "${scope.registration.status}" to "${nextStatus}".`,
      );
    }
    if (
      scope.registration.status === 'approved' &&
      nextStatus !== 'approved'
    ) {
      const [activePlayers] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(playerRegistrations)
        .where(
          and(
            eq(playerRegistrations.teamRegistrationId, registrationId),
            inArray(playerRegistrations.status, [
              'submitted',
              'under_review',
              'approved',
            ]),
          ),
        );
      if ((activePlayers?.count ?? 0) > 0) {
        throw conflict('The team entry still has active player registrations.');
      }
    }

    if (nextStatus === 'approved' || nextStatus === 'rejected') {
      reviewNote = input.reviewNote !== undefined ? input.reviewNote : reviewNote;
      if (nextStatus === 'rejected' && !reviewNote?.trim()) {
        throw badRequest('A rejection reason is required.');
      }
      reviewedBy = auth.userId;
      reviewedAt = now;
    } else if (nextStatus === 'submitted') {
      submittedAt = now;
      reviewedBy = null;
      reviewedAt = null;
      reviewNote = null;
    }
  } else if (input.reviewNote !== undefined) {
    reviewNote = input.reviewNote;
  }

  const [row] = await db
    .update(teamRegistrations)
    .set({
      ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
      ...(nextStatus !== undefined ? { submittedAt, reviewedBy, reviewedAt, reviewNote } : {}),
      ...(nextStatus === undefined && input.reviewNote !== undefined ? { reviewNote } : {}),
      updatedAt: now,
    })
    .where(eq(teamRegistrations.id, registrationId))
    .returning();
  if (!row) throw notFound('Team entry not found.');
  return row;
}

async function assertCaptainAvailableForSeason(
  tx: Transaction | typeof db,
  userId: string,
  seasonId: string,
  excludeRegistrationId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: teamRegistrations.id })
    .from(teamRegistrations)
    .where(
      and(
        eq(teamRegistrations.seasonId, seasonId),
        eq(teamRegistrations.captainUserId, userId),
        ne(teamRegistrations.id, excludeRegistrationId),
      ),
    )
    .limit(1);
  if (row) {
    throw conflict('This captain is already assigned to another team in the season.');
  }
}

async function assertCaptainRole(userId: string): Promise<void> {
  const [row] = await db
    .select({ id: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(roles.name, ROLES.teamCaptain),
        isNull(userRoles.competitionId),
      ),
    )
    .limit(1);
  if (!row) {
    throw conflict('The user does not hold the global team_captain role.');
  }
}

export async function assignCaptain(
  auth: AuthContext,
  registrationId: string,
  userId: string,
) {
  const scope = await loadTeamEntryScope(registrationId);
  await assertCanAdministerEntry(auth, registrationId, PERMISSIONS.captainsManage);
  if (scope.competition.status === 'archived') {
    throw conflict('Archived competitions are read-only.');
  }
  assertSeasonSupportsTeamManagement(scope.season.status);

  const [user] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true)));
  if (!user) throw badRequest('userId does not identify an active account.');
  await assertCaptainRole(userId);

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ captainUserId: teamRegistrations.captainUserId })
      .from(teamRegistrations)
      .where(eq(teamRegistrations.id, registrationId))
      .for('update');
    if (!locked) throw notFound('Team entry not found.');
    if (locked.captainUserId && locked.captainUserId !== userId) {
      throw conflict('This team entry already has a captain.');
    }
    await assertCaptainAvailableForSeason(
      tx,
      userId,
      scope.registration.seasonId,
      registrationId,
    );

    const [row] = await tx
      .update(teamRegistrations)
      .set({ captainUserId: userId, updatedAt: new Date() })
      .where(eq(teamRegistrations.id, registrationId))
      .returning();
    if (!row) throw notFound('Team entry not found.');
    return { registration: row, captain: user };
  });
}

export async function revokeCaptain(auth: AuthContext, registrationId: string) {
  await assertCanAdministerEntry(auth, registrationId, PERMISSIONS.captainsManage);
  const scope = await loadTeamEntryScope(registrationId);
  if (scope.competition.status === 'archived') {
    throw conflict('Archived competitions are read-only.');
  }
  assertSeasonSupportsTeamManagement(scope.season.status);
  if (!scope.registration.captainUserId) {
    throw conflict('This team entry has no captain.');
  }
  const [row] = await db
    .update(teamRegistrations)
    .set({ captainUserId: null, updatedAt: new Date() })
    .where(eq(teamRegistrations.id, registrationId))
    .returning();
  if (!row) throw notFound('Team entry not found.');
  return row;
}

export async function getCaptainAssignment(
  auth: AuthContext,
  registrationId: string,
) {
  const scope = await loadTeamEntryScope(registrationId);
  const owner = scope.registration.captainUserId === auth.userId;
  if (!owner) {
    await assertCanAdministerEntry(auth, registrationId, PERMISSIONS.captainsManage);
  }

  if (!scope.registration.captainUserId) {
    return { teamRegistrationId: registrationId, captain: null };
  }
  const [captain] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, scope.registration.captainUserId));
  return { teamRegistrationId: registrationId, captain: captain ?? null };
}

export async function provisionCaptain(
  auth: AuthContext,
  input: CaptainAccountCreate,
) {
  const scope = await loadTeamEntryScope(input.teamRegistrationId);
  await assertCanAdministerEntry(
    auth,
    input.teamRegistrationId,
    PERMISSIONS.captainsManage,
  );
  if (scope.competition.status === 'archived') {
    throw conflict('Archived competitions are read-only.');
  }
  assertSeasonSupportsTeamManagement(scope.season.status);
  if (scope.registration.captainUserId) {
    throw conflict('This team entry already has a captain.');
  }

  const email = input.email.toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) throw conflict('An account with this email already exists.');

  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ captainUserId: teamRegistrations.captainUserId })
      .from(teamRegistrations)
      .where(eq(teamRegistrations.id, input.teamRegistrationId))
      .for('update');
    if (!locked) throw notFound('Team entry not found.');
    if (locked.captainUserId) {
      throw conflict('This team entry already has a captain.');
    }

    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, ROLES.teamCaptain));
    if (!role) {
      throw new Error('The security roles have not been seeded.');
    }

    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash, displayName: input.displayName })
      .returning({ id: users.id, email: users.email, displayName: users.displayName });
    if (!user) throw new Error('Captain account insert did not return a row.');

    await tx.insert(userRoles).values({ userId: user.id, roleId: role.id });
    const [registration] = await tx
      .update(teamRegistrations)
      .set({ captainUserId: user.id, updatedAt: new Date() })
      .where(eq(teamRegistrations.id, input.teamRegistrationId))
      .returning();
    if (!registration) throw new Error('Captain assignment did not return a row.');

    return { user, registration };
  });
}

export async function listCaptainTeams(auth: AuthContext) {
  const rows = await db
    .select({
      registration: teamRegistrations,
      team: teams,
      season: seasons,
      competition: competitions,
    })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(teamRegistrations.captainUserId, auth.userId))
    .orderBy(asc(teams.name));
  return rows;
}
