import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  commentaryEntries,
  matchOverviews,
  users,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { hasPermissionInCompetition } from '../../security/context.js';
import { canReadMatch, isMatchOfficial, type MatchScope } from '../../security/access.js';
import { PERMISSIONS } from '../../security/permissions.js';
import { canManageMatch, loadMatchContext, requireMatchRead } from '../matches/engine.js';
import { broadcastMatchUpdate } from '../matches/live.js';
import type { z } from 'zod';
import type {
  commentaryCreateSchema,
  commentaryUpdateSchema,
  matchOverviewUpdateSchema,
} from './schemas.js';

type CommentaryCreate = z.infer<typeof commentaryCreateSchema>;
type CommentaryUpdate = z.infer<typeof commentaryUpdateSchema>;
type OverviewUpdate = z.infer<typeof matchOverviewUpdateSchema>;

type MatchContext = Awaited<ReturnType<typeof loadMatchContext>>;

async function requireCommentaryContext(auth: AuthContext, matchId: string) {
  const context = await loadMatchContext(matchId);
  if (!context) throw notFound('Match not found.');
  const assigned = await isMatchOfficial(auth.userId, matchId);
  const manager = canManageMatch(auth, context.scope);
  if (!assigned && !manager) {
    if (!(await canReadMatch(auth, context.scope))) throw notFound('Match not found.');
    throw forbidden('Match commentary requires an assigned operator or administrative scope.');
  }
  if (
    !manager &&
    !hasPermissionInCompetition(auth, PERMISSIONS.commentaryManage, context.scope.competitionId)
  ) {
    throw forbidden('Match commentary requires the commentary.manage permission.');
  }
  return context;
}

function assertTeam(scope: MatchScope, teamId: string | null | undefined) {
  if (!teamId) return;
  if (
    teamId !== scope.homeTeamRegistrationId &&
    teamId !== scope.awayTeamRegistrationId
  ) {
    throw badRequest('The team is not a participant in this match.');
  }
}

function audit(
  auth: AuthContext,
  context: NonNullable<MatchContext>,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  return db.insert(auditLogs).values({
    actorUserId: auth.userId,
    competitionId: context.scope.competitionId,
    seasonId: context.scope.seasonId,
    action,
    entityType: 'match',
    entityId,
    before,
    after,
    reason: null,
  });
}

export async function listCommentary(auth: AuthContext | null, matchId: string) {
  await requireMatchRead(auth, matchId);
  return db
    .select({
      id: commentaryEntries.id,
      matchId: commentaryEntries.matchId,
      teamRegistrationId: commentaryEntries.teamRegistrationId,
      kind: commentaryEntries.kind,
      eventType: commentaryEntries.eventType,
      body: commentaryEntries.body,
      minute: commentaryEntries.minute,
      addedMinutes: commentaryEntries.addedMinutes,
      status: commentaryEntries.status,
      isImportant: commentaryEntries.isImportant,
      author: users.displayName,
      editedAt: commentaryEntries.editedAt,
      retractedAt: commentaryEntries.retractedAt,
      createdAt: commentaryEntries.createdAt,
      updatedAt: commentaryEntries.updatedAt,
    })
    .from(commentaryEntries)
    .leftJoin(users, eq(commentaryEntries.authorUserId, users.id))
    .where(
      and(
        eq(commentaryEntries.matchId, matchId),
        auth ? undefined : ne(commentaryEntries.status, 'draft'),
      ),
    )
    .orderBy(asc(commentaryEntries.minute), asc(commentaryEntries.createdAt));
}

