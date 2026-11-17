import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  fixtures,
  matchEvents,
  matches,
  seasons,
  competitions,
  teamRegistrations,
} from '../../database/schema/index.js';
import { forbidden, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../security/context.js';
import { hasPermissionInCompetition } from '../../security/context.js';
import {
  canReadMatch,
  canReportMatch,
  getCompetitionVisibility,
  loadMatchScope,
  type MatchScope,
} from '../../security/access.js';
import { PERMISSIONS } from '../../security/permissions.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Executor = Transaction | typeof db;

export interface MatchContext {
  scope: MatchScope;
  match: typeof matches.$inferSelect;
  fixture: typeof fixtures.$inferSelect;
}

export const SCORE_EVENT_TYPES = ['goal', 'own-goal', 'penalty-scored'] as const;

export const IN_PLAY_STATUSES = [
  'first_half',
  'live',
  'half_time',
  'second_half',
  'extra_time',
  'penalties',
] as const;

export function isInPlay(status: string): boolean {
  return (IN_PLAY_STATUSES as readonly string[]).includes(status);
}

/** Manager authority over the match's competition (`matches.manage`). */
export function canManageMatch(
  auth: AuthContext | null,
  scope: MatchScope,
): boolean {
  if (!auth) return false;
  return hasPermissionInCompetition(auth, PERMISSIONS.matchesManage, scope.competitionId);
}

/** Official-assignment authority over the match's competition. */
export function canManageOfficials(
  auth: AuthContext | null,
  scope: MatchScope,
): boolean {
  if (!auth) return false;
  return (
    hasPermissionInCompetition(auth, PERMISSIONS.officialsAssign, scope.competitionId) ||
    hasPermissionInCompetition(auth, PERMISSIONS.matchesManage, scope.competitionId)
  );
}

export async function loadMatchContext(matchId: string): Promise<MatchContext | null> {
  const scope = await loadMatchScope(matchId);
  if (!scope) return null;
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return null;
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, scope.fixtureId));
  if (!fixture) return null;
  return { scope, match, fixture };
}

async function requireContext(
  auth: AuthContext | null,
  matchId: string,
  check: (auth: AuthContext | null, scope: MatchScope) => Promise<boolean>,
  manageOnly: boolean,
): Promise<MatchContext> {
  const context = await loadMatchContext(matchId);
  if (!context) throw notFound('Match not found.');
  if (manageOnly) {
    if (!canManageMatch(auth, context.scope)) {
      const readable = await canReadMatch(auth, context.scope);
      if (!readable) throw notFound('Match not found.');
      throw forbidden('Match management requires administrative scope.');
    }
    return context;
  }
  if (!(await check(auth, context.scope))) {
    const readable = await canReadMatch(auth, context.scope);
    if (!readable) throw notFound('Match not found.');
    throw forbidden('Match operations require an assigned official or administrative scope.');
  }
  return context;
}

export function requireMatchRead(auth: AuthContext | null, matchId: string) {
  return requireContext(auth, matchId, canReadMatch, false);
}

export function requireMatchWrite(auth: AuthContext | null, matchId: string) {
  return requireContext(auth, matchId, canReportMatch, false);
}

export function requireMatchManage(auth: AuthContext | null, matchId: string) {
  return requireContext(auth, matchId, canReportMatch, true);
}

/**
 * Lock order is fixture then match everywhere so fixture-level and
 * match-level operations cannot deadlock against each other.
 */
export async function lockMatch(
  tx: Transaction,
  fixtureId: string,
  matchId: string,
): Promise<{ match: typeof matches.$inferSelect; fixture: typeof fixtures.$inferSelect }> {
  const [fixture] = await tx
    .select()
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .for('update');
  if (!fixture) throw notFound('Fixture not found.');
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for('update');
  if (!match) throw notFound('Match not found.');
  return { match, fixture };
}

export interface Score {
  homeScore: number;
  awayScore: number;
}

/**
 * The only authoritative score calculation. Voided events never count.
 * `own-goal` records the conceding team in `teamRegistrationId`, so the
 * opposing participant is credited.
 */
export async function calculateScore(
  executor: Executor,
  matchId: string,
  homeRegistrationId: string,
  awayRegistrationId: string,
): Promise<Score> {
  const rows = await executor
    .select({ eventType: matchEvents.eventType, teamRegistrationId: matchEvents.teamRegistrationId })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.matchId, matchId),
        isNull(matchEvents.voidedAt),
        inArray(matchEvents.eventType, [...SCORE_EVENT_TYPES]),
      ),
    );

  let homeScore = 0;
  let awayScore = 0;
  for (const row of rows) {
    const team = row.teamRegistrationId;
    if (!team || (team !== homeRegistrationId && team !== awayRegistrationId)) continue;
    const credited =
      row.eventType === 'own-goal'
        ? team === homeRegistrationId
          ? awayRegistrationId
          : homeRegistrationId
        : team;
    if (credited === homeRegistrationId) homeScore += 1;
    else awayScore += 1;
  }
  return { homeScore, awayScore };
}

export async function applyScore(
  tx: Transaction,
  matchId: string,
  score: Score,
): Promise<void> {
  await tx
    .update(matches)
    .set({ homeScore: score.homeScore, awayScore: score.awayScore, updatedAt: new Date() })
    .where(eq(matches.id, matchId));
}

export async function recalculateScore(
  tx: Transaction,
  context: { scope: MatchScope; matchId: string },
): Promise<Score> {
  const score = await calculateScore(
    tx,
    context.matchId,
    context.scope.homeTeamRegistrationId,
    context.scope.awayTeamRegistrationId,
  );
  await applyScore(tx, context.matchId, score);
  return score;
}

export async function loadCompetitionForFixtureSeason(seasonId: string) {
  const [row] = await db
    .select({ season: seasons, competition: competitions })
    .from(seasons)
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(seasons.id, seasonId));
  return row ?? null;
}

export async function participantTeamNames(scope: MatchScope) {
  const rows = await db
    .select({ id: teamRegistrations.id, teamId: teamRegistrations.teamId })
    .from(teamRegistrations)
    .where(
      inArray(teamRegistrations.id, [
        scope.homeTeamRegistrationId,
        scope.awayTeamRegistrationId,
      ]),
    );
  return rows;
}

export async function competitionVisibilityForMatch(scope: MatchScope) {
  return getCompetitionVisibility(scope.competitionId);
}
