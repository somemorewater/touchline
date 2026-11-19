import { eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../client.js';
import { permissions, rolePermissions, roles } from '../schema/index.js';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_DESCRIPTIONS,
  ROLE_GRANTS,
  type RoleName,
} from '../../security/permissions.js';

/**
 * Idempotent canonical security seed. Role grants in code are the source of
 * truth; running the seed repeatedly converges the database to that state.
 */
export async function seedSecurity(): Promise<void> {
  await db.transaction(async (tx) => {
    const permissionIds = new Map<string, string>();

    for (const key of ALL_PERMISSIONS) {
      const description = PERMISSION_DESCRIPTIONS[key];
      const [row] = await tx
        .insert(permissions)
        .values({ key, description })
        .onConflictDoUpdate({ target: permissions.key, set: { description } })
        .returning({ id: permissions.id });
      if (row) permissionIds.set(key, row.id);
    }

    const roleIds = new Map<RoleName, string>();
    for (const role of Object.keys(ROLE_GRANTS) as RoleName[]) {
      const description = ROLE_DESCRIPTIONS[role];
      const [row] = await tx
        .insert(roles)
        .values({ name: role, description })
        .onConflictDoUpdate({ target: roles.name, set: { description } })
        .returning({ id: roles.id });
      if (row) roleIds.set(role, row.id);
    }

    for (const [role, grants] of Object.entries(ROLE_GRANTS) as [RoleName, string[]][]) {
      const roleId = roleIds.get(role);
      if (!roleId) continue;
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      for (const key of grants) {
        const permissionId = permissionIds.get(key);
        if (!permissionId) continue;
        await tx
          .insert(rolePermissions)
          .values({ roleId, permissionId })
          .onConflictDoNothing();
      }
    }

    await tx.delete(permissions).where(notInArray(permissions.key, ALL_PERMISSIONS));
  });
}

export interface SecuritySeedCounts {
  rolesInserted: number;
  permissionsInserted: number;
  grantsInserted: number;
}

/**
 * Deployment-safe security seed. Unlike seedSecurity it never updates or
 * deletes rows: it only inserts canonical permissions, roles and grants that
 * are absent, so existing role assignments and operator edits are preserved.
 */
export async function seedMissingSecurity(
  database: Pick<typeof db, 'transaction'> = db,
): Promise<SecuritySeedCounts> {
  return database.transaction(async (tx) => {
    const roleNames = Object.keys(ROLE_GRANTS) as RoleName[];

    const insertedPermissions = await tx
      .insert(permissions)
      .values(ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSION_DESCRIPTIONS[key] })))
      .onConflictDoNothing({ target: permissions.key })
      .returning({ id: permissions.id });

    const insertedRoles = await tx
      .insert(roles)
      .values(roleNames.map((name) => ({ name, description: ROLE_DESCRIPTIONS[name] })))
      .onConflictDoNothing({ target: roles.name })
      .returning({ id: roles.id });

    const permissionRows = await tx
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, ALL_PERMISSIONS));
    const permissionIds = new Map(permissionRows.map((row) => [row.key, row.id]));

    const roleRows = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(inArray(roles.name, roleNames));
    const roleIds = new Map(roleRows.map((row) => [row.name, row.id]));

    const missingRole = roleNames.find((name) => !roleIds.has(name));
    if (missingRole) {
      throw new Error(`Required security role "${missingRole}" is missing after seeding.`);
    }

    const grants = roleNames.flatMap((name) => {
      const roleId = roleIds.get(name);
      if (!roleId) return [];
      return ROLE_GRANTS[name].map((key) => {
        const permissionId = permissionIds.get(key);
        if (!permissionId) {
          throw new Error(`Required permission "${key}" is missing after seeding.`);
        }
        return { roleId, permissionId };
      });
    });

    const insertedGrants = grants.length
      ? await tx
          .insert(rolePermissions)
          .values(grants)
          .onConflictDoNothing()
          .returning({ roleId: rolePermissions.roleId })
      : [];

    return {
      rolesInserted: insertedRoles.length,
      permissionsInserted: insertedPermissions.length,
      grantsInserted: insertedGrants.length,
    };
  });
}
