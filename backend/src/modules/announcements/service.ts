import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  announcements,
  auditLogs,
  competitions,
  fixtures,
  matchOfficials,
  matches,
  seasons,
  teamRegistrations,
  users,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import {
  competitionScopesFor,
  hasPermission,
  isSuperAdmin,
  type AuthContext,
} from '../../security/context.js';
import { canManageCompetition, publicCompetitionIds } from '../../security/access.js';
import { PERMISSIONS } from '../../security/permissions.js';
import {
  competitionAdministratorIds,
  createNotifications,
  type NotificationInput,
} from '../notifications/service.js';
import type {
  announcementCreateSchema,
  announcementListQuerySchema,
  announcementManageQuerySchema,
  announcementUpdateSchema,
} from './schemas.js';
import type { z } from 'zod';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CreateInput = z.infer<typeof announcementCreateSchema>;
type UpdateInput = z.infer<typeof announcementUpdateSchema>;
type ListQuery = z.infer<typeof announcementListQuerySchema>;
type ManageQuery = z.infer<typeof announcementManageQuerySchema>;

const columns = {
  id: announcements.id,
  competitionId: announcements.competitionId,
  seasonId: announcements.seasonId,
  title: announcements.title,
  body: announcements.body,
  audience: announcements.audience,
  publishedAt: announcements.publishedAt,
  archivedAt: announcements.archivedAt,
  createdBy: announcements.createdBy,
  createdAt: announcements.createdAt,
  updatedAt: announcements.updatedAt,
};

async function auditAnnouncement(
  tx: Transaction,
  actorUserId: string,
  action: string,
  row: { id: string; competitionId: string | null; seasonId: string | null },
  before: unknown,
  after: unknown,
  reason?: string | null,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId,
    competitionId: row.competitionId,
    seasonId: row.seasonId,
    action,
    entityType: 'announcement',
    entityId: row.id,
    before: before ?? null,
    after: after ?? null,
    reason: reason ?? null,
  });
}

function assertAnnouncementScope(auth: AuthContext, competitionId: string | null): void {
  if (competitionId === null) {
    if (!isSuperAdmin(auth)) {
      throw forbidden('Only a super administrator can manage global announcements.');
    }
    return;
  }
  if (!canManageCompetition(auth, PERMISSIONS.announcementsManage, competitionId)) {
    throw forbidden('Announcement management requires administrative scope.');
  }
}

async function validateScope(input: {
  competitionId: string | null;
  seasonId: string | null;
}): Promise<void> {
  if (input.competitionId) {
    const [competition] = await db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, input.competitionId));
    if (!competition) throw badRequest('competitionId does not identify a competition.');
  }
  if (input.seasonId) {
    const [season] = await db
      .select({ competitionId: seasons.competitionId })
      .from(seasons)
      .where(eq(seasons.id, input.seasonId));
    if (!season) throw badRequest('seasonId does not identify a season.');
    if (!input.competitionId || season.competitionId !== input.competitionId) {
      throw badRequest('The season does not belong to the announcement competition.');
    }
  }
}

async function audienceRecipients(
  tx: Transaction,
  announcement: {
    id: string;
    competitionId: string | null;
    seasonId: string | null;
    audience: string;
  },
): Promise<string[]> {
  if (announcement.audience === 'public') return [];

  const admins = await competitionAdministratorIds(tx, announcement.competitionId);
  if (announcement.audience === 'administrators') return admins;

  if (announcement.competitionId === null) {
    if (announcement.audience === 'participants') {
      const rows = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.isActive, true))
        .limit(5000);
      return rows.map((row) => row.id);
    }
    return admins;
  }

  const captainRows = await tx
    .select({ userId: teamRegistrations.captainUserId })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(
      and(
        eq(seasons.competitionId, announcement.competitionId),
        isNotNull(teamRegistrations.captainUserId),
        announcement.seasonId
          ? eq(teamRegistrations.seasonId, announcement.seasonId)
          : sqlTrue(),
      ),
    );
  const captains = captainRows
    .map((row) => row.userId)
    .filter((value): value is string => Boolean(value));

  const officialRows = await tx
    .select({ userId: matchOfficials.userId })
    .from(matchOfficials)
    .innerJoin(matches, eq(matchOfficials.matchId, matches.id))
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .where(
      and(
        eq(seasons.competitionId, announcement.competitionId),
        announcement.seasonId ? eq(fixtures.seasonId, announcement.seasonId) : sqlTrue(),
      ),
    );
  const officials = officialRows.map((row) => row.userId);

  switch (announcement.audience) {
    case 'captains':
      return [...new Set(captains)];
    case 'officials':
      return [...new Set(officials)];
    case 'participants':
      return [...new Set([...captains, ...officials, ...admins])];
    default:
      return [];
  }
}

function sqlTrue(): SQL {
  return sql`true`;
}

