import { ROLES, type RoleName } from './permissions.js';

export interface RoleAssignment {
  role: string;
  competitionId: string | null;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  displayName: string;
  assignments: RoleAssignment[];
  globalRoles: ReadonlySet<string>;
  scopedRoles: ReadonlyMap<string, ReadonlySet<string>>;
  /** Permissions granted by global (unscoped) role assignments. */
  permissions: ReadonlySet<string>;
  /** Permissions granted by competition-scoped role assignments. */
  scopedPermissions: ReadonlyMap<string, ReadonlySet<string>>;
}

export function isSuperAdmin(auth: AuthContext): boolean {
  return auth.globalRoles.has(ROLES.superAdmin);
}

export function isSuperAdminIn(auth: AuthContext, competitionId: string): boolean {
  return isSuperAdmin(auth) || (auth.scopedRoles.get(competitionId)?.has(ROLES.superAdmin) ?? false);
}

export function hasPermission(auth: AuthContext, permission: string): boolean {
  return isSuperAdmin(auth) || auth.permissions.has(permission);
}

export function hasPermissionInCompetition(
  auth: AuthContext,
  permission: string,
  competitionId: string,
): boolean {
  if (hasPermission(auth, permission)) return true;
  if (auth.scopedRoles.get(competitionId)?.has(ROLES.superAdmin)) return true;
  return auth.scopedPermissions.get(competitionId)?.has(permission) ?? false;
}

export function hasRole(auth: AuthContext, role: RoleName, competitionId?: string): boolean {
  return auth.assignments.some(
    (assignment) =>
      assignment.role === role &&
      (competitionId === undefined ? assignment.competitionId === null : assignment.competitionId === competitionId),
  );
}

/** Competition IDs where the user holds the permission through a scoped assignment. */
export function competitionScopesFor(auth: AuthContext, permission: string): string[] {
  const scopes: string[] = [];
  for (const [competitionId, permissions] of auth.scopedPermissions) {
    if (permissions.has(permission) || auth.scopedRoles.get(competitionId)?.has(ROLES.superAdmin)) {
      scopes.push(competitionId);
    }
  }
  return scopes;
}
