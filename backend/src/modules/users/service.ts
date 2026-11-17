import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  competitions,
  fixtures,
  matchOfficials,
  matches,
  refreshTokens,
  roles,
  seasons,
  sessions,
  teamRegistrations,
  teams,
  userRoles,
  users,
} from '../../database/schema/index.js';
import { conflict, forbidden, notFound } from '../../shared/errors.js';
import {
  competitionScopesFor,
  hasPermission,
  isSuperAdmin,
  type AuthContext,
} from '../../security/context.js';
import { assertRoleAssignmentAllowed } from '../../security/access.js';
import { PERMISSIONS, ROLES, type RoleName } from '../../security/permissions.js';
import { closeUser } from '../../security/connections.js';
import { createNotification } from '../notifications/service.js';
import { sanitizeAuditValue } from '../audit/service.js';
import type {
  userListQuerySchema,
  userRoleGrantSchema,
  userSuspendSchema,
} from './schemas.js';
import type { z } from 'zod';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ListQuery = z.infer<typeof userListQuerySchema>;
type RoleGrant = z.infer<typeof userRoleGrantSchema>;
type SuspendInput = z.infer<typeof userSuspendSchema>;

const userColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  isActive: users.isActive,
  suspendedAt: users.suspendedAt,
  suspendedReason: users.suspendedReason,
  suspendedBy: users.suspendedBy,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

function assertUserManager(auth: AuthContext): void {
  if (!hasPermission(auth, PERMISSIONS.usersManage)) {
    throw forbidden('Account administration requires a global super administrator.');
  }
}

function readScopes(auth: AuthContext): string[] | null {
  if (isSuperAdmin(auth) || hasPermission(auth, PERMISSIONS.usersRead)) return null;
  const scopes = competitionScopesFor(auth, PERMISSIONS.usersRead);
  if (scopes.length === 0) {
    throw forbidden('User administration requires an administrative scope.');
  }
  return scopes;
}

async function auditUser(
  tx: Transaction,
  actorUserId: string,
  action: string,
  targetUserId: string,
  competitionId: string | null,
  before: unknown,
  after: unknown,
  reason?: string | null,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId,
    competitionId,
    action,
    entityType: 'user',
    entityId: targetUserId,
    before: before ?? null,
    after: after ?? null,
    reason: reason ?? null,
  });
}

async function revokeAllSessions(
  tx: Transaction,
  userId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason.slice(0, 40) })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  await tx
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