async function notifyAudience(
  tx: Transaction,
  announcement: {
    id: string;
    competitionId: string | null;
    seasonId: string | null;
    audience: string;
    title: string;
  },
): Promise<void> {
  const recipients = await audienceRecipients(tx, announcement);
  const input: NotificationInput = {
    type: 'announcement.published',
    title: announcement.title,
    body: `A new competition announcement was published.`,
    entityType: 'announcement',
    entityId: announcement.id,
    competitionId: announcement.competitionId,
    dedupeKey: `announcement:${announcement.id}`,
  };
  await createNotifications(tx, recipients, input);
}

export async function listPublishedAnnouncements(
  auth: AuthContext | null,
  query: ListQuery,
) {
  const conditions: SQL[] = [
    isNotNull(announcements.publishedAt),
    isNull(announcements.archivedAt),
  ];
  if (query.competitionId) {
    conditions.push(
      or(
        eq(announcements.competitionId, query.competitionId),
        isNull(announcements.competitionId),
      )!,
    );
  }
  if (query.seasonId) conditions.push(eq(announcements.seasonId, query.seasonId));
  if (query.audience) conditions.push(eq(announcements.audience, query.audience));

  const publicAudience = and(
    eq(announcements.audience, 'public'),
    or(
      isNull(announcements.competitionId),
      inArray(announcements.competitionId, publicCompetitionIds()),
    )!,
  )!;

  if (!auth) {
    conditions.push(publicAudience);
  } else if (
    isSuperAdmin(auth) ||
    hasPermission(auth, PERMISSIONS.competitionsRead)
  ) {
    // Global readers may see every audience for every competition.
  } else {
    const readScopes = competitionScopesFor(auth, PERMISSIONS.competitionsRead);
    const captainScopes = await captainCompetitionIds(auth);
    const officialScopes = await officialCompetitionIds(auth);
    const adminScopes = competitionScopesFor(auth, PERMISSIONS.announcementsManage);

    const visibility: SQL[] = [publicAudience];
    if (readScopes.length > 0) {
      visibility.push(inArray(announcements.competitionId, readScopes));
    }
    const participantAudience = and(
      eq(announcements.audience, 'participants'),
      or(
        isNull(announcements.competitionId),
        inArray(announcements.competitionId, publicCompetitionIds()),
        captainScopes.length > 0
          ? inArray(announcements.competitionId, captainScopes)
          : sqlFalse(),
        officialScopes.length > 0
          ? inArray(announcements.competitionId, officialScopes)
          : sqlFalse(),
        adminScopes.length > 0 ? inArray(announcements.competitionId, adminScopes) : sqlFalse(),
      )!,
    )!;
    visibility.push(participantAudience);
    if (captainScopes.length > 0) {
      visibility.push(
        and(
          eq(announcements.audience, 'captains'),
          inArray(announcements.competitionId, captainScopes),
        )!,
      );
    }
    if (officialScopes.length > 0) {
      visibility.push(
        and(
          eq(announcements.audience, 'officials'),
          inArray(announcements.competitionId, officialScopes),
        )!,
      );
    }
    if (adminScopes.length > 0) {
      visibility.push(
        and(
          eq(announcements.audience, 'administrators'),
          inArray(announcements.competitionId, adminScopes),
        )!,
      );
    }
    conditions.push(or(...visibility)!);
  }

  const rows = await db
    .select(columns)
    .from(announcements)
    .where(and(...conditions))
    .orderBy(desc(announcements.publishedAt))
    .limit(query.limit)
    .offset(query.offset);
  return {
    items: rows,
    pagination: { limit: query.limit, offset: query.offset, returned: rows.length },
  };
}

function sqlFalse(): SQL {
  return sql`false`;
}

async function captainCompetitionIds(auth: AuthContext): Promise<string[]> {
  const rows = await db
    .select({ competitionId: seasons.competitionId })
    .from(teamRegistrations)
    .innerJoin(seasons, eq(teamRegistrations.seasonId, seasons.id))
    .where(eq(teamRegistrations.captainUserId, auth.userId));
  return [...new Set(rows.map((row) => row.competitionId))];
}

async function officialCompetitionIds(auth: AuthContext): Promise<string[]> {
  const rows = await db
    .select({ competitionId: seasons.competitionId })
    .from(matchOfficials)
    .innerJoin(matches, eq(matchOfficials.matchId, matches.id))
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .where(eq(matchOfficials.userId, auth.userId));
  return [...new Set(rows.map((row) => row.competitionId))];
}

