import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  competitionGroups,
  competitions,
  seasons,
  teamRegistrations,
} from '../../database/schema/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { hasPermission } from '../../security/context.js';
import {
  canManageCompetition,
  canViewCompetition,
} from '../../security/access.js';
import { PERMISSIONS } from '../../security/permissions.js';
import type {
  competitionCreateSchema,
  competitionUpdateSchema,
  groupCreateSchema,
  groupUpdateSchema,
  seasonCreateSchema,
  seasonUpdateSchema,
} from './schemas.js';
import type { z } from 'zod';

type CompetitionCreate = z.infer<typeof competitionCreateSchema>;
type CompetitionUpdate = z.infer<typeof competitionUpdateSchema>;
type SeasonCreate = z.infer<typeof seasonCreateSchema>;
type SeasonUpdate = z.infer<typeof seasonUpdateSchema>;
type GroupCreate = z.infer<typeof groupCreateSchema>;
type GroupUpdate = z.infer<typeof groupUpdateSchema>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SEASON_TRANSITIONS: Record<string, readonly string[]> = {
  planned: ['active', 'completed', 'archived'],
  active: ['completed', 'archived'],
  completed: ['archived'],
  archived: [],
};

async function loadCompetitionForWrite(
  auth: AuthContext,
  competitionId: string,
  permission: string,
) {
  const [row] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
  if (!row) throw notFound('Competition not found.');
  if (!canManageCompetition(auth, permission, competitionId)) {
    if (!canViewCompetition(auth, row)) throw notFound('Competition not found.');
    throw forbidden();
  }
  return row;
}

function assertCompetitionWritable(status: string): void {
  if (status === 'archived') {
    throw conflict('Archived competitions are read-only.');
  }
}

async function loadSeasonForWrite(auth: AuthContext, seasonId: string) {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw notFound('Season not found.');
  const competition = await loadCompetitionForWrite(
    auth,
    season.competitionId,
    PERMISSIONS.competitionsUpdate,
  );
  return { season, competition };
}

async function loadGroupForWrite(auth: AuthContext, groupId: string) {
  const [row] = await db
    .select({
      group: competitionGroups,
      season: seasons,
      competition: competitions,
    })
    .from(competitionGroups)
    .innerJoin(seasons, eq(competitionGroups.seasonId, seasons.id))
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(competitionGroups.id, groupId));
  if (!row) throw notFound('Group not found.');
  if (!canManageCompetition(auth, PERMISSIONS.competitionsUpdate, row.competition.id)) {
    if (!canViewCompetition(auth, row.competition)) throw notFound('Group not found.');
    throw forbidden();
  }
  return row;
}

function assertSeasonWritable(status: string): void {
  if (status === 'archived') throw conflict('Archived seasons are read-only.');
}

function assertSeasonAcceptsEntries(status: string): void {
  if (status !== 'planned' && status !== 'active') {
    throw conflict('Team entries and registrations require a planned or active season.');
  }
}

export async function createCompetition(auth: AuthContext, input: CompetitionCreate) {
  if (!hasPermission(auth, PERMISSIONS.competitionsCreate)) throw forbidden();
  const [row] = await db
    .insert(competitions)
    .values({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      ...(input.format ? { format: input.format } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {}),
      status: 'draft',
    })
    .returning();
  if (!row) throw new Error('Competition insert did not return a row.');
  return row;
}

export async function updateCompetition(
  auth: AuthContext,
  competitionId: string,
  input: CompetitionUpdate,
) {
  const existing = await loadCompetitionForWrite(
    auth,
    competitionId,
    PERMISSIONS.competitionsUpdate,
  );
  assertCompetitionWritable(existing.status);
  const [row] = await db
    .update(competitions)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(competitions.id, competitionId))
    .returning();
  if (!row) throw notFound('Competition not found.');
  return row;
}

async function transitionCompetition(
  auth: AuthContext,
  competitionId: string,
  permission: string,
  from: readonly string[],
  to: string,
) {
  const existing = await loadCompetitionForWrite(auth, competitionId, permission);
  assertCompetitionWritable(existing.status);
  if (!from.includes(existing.status)) {
    throw conflict(`Cannot move a competition from "${existing.status}" to "${to}".`);
  }
  const [row] = await db
    .update(competitions)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(competitions.id, competitionId))
    .returning();
  if (!row) throw notFound('Competition not found.');
  return row;
}

export function publishCompetition(auth: AuthContext, competitionId: string) {
  return transitionCompetition(
    auth,
    competitionId,
    PERMISSIONS.competitionsPublish,
    ['draft'],
    'published',
  );
}

export function unpublishCompetition(auth: AuthContext, competitionId: string) {
  return transitionCompetition(
    auth,
    competitionId,
    PERMISSIONS.competitionsPublish,
    ['published'],
    'draft',
  );
}

export async function archiveCompetition(auth: AuthContext, competitionId: string) {
  const existing = await loadCompetitionForWrite(
    auth,
    competitionId,
    PERMISSIONS.competitionsUpdate,
  );
  if (existing.status === 'archived') throw conflict('Competition is already archived.');
  const [row] = await db
    .update(competitions)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(competitions.id, competitionId))
    .returning();
  if (!row) throw notFound('Competition not found.');
  return row;
}

