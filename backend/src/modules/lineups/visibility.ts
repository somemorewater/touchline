import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../database/client.js';
import { lineups, lineupPlayers, teamRegistrations } from '../../database/schema/index.js';
import {
  canReadPrivateMatch,
  isMatchOfficial,
  isPublicMatch,
  type MatchScope,
} from '../../security/access.js';
import { canReviewLineups } from '../../security/access.js';
import type { AuthContext } from '../../security/context.js';

export interface LineupVisibility {
  /** Administrative or assigned-official access to every lineup of the match. */
  all: boolean;
  /** Team entries the caller captains. */
  ownedTeamIds: string[];
  /** Match is public, so confirmed/published lineups are public. */
  publicMatch: boolean;
  /** May confirm, return or administratively correct lineups. */
  reviewer: boolean;
}

export async function resolveLineupVisibility(
  auth: AuthContext | null,
  scope: MatchScope,
): Promise<LineupVisibility> {
  const reviewer = canReviewLineups(auth, scope.competitionId);
  const all =
    canReadPrivateMatch(auth, scope) ||
    (auth ? await isMatchOfficial(auth.userId, scope.matchId) : false);

  let ownedTeamIds: string[] = [];
  if (auth) {
    const rows = await db
      .select({ id: teamRegistrations.id })
      .from(teamRegistrations)
      .where(
        and(
          eq(teamRegistrations.captainUserId, auth.userId),
          inArray(teamRegistrations.id, [
            scope.homeTeamRegistrationId,
            scope.awayTeamRegistrationId,
          ]),
        ),
      );
    ownedTeamIds = rows.map((row) => row.id);
  }

  return { all, ownedTeamIds, publicMatch: isPublicMatch(scope), reviewer };
}

export function canSeeLineup(
  visibility: LineupVisibility,
  lineup: { teamRegistrationId: string; status: string },
): boolean {
  if (visibility.all) return true;
  if (
    visibility.publicMatch &&
    (lineup.status === 'confirmed' || lineup.status === 'published')
  ) {
    return true;
  }
  return visibility.ownedTeamIds.includes(lineup.teamRegistrationId);
}

/** Public callers never receive review metadata or unconfirmed lineups. */
export function sanitizeLineup(
  lineup: typeof lineups.$inferSelect,
  players: (typeof lineupPlayers.$inferSelect)[],
  includeReview: boolean,
) {
  return {
    id: lineup.id,
    matchId: lineup.matchId,
    teamRegistrationId: lineup.teamRegistrationId,
    formation: lineup.formation,
    status: lineup.status,
    submittedAt: lineup.submittedAt,
    confirmedAt: lineup.confirmedAt,
    returnedAt: includeReview ? lineup.returnedAt : null,
    returnReason: includeReview ? lineup.returnReason : null,
    createdAt: lineup.createdAt,
    updatedAt: lineup.updatedAt,
    players: players.map((player) => ({
      playerRegistrationId: player.playerRegistrationId,
      role: player.role,
      shirtNumber: player.shirtNumber,
      position: player.position,
      x: player.x === null ? null : Number(player.x),
      y: player.y === null ? null : Number(player.y),
      isCaptain: player.isCaptain,
    })),
  };
}

export async function loadVisibleMatchLineups(
  auth: AuthContext | null,
  scope: MatchScope,
  visibility?: LineupVisibility,
) {
  const resolved = visibility ?? (await resolveLineupVisibility(auth, scope));
  const rows = await db
    .select()
    .from(lineups)
    .where(eq(lineups.matchId, scope.matchId))
    .orderBy(lineups.createdAt);
  const visible = rows.filter((lineup) => canSeeLineup(resolved, lineup));
  return Promise.all(
    visible.map(async (lineup) => {
      const players = await db
        .select()
        .from(lineupPlayers)
        .where(eq(lineupPlayers.lineupId, lineup.id))
        .orderBy(lineupPlayers.role, lineupPlayers.shirtNumber);
      return sanitizeLineup(lineup, players, resolved.all || resolved.reviewer);
    }),
  );
}
