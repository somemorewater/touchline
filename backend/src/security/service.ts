import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../database/client.js';
import {
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from '../database/schema/index.js';
import type { AuthContext, RoleAssignment } from './context.js';

/**
 * Load the trusted authentication context for a session.
 *
 * A token is only valid while its session row exists, belongs to the same
 * user, has not been revoked, has not expired, and the account is active.
 * Role and permission data always comes from the database, never the token
 * or the client.
 */
export async function loadAuthContext(userId: string, sessionId: string): Promise<AuthContext | null> {
  const [session] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    );

  if (!session) return null;

  const rows = await db
    .select({
      role: roles.name,
      competitionId: userRoles.competitionId,
      permission: permissions.key,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  const assignments: RoleAssignment[] = [];
  const globalRoles = new Set<string>();
  const scopedRoles = new Map<string, Set<string>>();
  const globalPermissions = new Set<string>();
  const scopedPermissions = new Map<string, Set<string>>();

  for (const row of rows) {
    const existing = assignments.find(
      (assignment) => assignment.role === row.role && assignment.competitionId === row.competitionId,
    );
    if (!existing) {
      assignments.push({ role: row.role, competitionId: row.competitionId });
    }

    if (row.competitionId === null) {
      globalRoles.add(row.role);
      if (row.permission) globalPermissions.add(row.permission);
      continue;
    }

    const competitionId = row.competitionId;
    let roleSet = scopedRoles.get(competitionId);
    if (!roleSet) {
      roleSet = new Set<string>();
      scopedRoles.set(competitionId, roleSet);
    }
    roleSet.add(row.role);

    if (row.permission) {
      let permissionSet = scopedPermissions.get(competitionId);
      if (!permissionSet) {
        permissionSet = new Set<string>();
        scopedPermissions.set(competitionId, permissionSet);
      }
      permissionSet.add(row.permission);
    }
  }

  return {
    userId: session.userId,
    sessionId: session.sessionId,
    email: session.email,
    displayName: session.displayName,
    assignments,
    globalRoles,
    scopedRoles,
    permissions: globalPermissions,
    scopedPermissions,
  };
}

/** Lightweight revalidation used by WebSocket messages and sensitive operations. */
export async function isSessionActive(userId: string, sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    );
  return Boolean(row);
}
