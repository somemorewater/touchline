import { eq, notInArray } from 'drizzle-orm';
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
