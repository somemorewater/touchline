import { createHash } from 'node:crypto';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  competitionGroups,
  competitionRules,
  competitions,
  fixtures,
  matches,
  seasons,
  teamRegistrations,
  teams,
} from '../../database/schema/index.js';
import { badRequest, notFound } from '../../shared/errors.js';

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export interface StandingsRow {
  position: number;
  teamId: string;
  teamRegistrationId: string;
  teamName: string;
  groupId: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface StandingsMeta {
  competitionId: string;
  seasonId: string;
  groupId: string | null;
  scope: 'season' | 'group';
  points: { win: number; draw: number; loss: number };
  tieBreakers: string[];
  ignoredTieBreakers: string[];
  matchIds: string[];
  matchCount: number;
  fingerprint: string;
}

export interface StandingsCalculation {
  rows: StandingsRow[];
  meta: StandingsMeta;
}

interface StandingsMatch {
  id: string;
  homeTeamRegistrationId: string;
  awayTeamRegistrationId: string;
  homeScore: number;
  awayScore: number;
  resultConfirmedAt: Date;
}

const RECOGNISED_TIE_BREAKERS = new Set([
  'wins',
  'head_to_head',
]);

const BASELINE_TIE_BREAKERS = ['goal_difference', 'goals_for'] as const;

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function fingerprintMatches(standingsMatches: StandingsMatch[]): string {
  const serialised = [...standingsMatches]
    .sort((left, right) => compareText(left.id, right.id))
    .map(
      (match) =>
        `${match.id}|${match.homeTeamRegistrationId}|${match.awayTeamRegistrationId}|${match.homeScore}|${match.awayScore}|${match.resultConfirmedAt.toISOString()}`,
    )
    .join('\n');
  return createHash('sha256').update(serialised).digest('hex');
}

function splitByTies(
  rows: StandingsRow[],
  keys: ((row: StandingsRow) => number)[],
): StandingsRow[][] {
  const groups: StandingsRow[][] = [];
  for (const row of rows) {
    const current = groups[groups.length - 1];
    if (
      current &&
      keys.every((key) => key(current[0]!) === key(row))
    ) {
      current.push(row);
    } else {
      groups.push([row]);
    }
  }
  return groups;
}

function headToHeadScores(
  teamIds: Set<string>,
  standingsMatches: StandingsMatch[],
  points: { win: number; draw: number; loss: number },
): Map<string, { points: number; goalDifference: number; goalsFor: number }> {
  const table = new Map<string, { points: number; goalDifference: number; goalsFor: number }>();
  for (const teamId of teamIds) {
    table.set(teamId, { points: 0, goalDifference: 0, goalsFor: 0 });
  }
  for (const match of standingsMatches) {
    if (
      !teamIds.has(match.homeTeamRegistrationId) ||
      !teamIds.has(match.awayTeamRegistrationId)
    ) {
      continue;
    }
    const home = table.get(match.homeTeamRegistrationId)!;
    const away = table.get(match.awayTeamRegistrationId)!;
    home.goalsFor += match.homeScore;
    away.goalsFor += match.awayScore;
    home.goalDifference += match.homeScore - match.awayScore;
    away.goalDifference += match.awayScore - match.homeScore;
    if (match.homeScore > match.awayScore) home.points += points.win;
    else if (match.homeScore < match.awayScore) away.points += points.win;
    else {
      home.points += points.draw;
      away.points += points.draw;
    }
  }
  return table;
}

export async function calculateStandings(
  executor: Executor,
  seasonId: string,
  groupId: string | null,
): Promise<StandingsCalculation> {
  const [season] = await executor
    .select({
      id: seasons.id,
      competitionId: seasons.competitionId,
    })
    .from(seasons)
    .where(eq(seasons.id, seasonId));
  if (!season) throw notFound('Season not found.');

  const groups = await executor
    .select({ id: competitionGroups.id, name: competitionGroups.name })
    .from(competitionGroups)
    .where(eq(competitionGroups.seasonId, seasonId))
    .orderBy(asc(competitionGroups.name), asc(competitionGroups.id));

  let scope: 'season' | 'group' = 'season';
  if (groupId) {
    if (!groups.some((group) => group.id === groupId)) {
      throw badRequest('The group does not belong to this season.');
    }
    scope = 'group';
  } else if (groups.length > 0) {
    throw badRequest(
      'This season is divided into groups; provide groupId to calculate isolated group standings.',
    );
  }

  const [rules] = await executor
    .select()
    .from(competitionRules)
    .where(eq(competitionRules.seasonId, seasonId));
  const points = {
    win: rules?.pointsWin ?? 3,
    draw: rules?.pointsDraw ?? 1,
    loss: rules?.pointsLoss ?? 0,
  };
  const configured = Array.isArray(rules?.tieBreakers)
    ? rules.tieBreakers.filter((value): value is string => typeof value === 'string')
    : [...BASELINE_TIE_BREAKERS];
  const ignoredTieBreakers = configured.filter(
    (value) =>
      !(BASELINE_TIE_BREAKERS as readonly string[]).includes(value) &&
      !RECOGNISED_TIE_BREAKERS.has(value),
  );
  const extraTieBreakers = configured.filter((value) =>
    RECOGNISED_TIE_BREAKERS.has(value),
  );

  const entries = await executor
    .select({
      teamRegistrationId: teamRegistrations.id,
      teamId: teamRegistrations.teamId,
      teamName: teams.name,
      groupId: teamRegistrations.groupId,
    })
    .from(teamRegistrations)
    .innerJoin(teams, eq(teamRegistrations.teamId, teams.id))
    .where(
      and(
        eq(teamRegistrations.seasonId, seasonId),
        eq(teamRegistrations.status, 'approved'),
        isNull(teams.archivedAt),
        groupId
          ? eq(teamRegistrations.groupId, groupId)
          : isNull(teamRegistrations.groupId),
      ),
    )
    .orderBy(asc(teams.name), asc(teamRegistrations.id));

  const standingsMatches: StandingsMatch[] = await executor
    .select({
      id: matches.id,
      homeTeamRegistrationId: fixtures.homeTeamRegistrationId,
      awayTeamRegistrationId: fixtures.awayTeamRegistrationId,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      resultConfirmedAt: matches.resultConfirmedAt,
    })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .where(
      and(
        eq(fixtures.seasonId, seasonId),
        groupId ? eq(fixtures.groupId, groupId) : isNull(fixtures.groupId),
        eq(matches.status, 'full_time'),
        eq(fixtures.status, 'completed'),
        isNotNull(matches.resultConfirmedAt),
      ),
    )
    .orderBy(asc(fixtures.scheduledAt), asc(matches.id))
    .then((rows) =>
      rows.filter(
        (row): row is StandingsMatch & { resultConfirmedAt: Date } =>
          row.resultConfirmedAt instanceof Date,
      ),
    );

  const rowByRegistration = new Map<string, StandingsRow>();
  for (const entry of entries) {
    rowByRegistration.set(entry.teamRegistrationId, {
      position: 0,
      teamId: entry.teamId,
      teamRegistrationId: entry.teamRegistrationId,
      teamName: entry.teamName,
      groupId: entry.groupId,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    });
  }

  for (const match of standingsMatches) {
    const home = rowByRegistration.get(match.homeTeamRegistrationId);
    const away = rowByRegistration.get(match.awayTeamRegistrationId);
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    if (match.homeScore > match.awayScore) {
      home.won += 1;
      away.lost += 1;
      home.points += points.win;
      away.points += points.loss;
    } else if (match.homeScore < match.awayScore) {
      away.won += 1;
      home.lost += 1;
      away.points += points.win;
      home.points += points.loss;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += points.draw;
      away.points += points.draw;
    }
  }
  for (const row of rowByRegistration.values()) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  }

  let sorted = [...rowByRegistration.values()].sort(
    (left, right) =>
      right.points - left.points ||
      right.goalDifference - left.goalDifference ||
      right.goalsFor - left.goalsFor ||
      compareText(left.teamName.toLowerCase(), right.teamName.toLowerCase()) ||
      compareText(left.teamRegistrationId, right.teamRegistrationId),
  );

  const processedKeys: ((row: StandingsRow) => number)[] = [
    (row) => row.points,
    (row) => row.goalDifference,
    (row) => row.goalsFor,
  ];

  for (const breaker of extraTieBreakers) {
    if (breaker === 'wins') {
      processedKeys.push((row) => row.won);
      sorted = splitByTies(sorted, processedKeys).flatMap((group) =>
        [...group].sort((left, right) => right.won - left.won),
      );
      continue;
    }
    if (breaker === 'head_to_head') {
      sorted = splitByTies(sorted, processedKeys).flatMap((group) => {
        if (group.length < 2) return group;
        const table = headToHeadScores(
          new Set(group.map((row) => row.teamRegistrationId)),
          standingsMatches,
          points,
        );
        return [...group].sort((left, right) => {
          const leftStats = table.get(left.teamRegistrationId)!;
          const rightStats = table.get(right.teamRegistrationId)!;
          return (
            rightStats.points - leftStats.points ||
            rightStats.goalDifference - leftStats.goalDifference ||
            rightStats.goalsFor - leftStats.goalsFor
          );
        });
      });
    }
  }

  sorted = splitByTies(sorted, processedKeys).flatMap((group) =>
    [...group].sort(
      (left, right) =>
        compareText(left.teamName.toLowerCase(), right.teamName.toLowerCase()) ||
        compareText(left.teamRegistrationId, right.teamRegistrationId),
    ),
  );

  const rows = sorted.map((row, index) => ({ ...row, position: index + 1 }));
  const meta: StandingsMeta = {
    competitionId: season.competitionId,
    seasonId,
    groupId,
    scope,
    points,
    tieBreakers: [
      'points',
      'goal_difference',
      'goals_for',
      ...extraTieBreakers,
      'team_name',
      'team_registration_id',
    ],
    ignoredTieBreakers,
    matchIds: standingsMatches.map((match) => match.id).sort(compareText),
    matchCount: standingsMatches.length,
    fingerprint: fingerprintMatches(standingsMatches),
  };
  return { rows, meta };
}

export async function loadSeasonCompetition(executor: Executor, seasonId: string) {
  const [row] = await executor
    .select({ season: seasons, competition: competitions })
    .from(seasons)
    .innerJoin(competitions, eq(seasons.competitionId, competitions.id))
    .where(eq(seasons.id, seasonId));
  return row ?? null;
}