async function userAssociatedCompetitions(userId: string): Promise<string[]> {
  const [roleScopes, captainScopes, officialScopes] = await Promise.all([
    db
      .select({ competitionId: userRoles.competitionId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), isNotNull(userRoles.competitionId))),
    db
      .select({ competitionId: seasons.competitionId })
      .from(teamRegistrations)
      .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
      .where(eq(teamRegistrations.captainUserId, userId)),
    db
      .select({ competitionId: seasons.competitionId })
      .from(matchOfficials)
      .innerJoin(matches, eq(matchOfficials.matchId, matches.id))
      .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .where(eq(matchOfficials.userId, userId)),
  ]);
  return [
    ...new Set(
      [...roleScopes, ...captainScopes, ...officialScopes]
        .map((row) => row.competitionId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export async function canViewUser(auth: AuthContext, userId: string): Promise<boolean> {
  if (isSuperAdmin(auth) || hasPermission(auth, PERMISSIONS.usersRead)) return true;
  const scopes = competitionScopesFor(auth, PERMISSIONS.usersRead);
  if (scopes.length === 0) return false;
  const associated = await userAssociatedCompetitions(userId);
  return associated.some((competitionId) => scopes.includes(competitionId));
}

export async function listUsers(auth: AuthContext, query: ListQuery) {
  const scopes = readScopes(auth);
  const conditions: SQL[] = [];

  if (scopes) {
    conditions.push(
      or(
        inArray(
          users.id,
          db
            .select({ id: userRoles.userId })
            .from(userRoles)
            .where(inArray(userRoles.competitionId, scopes)),
        ),
        inArray(
          users.id,
          db
            .select({ id: teamRegistrations.captainUserId })
            .from(teamRegistrations)
            .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
            .where(
              and(
                isNotNull(teamRegistrations.captainUserId),
                inArray(seasons.competitionId, scopes),
              ),
            ),
        ),
        inArray(
          users.id,
          db
            .select({ id: matchOfficials.userId })
            .from(matchOfficials)
            .innerJoin(matches, eq(matchOfficials.matchId, matches.id))
            .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
            .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
            .where(inArray(seasons.competitionId, scopes)),
        ),
      )!,
    );
  }
  if (query.competitionId) {
    const competitionScope = query.competitionId;
    conditions.push(
      or(
        inArray(
          users.id,
          db
            .select({ id: userRoles.userId })
            .from(userRoles)
            .where(eq(userRoles.competitionId, competitionScope)),
        ),
        inArray(
          users.id,
          db
            .select({ id: teamRegistrations.captainUserId })
            .from(teamRegistrations)
            .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
            .where(
              and(
                isNotNull(teamRegistrations.captainUserId),
                eq(seasons.competitionId, competitionScope),
              ),
            ),
        ),
        inArray(
          users.id,
          db
            .select({ id: matchOfficials.userId })
            .from(matchOfficials)
            .innerJoin(matches, eq(matchOfficials.matchId, matches.id))
            .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
            .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
            .where(eq(seasons.competitionId, competitionScope)),
        ),
      )!,
    );
  }
  if (query.status === 'active') conditions.push(eq(users.isActive, true));
  if (query.status === 'inactive') {
    conditions.push(and(eq(users.isActive, false), isNull(users.suspendedAt))!);
  }
  if (query.status === 'suspended') {
    conditions.push(and(eq(users.isActive, false), sql`${users.suspendedAt} is not null`)!);
  }
  if (query.role) {
    conditions.push(
      sql`${users.id} in (
        select ur.user_id from user_roles ur
        join roles r on r.id = ur.role_id
        where r.name = ${query.role}
      )`,
    );
  }
  if (query.q) {
    const pattern = `%${query.q}%`;
    conditions.push(or(ilike(users.email, pattern), ilike(users.displayName, pattern))!);
  }

  const rows = await db
    .select(userColumns)
    .from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return {
    items: rows,
    pagination: { limit: query.limit, offset: query.offset, returned: rows.length },
  };
}

export async function getUser(auth: AuthContext, userId: string) {
  if (!(await canViewUser(auth, userId))) throw notFound('User not found.');
  const [row] = await db.select(userColumns).from(users).where(eq(users.id, userId));
  if (!row) throw notFound('User not found.');
  return row;
}

export async function getUserRoles(auth: AuthContext, userId: string) {
  await getUser(auth, userId);
  const scopes = readScopes(auth);
  const rows = await db
    .select({
      role: roles.name,
      competitionId: userRoles.competitionId,
      competitionName: competitions.name,
      assignedAt: userRoles.createdAt,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .leftJoin(competitions, eq(userRoles.competitionId, competitions.id))
    .where(eq(userRoles.userId, userId))
    .orderBy(desc(userRoles.createdAt));
  if (!scopes) return rows;
  return rows.filter(
    (row) => row.competitionId === null ? false : scopes.includes(row.competitionId),
  );
}

export async function getUserAssociations(auth: AuthContext, userId: string) {
  await getUser(auth, userId);
  const scopes = readScopes(auth);
  const captainEntries = await db
    .select({
      teamRegistrationId: teamRegistrations.id,
      teamId: teams.id,
      teamName: teams.name,
      seasonId: seasons.id,
      seasonLabel: seasons.label,
      competitionId: competitions.id,
      competitionName: competitions.name,
      status: teamRegistrations.status,
    })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(teamRegistrations.captainUserId, userId))
    .limit(100);
  const officialAssignments = await db
    .select({
      matchId: matchOfficials.matchId,
      role: matchOfficials.role,
      assignedAt: matchOfficials.assignedAt,
      seasonId: seasons.id,
      competitionId: competitions.id,
      competitionName: competitions.name,
    })
    .from(matchOfficials)
    .innerJoin(matches, eq(matchOfficials.matchId, matches.id))
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(matchOfficials.userId, userId))
    .orderBy(desc(matchOfficials.assignedAt))
    .limit(100);

  const visible = (competitionId: string) =>
    scopes === null || scopes.includes(competitionId);
  return {
    captaincies: captainEntries.filter((row) => visible(row.competitionId)),
    officialAssignments: officialAssignments.filter((row) => visible(row.competitionId)),
  };
}

export async function getUserHistory(auth: AuthContext, userId: string) {
  if (!(await canViewUser(auth, userId))) throw notFound('User not found.');
  const scopes = readScopes(auth);
  const conditions: SQL[] = [
    eq(auditLogs.entityType, 'user'),
    eq(auditLogs.entityId, userId),
  ];
  if (scopes) conditions.push(inArray(auditLogs.competitionId, scopes));
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt));
  return rows.map((row) => ({
    ...row,
    before: sanitizeAuditValue(row.before),
    after: sanitizeAuditValue(row.after),
  }));
}

async function loadTargetUser(tx: Transaction | typeof db, userId: string) {
  const [row] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
  if (!row) throw notFound('User not found.');
  return row;
}

async function assertNotLastSuperAdmin(
  executor: Transaction | typeof db,
  targetUserId: string,
): Promise<void> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(roles.name, ROLES.superAdmin), isNull(userRoles.competitionId)));
  const [target] = await executor
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      and(
        eq(userRoles.userId, targetUserId),
        eq(roles.name, ROLES.superAdmin),
        isNull(userRoles.competitionId),
      ),
    );
  if (target && (row?.count ?? 0) <= 1) {
    throw conflict('The last global super administrator cannot be deactivated or demoted.');
  }
}