export async function createSeason(
  auth: AuthContext,
  competitionId: string,
  input: SeasonCreate,
) {
  const competition = await loadCompetitionForWrite(
    auth,
    competitionId,
    PERMISSIONS.competitionsUpdate,
  );
  assertCompetitionWritable(competition.status);
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
    throw badRequest('endsOn must not precede startsOn.');
  }
  const [row] = await db
    .insert(seasons)
    .values({
      competitionId,
      label: input.label,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      status: 'planned',
    })
    .returning();
  if (!row) throw new Error('Season insert did not return a row.');
  return row;
}

export async function updateSeason(
  auth: AuthContext,
  seasonId: string,
  input: SeasonUpdate,
) {
  const { season, competition } = await loadSeasonForWrite(auth, seasonId);
  assertCompetitionWritable(competition.status);
  assertSeasonWritable(season.status);

  const startsOn = input.startsOn === undefined ? season.startsOn : input.startsOn;
  const endsOn = input.endsOn === undefined ? season.endsOn : input.endsOn;
  if (startsOn && endsOn && endsOn < startsOn) {
    throw badRequest('endsOn must not precede startsOn.');
  }

  const [row] = await db
    .update(seasons)
    .set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.startsOn !== undefined ? { startsOn: input.startsOn } : {}),
      ...(input.endsOn !== undefined ? { endsOn: input.endsOn } : {}),
      updatedAt: new Date(),
    })
    .where(eq(seasons.id, seasonId))
    .returning();
  if (!row) throw notFound('Season not found.');
  return row;
}

async function transitionSeason(
  auth: AuthContext,
  seasonId: string,
  to: 'active' | 'completed' | 'archived',
) {
  const { season, competition } = await loadSeasonForWrite(auth, seasonId);
  assertCompetitionWritable(competition.status);
  const allowed = SEASON_TRANSITIONS[season.status] ?? [];
  if (!allowed.includes(to)) {
    throw conflict(`Cannot move a season from "${season.status}" to "${to}".`);
  }
  const [row] = await db
    .update(seasons)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(seasons.id, seasonId))
    .returning();
  if (!row) throw notFound('Season not found.');
  return row;
}

export function activateSeason(auth: AuthContext, seasonId: string) {
  return transitionSeason(auth, seasonId, 'active');
}

export function closeSeason(auth: AuthContext, seasonId: string) {
  return transitionSeason(auth, seasonId, 'completed');
}

export function archiveSeason(auth: AuthContext, seasonId: string) {
  return transitionSeason(auth, seasonId, 'archived');
}

export async function createGroup(
  auth: AuthContext,
  seasonId: string,
  input: GroupCreate,
) {
  const { season, competition } = await loadSeasonForWrite(auth, seasonId);
  assertCompetitionWritable(competition.status);
  assertSeasonAcceptsEntries(season.status);
  const [row] = await db
    .insert(competitionGroups)
    .values({
      seasonId,
      name: input.name,
      ...(input.kind ? { kind: input.kind } : {}),
    })
    .returning();
  if (!row) throw new Error('Group insert did not return a row.');
  return row;
}

export async function updateGroup(auth: AuthContext, groupId: string, input: GroupUpdate) {
  const { group, season, competition } = await loadGroupForWrite(auth, groupId);
  assertCompetitionWritable(competition.status);
  assertSeasonWritable(season.status);
  if (group.archivedAt) throw conflict('Archived groups are read-only.');
  const [row] = await db
    .update(competitionGroups)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
    })
    .where(eq(competitionGroups.id, groupId))
    .returning();
  if (!row) throw notFound('Group not found.');
  return row;
}

export async function archiveGroup(auth: AuthContext, groupId: string) {
  const { group, season, competition } = await loadGroupForWrite(auth, groupId);
  assertCompetitionWritable(competition.status);
  assertSeasonWritable(season.status);
  if (group.archivedAt) throw conflict('Group is already archived.');

  const [assigned] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamRegistrations)
    .where(eq(teamRegistrations.groupId, groupId));
  if ((assigned?.count ?? 0) > 0) {
    throw conflict('Move or remove the team entries assigned to this group before archiving it.');
  }

  const [row] = await db
    .update(competitionGroups)
    .set({ archivedAt: new Date() })
    .where(eq(competitionGroups.id, groupId))
    .returning();
  if (!row) throw notFound('Group not found.');
  return row;
}

export async function seasonIsAcceptingRegistrations(
  tx: Transaction | typeof db,
  seasonId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ status: seasons.status, competitionStatus: competitions.status })
    .from(seasons)
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(seasons.id, seasonId));
  return Boolean(
    row &&
      (row.status === 'planned' || row.status === 'active') &&
      row.competitionStatus !== 'archived',
  );
}

export async function groupBelongsToSeason(groupId: string, seasonId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: competitionGroups.id })
    .from(competitionGroups)
    .where(and(eq(competitionGroups.id, groupId), eq(competitionGroups.seasonId, seasonId)));
  return Boolean(row);
}
