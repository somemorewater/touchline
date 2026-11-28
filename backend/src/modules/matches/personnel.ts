import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  matchOfficials,
  roles,
  userRoles,
  users,
} from '../../database/schema/index.js';
import { badRequest, conflict } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { ROLES } from '../../security/permissions.js';

export type MatchPersonnelRole = 'official' | 'commentary';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const ROLE_NAMES: Record<MatchPersonnelRole, string> = {
  official: ROLES.matchOfficial,
  commentary: ROLES.commentaryOperator,
};

/** Reused by fixture creation and the assignment endpoints. */
export async function assertPersonnelEligible(
  executor: Executor,
  userId: string,
  competitionId: string,
  role: MatchPersonnelRole,
) {
  const [user] = await executor
    .select({ id: users.id, isActive: users.isActive, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw badRequest('The account does not exist.');
  if (!user.isActive) throw conflict('The account is inactive.');

  const [assignment] = await executor
    .select({ id: userRoles.id })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(roles.name, ROLE_NAMES[role]),
        or(isNull(userRoles.competitionId), eq(userRoles.competitionId, competitionId)),
      ),
    )
    .limit(1);
  if (!assignment) {
    throw badRequest(`The account does not hold an eligible ${ROLE_NAMES[role]} role for this competition.`);
  }
  return user;
}

export async function insertPersonnelAssignment(
  executor: Executor,
  input: {
    matchId: string;
    userId: string;
    role: MatchPersonnelRole;
    competitionId: string;
    seasonId: string;
    actor: AuthContext;
  },
) {
  const user = await assertPersonnelEligible(
    executor,
    input.userId,
    input.competitionId,
    input.role,
  );
  const [existing] = await executor
    .select({ userId: matchOfficials.userId })
    .from(matchOfficials)
    .where(
      and(
        eq(matchOfficials.matchId, input.matchId),
        eq(matchOfficials.userId, input.userId),
      ),
    );
  if (existing) throw conflict('The user is already assigned to this match.');

  const [assignment] = await executor
    .insert(matchOfficials)
    .values({
      matchId: input.matchId,
      userId: input.userId,
      role: input.role,
      assignedBy: input.actor.userId,
    })
    .returning();
  if (!assignment) throw conflict('The assignment could not be created.');

  await executor.insert(auditLogs).values({
    actorUserId: input.actor.userId,
    competitionId: input.competitionId,
    seasonId: input.seasonId,
    action: 'match.official.assigned',
    entityType: 'match',
    entityId: input.matchId,
    before: null,
    after: { ...assignment, displayName: user.displayName },
    reason: null,
  });
  return { ...assignment, displayName: user.displayName };
}
