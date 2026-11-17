import { and, eq } from 'drizzle-orm';
import { auditLogs, standingsSnapshots } from '../../database/schema/index.js';

type Transaction = Parameters<Parameters<typeof import('../../database/client.js').db.transaction>[0]>[0];

/**
 * Result confirmation is the publication trigger for standings. Any correction
 * or reopening must stop the previous snapshot from being presented as current;
 * the historical row itself is never rewritten or deleted.
 */
export async function invalidateStandingsSnapshots(
  tx: Transaction,
  actorUserId: string,
  seasonId: string,
  matchId: string,
  reason: string,
): Promise<void> {
  const invalidated = await tx
    .update(standingsSnapshots)
    .set({ isCurrent: false })
    .where(
      and(
        eq(standingsSnapshots.seasonId, seasonId),
        eq(standingsSnapshots.isCurrent, true),
      ),
    )
    .returning({
      id: standingsSnapshots.id,
      groupId: standingsSnapshots.groupId,
      version: standingsSnapshots.version,
    });
  if (invalidated.length === 0) return;

  await tx.insert(auditLogs).values({
    actorUserId,
    action: 'standings.snapshot.invalidated',
    entityType: 'season',
    entityId: seasonId,
    before: { snapshots: invalidated, matchId },
    after: null,
    reason,
  });
}
