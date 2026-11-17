import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  competitions,
  seasons,
  standingsSnapshots,
} from '../../database/schema/index.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { hasPermissionInCompetition, type AuthContext } from '../../security/context.js';
import { PERMISSIONS } from '../../security/permissions.js';
import { canManageCompetitionLineups } from '../../security/access.js';
import { resolveStatisticsScopes } from '../statistics/eligibility.js';
import { calculateStandings, type StandingsCalculation } from './calculator.js';
import type {
  StandingsHistoryQuery,
  StandingsQuery,
  StandingsRecalculate,
  StandingsSnapshotCreate,
} from './schemas.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function snapshotShape(snapshot: typeof standingsSnapshots.$inferSelect) {
  return {
    id: snapshot.id,
    seasonId: snapshot.seasonId,
    groupId: snapshot.groupId,
    version: snapshot.version,
    isCurrent: snapshot.isCurrent,
    calculatedAt: snapshot.calculatedAt,
    meta: snapshot.meta,
    rows: snapshot.rows,
  };
}

async function loadSeasonCompetition(executor: Transaction | typeof db, seasonId: string) {
  const [row] = await executor
    .select({
      season: seasons,
      competitionId: seasons.competitionId,
      competitionStatus: competitions.status,
      competitionVisibility: competitions.visibility,
    })
    .from(seasons)
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(seasons.id, seasonId));
  return row ?? null;
}

async function assertReadable(
  auth: AuthContext | null,
  seasonId: string,
): Promise<void> {
  const scopes = await resolveStatisticsScopes(auth, { seasonId });
  if (scopes.length === 0) throw notFound('Season not found.');
}

async function assertManage(auth: AuthContext, seasonId: string): Promise<string> {
  const row = await loadSeasonCompetition(db, seasonId);
  if (!row) throw notFound('Season not found.');
  if (!hasPermissionInCompetition(auth, PERMISSIONS.standingsManage, row.competitionId)) {
    if (await canManageCompetitionLineups(auth, row.competitionId)) {
      throw forbidden('Publishing standings requires the standings.manage permission.');
    }
    throw notFound('Season not found.');
  }
  return row.competitionId;
}

function groupCondition(seasonId: string, groupId: string | null) {
  return and(
    eq(standingsSnapshots.seasonId, seasonId),
    groupId
      ? eq(standingsSnapshots.groupId, groupId)
      : isNull(standingsSnapshots.groupId),
  );
}

async function currentSnapshot(
  executor: Transaction | typeof db,
  seasonId: string,
  groupId: string | null,
) {
  const [row] = await executor
    .select()
    .from(standingsSnapshots)
    .where(
      and(
        groupCondition(seasonId, groupId),
        eq(standingsSnapshots.isCurrent, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getStandings(auth: AuthContext | null, query: StandingsQuery) {
  await assertReadable(auth, query.seasonId);
  const groupId = query.groupId ?? null;
  const calculation = await calculateStandings(db, query.seasonId, groupId);
  const snapshot = await currentSnapshot(db, query.seasonId, groupId);
  const fingerprint = (snapshot?.meta as { fingerprint?: unknown } | undefined)?.fingerprint;
  return {
    rows: calculation.rows,
    meta: calculation.meta,
    snapshot: snapshot
      ? {
          ...snapshotShape(snapshot),
          stale: fingerprint !== calculation.meta.fingerprint,
        }
      : null,
  };
}

export async function previewStandings(
  auth: AuthContext,
  query: StandingsQuery,
): Promise<StandingsCalculation> {
  await assertManage(auth, query.seasonId);
  return calculateStandings(db, query.seasonId, query.groupId ?? null);
}

async function publishSnapshot(
  auth: AuthContext,
  input: StandingsSnapshotCreate,
  mode: 'published' | 'recalculated',
) {
  const competitionId = await assertManage(auth, input.seasonId);
  const groupId = input.groupId ?? null;

  return db.transaction(async (tx) => {
    const [season] = await tx
      .select({ id: seasons.id, competitionId: seasons.competitionId })
      .from(seasons)
      .where(eq(seasons.id, input.seasonId))
      .for('update');
    if (!season) throw notFound('Season not found.');
    if (season.competitionId !== competitionId) {
      throw badRequest('The season scope changed during snapshot creation.');
    }

    const calculation = await calculateStandings(tx, input.seasonId, groupId);
    const previous = await currentSnapshot(tx, input.seasonId, groupId);
    const [latest] = await tx
      .select({ version: standingsSnapshots.version })
      .from(standingsSnapshots)
      .where(groupCondition(input.seasonId, groupId))
      .orderBy(desc(standingsSnapshots.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;

    await tx
      .update(standingsSnapshots)
      .set({ isCurrent: false })
      .where(
        and(
          groupCondition(input.seasonId, groupId),
          eq(standingsSnapshots.isCurrent, true),
        ),
      );

    const [created] = await tx
      .insert(standingsSnapshots)
      .values({
        seasonId: input.seasonId,
        groupId,
        version,
        isCurrent: true,
        calculatedAt: new Date(),
        meta: {
          ...calculation.meta,
          snapshotType: mode,
          generatedAt: new Date().toISOString(),
        },
        rows: calculation.rows as unknown as Record<string, unknown>[],
      })
      .returning();
    if (!created) throw new Error('Standings snapshot insert did not return a row.');

    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      action:
        mode === 'published'
          ? 'standings.snapshot.published'
          : 'standings.snapshot.recalculated',
      entityType: 'season',
      entityId: input.seasonId,
      before: previous
        ? { snapshot: snapshotShape(previous) }
        : null,
      after: {
        snapshot: snapshotShape(created),
        replacedSnapshotId: previous?.id ?? null,
      },
      reason: input.reason ?? null,
    });

    return snapshotShape(created);
  });
}

export async function createStandingsSnapshot(
  auth: AuthContext,
  input: StandingsSnapshotCreate,
) {
  return publishSnapshot(auth, input, 'published');
}

export async function recalculateStandings(
  auth: AuthContext,
  input: StandingsRecalculate,
) {
  return publishSnapshot(auth, input, 'recalculated');
}

export async function listStandingsSnapshots(
  auth: AuthContext | null,
  query: StandingsHistoryQuery,
) {
  await assertReadable(auth, query.seasonId);
  const groupId = query.groupId ?? null;
  const rows = await db
    .select()
    .from(standingsSnapshots)
    .where(groupCondition(query.seasonId, groupId))
    .orderBy(desc(standingsSnapshots.version))
    .limit(query.limit)
    .offset(query.offset);
  return {
    items: rows.map(snapshotShape),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getStandingsSnapshot(
  auth: AuthContext | null,
  snapshotId: string,
) {
  const [snapshot] = await db
    .select()
    .from(standingsSnapshots)
    .where(eq(standingsSnapshots.id, snapshotId));
  if (!snapshot) throw notFound('Standings snapshot not found.');
  await assertReadable(auth, snapshot.seasonId);
  return snapshotShape(snapshot);
}