export async function listManagedAnnouncements(auth: AuthContext, query: ManageQuery) {
  const conditions: SQL[] = [];
  if (!isSuperAdmin(auth)) {
    const scopes = competitionScopesFor(auth, PERMISSIONS.announcementsManage);
    if (scopes.length === 0) {
      throw forbidden('Announcement management requires an administrative scope.');
    }
    conditions.push(inArray(announcements.competitionId, scopes));
  }
  if (query.competitionId) conditions.push(eq(announcements.competitionId, query.competitionId));
  if (query.seasonId) conditions.push(eq(announcements.seasonId, query.seasonId));
  if (query.audience) conditions.push(eq(announcements.audience, query.audience));
  if (query.status === 'draft') {
    conditions.push(isNull(announcements.publishedAt), isNull(announcements.archivedAt));
  } else if (query.status === 'published') {
    conditions.push(isNotNull(announcements.publishedAt), isNull(announcements.archivedAt));
  } else if (query.status === 'archived') {
    conditions.push(isNotNull(announcements.archivedAt));
  }

  const rows = await db
    .select(columns)
    .from(announcements)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(announcements.createdAt))
    .limit(query.limit)
    .offset(query.offset);
  return {
    items: rows,
    pagination: { limit: query.limit, offset: query.offset, returned: rows.length },
  };
}

export async function createAnnouncement(auth: AuthContext, input: CreateInput) {
  const competitionId = input.competitionId ?? null;
  const seasonId = input.seasonId ?? null;
  assertAnnouncementScope(auth, competitionId);
  await validateScope({ competitionId, seasonId });

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(announcements)
      .values({
        competitionId,
        seasonId,
        title: input.title,
        body: input.body,
        audience: input.audience,
        createdBy: auth.userId,
      })
      .returning();
    if (!created) throw new Error('Announcement insert did not return a row.');
    await auditAnnouncement(
      tx,
      auth.userId,
      'announcement.created',
      created,
      null,
      created,
      null,
    );
    return created;
  });
}

async function loadAnnouncement(id: string) {
  const [row] = await db.select().from(announcements).where(eq(announcements.id, id));
  if (!row) throw notFound('Announcement not found.');
  return row;
}

export async function updateAnnouncement(auth: AuthContext, id: string, input: UpdateInput) {
  const current = await loadAnnouncement(id);
  assertAnnouncementScope(auth, current.competitionId);
  if (current.archivedAt) throw conflict('An archived announcement is read-only.');
  if (current.publishedAt) throw conflict('Only draft announcements can be edited. Unpublish it first.');

  const seasonId = input.seasonId === undefined ? current.seasonId : input.seasonId;
  const audience = input.audience ?? current.audience;
  if ((seasonId || audience !== 'public') && !current.competitionId) {
    // audience participants is allowed globally; other audiences are not.
    if (audience !== 'participants') {
      throw badRequest('This audience requires a competition.');
    }
  }
  await validateScope({ competitionId: current.competitionId, seasonId });

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(announcements)
      .set({
        title: input.title ?? current.title,
        body: input.body ?? current.body,
        audience,
        seasonId,
        updatedAt: new Date(),
      })
      .where(eq(announcements.id, id))
      .returning();
    if (!updated) throw notFound('Announcement not found.');
    await auditAnnouncement(
      tx,
      auth.userId,
      'announcement.updated',
      updated,
      current,
      updated,
      null,
    );
    return updated;
  });
}

export async function publishAnnouncement(auth: AuthContext, id: string) {
  const current = await loadAnnouncement(id);
  assertAnnouncementScope(auth, current.competitionId);
  if (current.archivedAt) throw conflict('An archived announcement cannot be published.');
  if (current.publishedAt) throw conflict('The announcement is already published.');

  return db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(announcements)
      .set({ publishedAt: now, updatedAt: now })
      .where(eq(announcements.id, id))
      .returning();
    if (!updated) throw notFound('Announcement not found.');
    await auditAnnouncement(
      tx,
      auth.userId,
      'announcement.published',
      updated,
      current,
      updated,
      null,
    );
    await notifyAudience(tx, updated);
    return updated;
  });
}

export async function unpublishAnnouncement(auth: AuthContext, id: string) {
  const current = await loadAnnouncement(id);
  assertAnnouncementScope(auth, current.competitionId);
  if (current.archivedAt) throw conflict('An archived announcement cannot be unpublished.');
  if (!current.publishedAt) throw conflict('The announcement is not published.');

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(announcements)
      .set({ publishedAt: null, updatedAt: new Date() })
      .where(eq(announcements.id, id))
      .returning();
    if (!updated) throw notFound('Announcement not found.');
    await auditAnnouncement(
      tx,
      auth.userId,
      'announcement.unpublished',
      updated,
      current,
      updated,
      null,
    );
    return updated;
  });
}

export async function archiveAnnouncement(auth: AuthContext, id: string) {
  const current = await loadAnnouncement(id);
  assertAnnouncementScope(auth, current.competitionId);
  if (current.archivedAt) throw conflict('The announcement is already archived.');

  return db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(announcements)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(announcements.id, id))
      .returning();
    if (!updated) throw notFound('Announcement not found.');
    await auditAnnouncement(
      tx,
      auth.userId,
      'announcement.archived',
      updated,
      current,
      updated,
      null,
    );
    return updated;
  });
}
