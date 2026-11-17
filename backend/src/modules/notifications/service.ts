import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  matchOfficials,
  matches,
  fixtures,
  notificationDeliveries,
  notifications,
  roles,
  teamRegistrations,
  userRoles,
} from '../../database/schema/index.js';
import { notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { ROLES } from '../../security/permissions.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Transaction | typeof db;

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  competitionId?: string | null;
  dedupeKey?: string | null;
}

/**
 * Persist an in-app notification and its delivery record in the caller's
 * transaction. Delivery is deliberately separate from creation: the in-app
 * channel is recorded as delivered because the row is now readable, while
 * external channels are not configured and are never claimed as delivered.
 */
export async function createNotification(
  tx: Transaction,
  userId: string,
  input: NotificationInput,
): Promise<string | null> {
  const now = new Date();
  const [row] = await tx
    .insert(notifications)
    .values({
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      competitionId: input.competitionId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (!row) return null;

  await tx.insert(notificationDeliveries).values({
    notificationId: row.id,
    channel: 'in_app',
    status: 'delivered',
    attempts: 1,
    deliveredAt: now,
  });
  return row.id;
}

export async function createNotifications(
  tx: Transaction,
  userIds: readonly string[],
  input: NotificationInput,
): Promise<number> {
  const unique = [...new Set(userIds.filter(Boolean))];
  let created = 0;
  for (const userId of unique) {
    if (await createNotification(tx, userId, input)) created += 1;
  }
  return created;
}

/** Resolve administrators by server-side role grants, never client input. */
export async function competitionAdministratorIds(
  executor: Executor,
  competitionId: string | null,
): Promise<string[]> {
  const conditions = [
    inArray(roles.name, [ROLES.competitionAdmin, ROLES.superAdmin]),
  ];
  const rows = await executor
    .select({ userId: userRoles.userId, competitionId: userRoles.competitionId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(...conditions));
  return [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.competitionId === null ||
            (competitionId !== null && row.competitionId === competitionId),
        )
        .map((row) => row.userId),
    ),
  ];
}

export async function teamCaptainId(
  executor: Executor,
  teamRegistrationId: string,
): Promise<string | null> {
  const [row] = await executor
    .select({ captainUserId: teamRegistrations.captainUserId })
    .from(teamRegistrations)
    .where(eq(teamRegistrations.id, teamRegistrationId));
  return row?.captainUserId ?? null;
}

export async function matchOfficialIds(
  executor: Executor,
  matchId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ userId: matchOfficials.userId })
    .from(matchOfficials)
    .where(eq(matchOfficials.matchId, matchId));
  return rows.map((row) => row.userId);
}

export async function matchTeamCaptainIds(
  executor: Executor,
  matchId: string,
): Promise<string[]> {
  const [row] = await executor
    .select({
      home: fixtures.homeTeamRegistrationId,
      away: fixtures.awayTeamRegistrationId,
    })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .where(eq(matches.id, matchId));
  if (!row) return [];
  const captains = await Promise.all([
    teamCaptainId(executor, row.home),
    teamCaptainId(executor, row.away),
  ]);
  return captains.filter((value): value is string => Boolean(value));
}

export async function notifyMatchParticipants(
  tx: Transaction,
  matchId: string,
  input: NotificationInput,
): Promise<void> {
  const [officials, captains] = await Promise.all([
    matchOfficialIds(tx, matchId),
    matchTeamCaptainIds(tx, matchId),
  ]);
  await createNotifications(tx, [...officials, ...captains], input);
}

export async function notifyTeamCaptain(
  tx: Transaction,
  teamRegistrationId: string,
  input: NotificationInput,
): Promise<void> {
  const captainId = await teamCaptainId(tx, teamRegistrationId);
  if (captainId) await createNotification(tx, captainId, input);
}

export async function notifyCaseParticipants(
  tx: Transaction,
  input: NotificationInput,
  userIds: Array<string | null | undefined>,
): Promise<void> {
  await createNotifications(
    tx,
    userIds.filter((value): value is string => Boolean(value)),
    input,
  );
}

export interface NotificationListQuery {
  unreadOnly?: boolean | undefined;
  type?: string | undefined;
  limit: number;
  offset: number;
}

export async function listNotifications(auth: AuthContext, query: NotificationListQuery) {
  const conditions = [eq(notifications.userId, auth.userId)];
  if (query.unreadOnly) conditions.push(isNull(notifications.readAt));
  if (query.type) conditions.push(eq(notifications.type, query.type));

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      competitionId: notifications.competitionId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return {
    items: rows,
    pagination: { limit: query.limit, offset: query.offset, returned: rows.length },
  };
}

export async function unreadNotificationCount(auth: AuthContext): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, auth.userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

export async function markNotificationRead(auth: AuthContext, notificationId: string) {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, auth.userId)))
    .returning({ id: notifications.id, readAt: notifications.readAt });
  if (!row) throw notFound('Notification not found.');
  return row;
}

export async function markAllNotificationsRead(auth: AuthContext) {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, auth.userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return { updated: rows.length };
}