export async function createCommentary(auth: AuthContext, matchId: string, input: CommentaryCreate) {
  const context = await requireCommentaryContext(auth, matchId);
  assertTeam(context.scope, input.teamRegistrationId);

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(commentaryEntries)
      .values({
        matchId: context.scope.matchId,
        teamRegistrationId: input.teamRegistrationId ?? null,
        kind: input.kind,
        eventType: input.eventType ?? null,
        body: input.body,
        minute: input.minute ?? context.match.currentMinute ?? 0,
        addedMinutes: input.addedMinutes ?? null,
        status: input.status,
        isImportant: input.isImportant ?? false,
        authorUserId: auth.userId,
      })
      .returning();
    if (!entry) throw new Error('Commentary insert did not return a row.');
    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      competitionId: context.scope.competitionId,
      seasonId: context.scope.seasonId,
      action: 'commentary.created',
      entityType: 'match',
      entityId: context.scope.matchId,
      before: null,
      after: entry,
      reason: null,
    });
    return entry;
  }).then((entry) => {
    broadcastMatchUpdate(context.scope.matchId, context.match, 'commentary.updated');
    return entry;
  });
}

async function loadEntry(matchId: string, entryId: string) {
  const [entry] = await db
    .select()
    .from(commentaryEntries)
    .where(and(eq(commentaryEntries.id, entryId), eq(commentaryEntries.matchId, matchId)));
  if (!entry) throw notFound('Commentary entry not found.');
  return entry;
}

export async function updateCommentary(
  auth: AuthContext,
  matchId: string,
  entryId: string,
  input: CommentaryUpdate,
) {
  const context = await requireCommentaryContext(auth, matchId);
  const before = await loadEntry(context.scope.matchId, entryId);
  if (before.status === 'retracted') throw conflict('A retracted entry cannot be edited.');
  assertTeam(context.scope, input.teamRegistrationId);

  const [entry] = await db
    .update(commentaryEntries)
    .set({
      ...input,
      editedAt: new Date(),
      editedBy: auth.userId,
      updatedAt: new Date(),
    })
    .where(eq(commentaryEntries.id, entryId))
    .returning();
  if (!entry) throw notFound('Commentary entry not found.');
  await audit(auth, context, 'commentary.updated', context.scope.matchId, before, entry);
  broadcastMatchUpdate(context.scope.matchId, context.match, 'commentary.updated');
  return entry;
}

export async function retractCommentary(auth: AuthContext, matchId: string, entryId: string) {
  const context = await requireCommentaryContext(auth, matchId);
  const before = await loadEntry(context.scope.matchId, entryId);
  if (before.status === 'retracted') throw conflict('The entry is already retracted.');

  const [entry] = await db
    .update(commentaryEntries)
    .set({
      status: 'retracted',
      retractedAt: new Date(),
      retractedBy: auth.userId,
      updatedAt: new Date(),
    })
    .where(eq(commentaryEntries.id, entryId))
    .returning();
  if (!entry) throw notFound('Commentary entry not found.');
  await audit(auth, context, 'commentary.retracted', context.scope.matchId, before, entry);
  broadcastMatchUpdate(context.scope.matchId, context.match, 'commentary.updated');
  return entry;
}

export async function getMatchOverview(auth: AuthContext | null, matchId: string) {
  await requireMatchRead(auth, matchId);
  const [overview] = await db
    .select()
    .from(matchOverviews)
    .where(eq(matchOverviews.matchId, matchId));
  return overview ?? null;
}

export async function upsertMatchOverview(
  auth: AuthContext,
  matchId: string,
  input: OverviewUpdate,
) {
  const context = await requireCommentaryContext(auth, matchId);
  const [before] = await db
    .select()
    .from(matchOverviews)
    .where(eq(matchOverviews.matchId, context.scope.matchId));

  const [overview] = await db
    .insert(matchOverviews)
    .values({
      matchId: context.scope.matchId,
      introduction: input.introduction,
      preMatchNotes: input.preMatchNotes,
      liveSummary: input.liveSummary,
      narrative: input.narrative,
      updatedBy: auth.userId,
    })
    .onConflictDoUpdate({
      target: matchOverviews.matchId,
      set: {
        introduction: input.introduction,
        preMatchNotes: input.preMatchNotes,
        liveSummary: input.liveSummary,
        narrative: input.narrative,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!overview) throw new Error('Overview upsert did not return a row.');
  await audit(auth, context, 'match.overview.updated', context.scope.matchId, before ?? null, overview);
  broadcastMatchUpdate(context.scope.matchId, context.match, 'overview.updated');
  return overview;
}
