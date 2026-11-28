import { eq } from 'drizzle-orm';
import { db } from '../../database/client.js';
import { auditLogs, roles, userRoles, users } from '../../database/schema/index.js';
import { conflict, forbidden } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { hasPermissionInCompetition } from '../../security/context.js';
import { getCompetitionVisibility, isCompetitionAdministrator } from '../../security/access.js';
import { PERMISSIONS } from '../../security/permissions.js';
import { hashPassword } from '../../security/passwords.js';
import type { z } from 'zod';
import { competitionAccountRoles, type competitionAccountCreateSchema } from './schemas.js';

type CompetitionAccountCreate = z.infer<typeof competitionAccountCreateSchema>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Creates an account with only a competition-scoped operational role. It does
 * not grant global roles or any permission outside the supplied competition.
 */
export async function createCompetitionAccount(
  auth: AuthContext,
  input: CompetitionAccountCreate,
) {
  if (
    !isCompetitionAdministrator(auth, input.competitionId) ||
    !hasPermissionInCompetition(auth, PERMISSIONS.rolesManage, input.competitionId)
  ) {
    throw forbidden('You cannot provision accounts outside a competition you administer.');
  }
  if (!competitionAccountRoles.includes(input.role)) {
    throw forbidden('This role cannot be provisioned by a competition administrator.');
  }
  const competition = await getCompetitionVisibility(input.competitionId);
  if (!competition) throw forbidden('Competition not found.');

  const email = input.email.toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) throw conflict('An account with this email already exists.');

  return db.transaction(async (tx: Transaction) => {
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash: await hashPassword(input.password), displayName: input.displayName })
      .returning();
    if (!user) throw new Error('User insert did not return a row.');

    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, input.role));
    if (!role) throw new Error('The security roles have not been seeded.');

    await tx.insert(userRoles).values({
      userId: user.id,
      roleId: role.id,
      competitionId: input.competitionId,
    });
    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      competitionId: input.competitionId,
      action: 'competition_account.created',
      entityType: 'user',
      entityId: user.id,
      before: null,
      after: { email, role: input.role, competitionId: input.competitionId },
      reason: null,
    });

    return {
      id: user.id,
      email,
      displayName: input.displayName,
      role: input.role,
      competitionId: input.competitionId,
    };
  });
}
