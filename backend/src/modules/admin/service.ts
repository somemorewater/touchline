import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  competitions,
  roles,
  userRoles,
  users,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { isSuperAdmin } from '../../security/context.js';
import { ROLES } from '../../security/permissions.js';
import { hashPassword } from '../../security/passwords.js';
import type {
  adminAccountCreateSchema,
  adminListQuerySchema,
} from './schemas.js';
import type { z } from 'zod';

type AdminCreate = z.infer<typeof adminAccountCreateSchema>;
type AdminListQuery = z.infer<typeof adminListQuerySchema>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertSuperAdmin(auth: AuthContext): void {
  if (!isSuperAdmin(auth)) {
    throw forbidden('Only a global super administrator can manage administrator accounts.');
  }
}

async function roleId(tx: Transaction | typeof db, name: string): Promise<string> {
  const [role] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, name));
  if (!role) throw new Error('The security roles have not been seeded.');
  return role.id;
}

export async function createAdminAccount(auth: AuthContext, input: AdminCreate) {
  assertSuperAdmin(auth);
  const email = input.email.toLowerCase();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) throw conflict('An account with this email already exists.');

  const competitionIds = input.competitionIds ?? [];
  if (competitionIds.length > 0) {
    const found = await db
      .select({ id: competitions.id })
      .from(competitions)
      .where(inArray(competitions.id, competitionIds));
    if (found.length !== competitionIds.length) {
      throw badRequest('competitionIds contains an unknown competition.');
    }
  }

  const passwordHash = await hashPassword(input.password);
  const roleName =
    input.role === 'super_admin' ? ROLES.superAdmin : ROLES.competitionAdmin;

  return db.transaction(async (tx) => {
    const role = await roleId(tx, roleName);
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash, displayName: input.displayName })
      .returning({ id: users.id, email: users.email, displayName: users.displayName });
    if (!user) throw new Error('Administrator insert did not return a row.');

    if (input.role === 'super_admin') {
      await tx.insert(userRoles).values({ userId: user.id, roleId: role });
    } else {
      await tx.insert(userRoles).values(
        competitionIds.map((competitionId) => ({
          userId: user.id,
          roleId: role,
          competitionId,
        })),
      );
    }

    return {
      user,
      role: input.role,
      competitionIds: input.role === 'super_admin' ? [] : competitionIds,
    };
  });
}

export async function listAdminAccounts(
  auth: AuthContext,
  filters: AdminListQuery,
) {
  assertSuperAdmin(auth);
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      isActive: users.isActive,
      role: roles.name,
      competitionId: userRoles.competitionId,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(
      inArray(roles.name, [ROLES.competitionAdmin, ROLES.superAdmin]),
    );

  const filtered = filters.competitionId
    ? rows.filter(
        (row) =>
          row.role === ROLES.superAdmin ||
          row.competitionId === filters.competitionId,
      )
    : rows;

  const grouped = new Map<
    string,
    {
      id: string;
      email: string;
      displayName: string;
      isActive: boolean;
      roles: string[];
      competitionIds: string[];
    }
  >();
  for (const row of filtered) {
    const entry = grouped.get(row.userId) ?? {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
      isActive: row.isActive,
      roles: [],
      competitionIds: [],
    };
    if (!entry.roles.includes(row.role)) entry.roles.push(row.role);
    if (row.competitionId && !entry.competitionIds.includes(row.competitionId)) {
      entry.competitionIds.push(row.competitionId);
    }
    grouped.set(row.userId, entry);
  }
  return [...grouped.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export async function assignCompetitionAdmin(
  auth: AuthContext,
  userId: string,
  competitionId: string,
) {
  assertSuperAdmin(auth);
  const [competition] = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.id, competitionId));
  if (!competition) throw badRequest('competitionId does not identify a competition.');

  const [user] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true)));
  if (!user) throw badRequest('userId does not identify an active account.');

  const [globalAdmin] = await db
    .select({ role: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      and(
        eq(userRoles.userId, userId),
        isNull(userRoles.competitionId),
        inArray(roles.name, [ROLES.competitionAdmin, ROLES.superAdmin]),
      ),
    )
    .limit(1);
  if (globalAdmin) {
    throw conflict('This account already has a global administrator role.');
  }

  const adminRoleId = await roleId(db, ROLES.competitionAdmin);
  const [existing] = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.roleId, adminRoleId),
        eq(userRoles.competitionId, competitionId),
      ),
    );
  if (existing) throw conflict('This account is already assigned to the competition.');

  await db.insert(userRoles).values({
    userId,
    roleId: adminRoleId,
    competitionId,
  });
  return { ...user, competitionId };
}

export async function revokeCompetitionAdmin(
  auth: AuthContext,
  userId: string,
  competitionId: string,
) {
  assertSuperAdmin(auth);
  const adminRoleId = await roleId(db, ROLES.competitionAdmin);
  const removed = await db
    .delete(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.roleId, adminRoleId),
        eq(userRoles.competitionId, competitionId),
      ),
    )
    .returning({ userId: userRoles.userId });
  if (removed.length === 0) {
    throw notFound('This competition administrator assignment does not exist.');
  }
  return { userId, competitionId, revoked: true };
}
