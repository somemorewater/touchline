import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  lineups,
  lineupPlayers,
  playerRegistrations,
  players,
  teamRegistrations,
  teams,
} from '../../database/schema/index.js';
import { requireMatchRead } from './engine.js';

export interface MatchSquadPlayer {
  registrationId: string;
  playerId: string;
  fullName: string;
  shirtNumber: number | null;
  position: string | null;
  teamRegistrationId: string;
  teamName: string;
  eligible: boolean;
  lineupRole: 'starter' | 'substitute' | 'unavailable' | null;
  inLineup: boolean;
}

/** Approved registrations plus lineup roles for the two match participants. */
export async function listMatchSquad(auth: Parameters<typeof requireMatchRead>[0], matchId: string) {
  const context = await requireMatchRead(auth, matchId);
  const teamIds = [context.scope.homeTeamRegistrationId, context.scope.awayTeamRegistrationId];

  const rows = await db
    .select({
      registrationId: playerRegistrations.id,
      playerId: players.id,
      fullName: players.fullName,
      shirtNumber: playerRegistrations.shirtNumber,
      position: players.position,
      teamRegistrationId: playerRegistrations.teamRegistrationId,
      teamId: teamRegistrations.teamId,
      teamName: teams.name,
      eligible: playerRegistrations.eligibilityApproved,
    })
    .from(playerRegistrations)
    .innerJoin(players, eq(playerRegistrations.playerId, players.id))
    .innerJoin(teamRegistrations, eq(playerRegistrations.teamRegistrationId, teamRegistrations.id))
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .where(
      and(
        inArray(playerRegistrations.teamRegistrationId, teamIds),
        eq(playerRegistrations.status, 'approved'),
        isNull(players.archivedAt),
      ),
    )
    .orderBy(teams.name, playerRegistrations.shirtNumber, players.fullName);

  const lineupRows = await db
    .select({
      status: lineups.status,
      teamRegistrationId: lineups.teamRegistrationId,
      playerRegistrationId: lineupPlayers.playerRegistrationId,
      role: lineupPlayers.role,
    })
    .from(lineups)
    .innerJoin(lineupPlayers, eq(lineupPlayers.lineupId, lineups.id))
    .where(
      and(
        eq(lineups.matchId, matchId),
        inArray(lineups.status, ['submitted', 'confirmed', 'published', 'returned']),
      ),
    );

  const roles = new Map<string, MatchSquadPlayer['lineupRole']>();
  for (const row of lineupRows) {
    if (row.role === 'starter' || row.role === 'substitute' || row.role === 'unavailable') {
      roles.set(row.playerRegistrationId, row.role);
    }
  }

  return {
    homeRegistrationId: context.scope.homeTeamRegistrationId,
    awayRegistrationId: context.scope.awayTeamRegistrationId,
    hasLineup: lineupRows.length > 0,
    players: rows.map((row) => ({
      registrationId: row.registrationId,
      playerId: row.playerId,
      fullName: row.fullName,
      shirtNumber: row.shirtNumber,
      position: row.position,
      teamRegistrationId: row.teamRegistrationId,
      teamName: row.teamName,
      eligible: row.eligible,
      lineupRole: roles.get(row.registrationId) ?? null,
      inLineup: roles.has(row.registrationId),
    })),
  };
}