export async function deactivateUser(auth: AuthContext, userId: string) {
  assertUserManager(auth);
  if (auth.userId === userId) throw forbidden('You cannot deactivate your own account.');
  const changed = await db.transaction(async (tx) => {
    const current = await loadTargetUser(tx, userId);
    if (!current.isActive) return null;
    await assertNotLastSuperAdmin(tx, userId);
    const now = new Date();
    const [updated] = await tx
      .update(users)
      .set({ isActive: false, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw notFound('User not found.');
    await revokeAllSessions(tx, userId, 'account_deactivated', now);
    await auditUser(
      tx,
      auth.userId,
      'user.deactivated',
      userId,
      null,
      { isActive: true },
      { isActive: false },
      null,
    );
    return updated;
  });
  if (!changed) throw conflict('The account is already inactive.');
  closeUser(userId);
  return userColumnsFrom(changed);
}

function userColumnsFrom(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isActive: user.isActive,
    suspendedAt: user.suspendedAt,
    suspendedReason: user.suspendedReason,
    suspendedBy: user.suspendedBy,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function activateUser(auth: AuthContext, userId: string) {
  assertUserManager(auth);
  return db.transaction(async (tx) => {
    const current = await loadTargetUser(tx, userId);
    if (current.isActive) throw conflict('The account is already active.');
    if (current.suspendedAt) {
      throw conflict('This account is suspended. Use restore instead of activate.');
    }
    const now = new Date();
    const [updated] = await tx
      .update(users)
      .set({ isActive: true, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw notFound('User not found.');
    await auditUser(
      tx,
      auth.userId,
      'user.activated',
      userId,
      null,
      { isActive: false },
      { isActive: true },
      null,
    );
    return userColumnsFrom(updated);
  });
}

export async function suspendUser(auth: AuthContext, userId: string, input: SuspendInput) {
  assertUserManager(auth);
  if (auth.userId === userId) throw forbidden('You cannot suspend your own account.');
  const result = await db.transaction(async (tx) => {
    const current = await loadTargetUser(tx, userId);
    if (current.suspendedAt) throw conflict('The account is already suspended.');
    await assertNotLastSuperAdmin(tx, userId);
    const now = new Date();
    const [updated] = await tx
      .update(users)
      .set({
        isActive: false,
        suspendedAt: now,
        suspendedReason: input.reason,
        suspendedBy: auth.userId,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw notFound('User not found.');
    await revokeAllSessions(tx, userId, 'account_suspended', now);
    await auditUser(
      tx,
      auth.userId,
      'user.suspended',
      userId,
      null,
      { isActive: current.isActive, suspendedAt: null },
      { isActive: false, suspendedAt: now, reason: input.reason },
      input.reason,
    );
    return updated;
  });
  closeUser(userId);
  return userColumnsFrom(result);
}

export async function restoreUser(auth: AuthContext, userId: string) {
  assertUserManager(auth);
  return db.transaction(async (tx) => {
    const current = await loadTargetUser(tx, userId);
    if (!current.suspendedAt) throw conflict('The account is not suspended.');
    const now = new Date();
    const [updated] = await tx
      .update(users)
      .set({
        isActive: true,
        suspendedAt: null,
        suspendedReason: null,
        suspendedBy: null,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw notFound('User not found.');
    await auditUser(
      tx,
      auth.userId,
      'user.restored',
      userId,
      null,
      { isActive: current.isActive, suspendedAt: current.suspendedAt },
      { isActive: true, suspendedAt: null },
      null,
    );
    return userColumnsFrom(updated);
  });
}

export async function revokeUserSessions(
  auth: AuthContext,
  userId: string,
  reason?: string,
) {
  assertUserManager(auth);
  const result = await db.transaction(async (tx) => {
    const target = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));
    if (target.length === 0) throw notFound('User not found.');
    const now = new Date();
    const revokedSessions = await tx
      .update(sessions)
      .set({ revokedAt: now, revokedReason: 'administrative_revocation' })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    await auditUser(
      tx,
      auth.userId,
      'user.sessions.revoked',
      userId,
      null,
      null,
      { sessionsRevoked: revokedSessions.length },
      reason ?? null,
    );
    return { userId, sessionsRevoked: revokedSessions.length };
  });
  closeUser(userId);
  return result;
}

async function roleByName(
  executor: Transaction | typeof db,
  name: RoleName,
): Promise<{ id: string }> {
  const [row] = await executor
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, name));
  if (!row) throw new Error('The security roles have not been seeded.');
  return row;
}

export async function grantUserRole(auth: AuthContext, userId: string, input: RoleGrant) {
  const competitionId = input.competitionId ?? null;
  await assertRoleAssignmentAllowed(auth, {
    targetUserId: userId,
    role: input.role,
    competitionId,
  });

  return db.transaction(async (tx) => {
    const target = await loadTargetUser(tx, userId);
    if (!target.isActive) throw conflict('Roles cannot be granted to an inactive account.');
    const role = await roleByName(tx, input.role);
    const existing = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, role.id),
          competitionId === null
            ? isNull(userRoles.competitionId)
            : eq(userRoles.competitionId, competitionId),
        ),
      );
    if (existing.length > 0) throw conflict('This role assignment already exists.');

    await tx.insert(userRoles).values({
      userId,
      roleId: role.id,
      competitionId,
    });
    await auditUser(
      tx,
      auth.userId,
      'user.role.granted',
      userId,
      competitionId,
      null,
      { role: input.role, competitionId },
      null,
    );
    if (userId !== auth.userId) {
      await createNotification(tx, userId, {
        type: 'user.role.granted',
        title: 'Role assigned',
        body:
          competitionId === null
            ? `You were granted the ${input.role} role.`
            : `You were granted the ${input.role} role in a competition.`,
        entityType: 'user',
        entityId: userId,
        competitionId,
      });
    }
    return { userId, role: input.role, competitionId };
  });
}

export async function revokeUserRole(
  auth: AuthContext,
  userId: string,
  roleName: RoleName,
  competitionIdInput?: string,
) {
  const competitionId = competitionIdInput ?? null;
  await assertRoleAssignmentAllowed(auth, {
    targetUserId: userId,
    role: roleName,
    competitionId,
  });

  return db.transaction(async (tx) => {
    await loadTargetUser(tx, userId);
    const role = await roleByName(tx, roleName);
    if (roleName === ROLES.superAdmin && competitionId === null) {
      await assertNotLastSuperAdmin(tx, userId);
    }
    const removed = await tx
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, role.id),
          competitionId === null
            ? isNull(userRoles.competitionId)
            : eq(userRoles.competitionId, competitionId),
        ),
      )
      .returning({ userId: userRoles.userId });
    if (removed.length === 0) throw notFound('This role assignment does not exist.');
    await auditUser(
      tx,
      auth.userId,
      'user.role.revoked',
      userId,
      competitionId,
      { role: roleName, competitionId },
      null,
      null,
    );
    if (userId !== auth.userId) {
      await createNotification(tx, userId, {
        type: 'user.role.revoked',
        title: 'Role revoked',
        body:
          competitionId === null
            ? `Your ${roleName} role was revoked.`
            : `Your ${roleName} role in a competition was revoked.`,
        entityType: 'user',
        entityId: userId,
        competitionId,
      });
    }
    return { userId, role: roleName, competitionId, revoked: true };
  });
}
