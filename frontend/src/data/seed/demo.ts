import type {
  Announcement,
  Match,
  MatchEvent,
  MatchLineup,
  MatchReport,
  MatchStatistics,
  LineupPlayer,
  Player,
  PlayerPosition,
  PlayerStatistics,
  Team,
  TeamStatistics,
} from '@/types';
import { known } from '@/types';
import { placeStarters, rowCategories, formationRows, SUPPORTED_FORMATIONS } from '@/lib/formation';
import { positionCategory } from '@/lib/positions';
import { roundRobin } from '@/lib/roundRobin';
import { COMPETITION_ID, SEASON_ID, registrations, teams as baseTeams } from './afit-u25';

/**
 * DEMO DATA ONLY. Every player, event, score, table and article here is invented so the
 * interface can be exercised. It is loaded only when NEXT_PUBLIC_TOUCHLINE_DATA=demo,
 * and the UI shows a banner when it is.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const FIRST_ROUND = Date.UTC(2026, 9, 11, 13, 0); // Sunday 14:00 in Africa/Lagos
const WEEK = 7 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;
const PLAYED_ROUNDS = 5;
const LIVE_ROUND = 6;
const MATCH_MINUTES = 90;
const OFFICIAL_ID = 'demo-official-1';
const VENUES = ['AFIT Main Pitch', 'AFIT North Pitch'];

/** Match minute the demo clock has reached for a live match. */
function matchMinute(status: Match['status']): number {
  if (status === 'half-time') return 45;
  if (status === 'second-half') return 63;
  if (status === 'extra-time') return 105;
  return MATCH_MINUTES;
}

const TEAM_DETAILS: Record<string, { shortName: string; department: string }> = {
  'league-a-1': { shortName: 'AUTO', department: 'Automotive Engineering' },
  'league-a-2': { shortName: 'CSC', department: 'Computer Science' },
  'league-a-3': { shortName: 'ICE', department: 'Information and Communication Engineering' },
  'league-a-4': { shortName: 'STA', department: 'Statistics' },
  'league-a-5': { shortName: 'CIV', department: 'Civil Engineering' },
  'league-a-6': { shortName: 'TEL', department: 'Telecommunications Engineering' },
  'league-b-1': { shortName: 'CYB', department: 'Cyber Security' },
  'league-b-2': { shortName: 'PHY', department: 'Physics and Electronics' },
  'league-b-3': { shortName: 'AER', department: 'Aerospace Engineering' },
  'league-b-4': { shortName: 'ELE', department: 'Electrical Engineering' },
  'league-b-5': { shortName: 'MEC', department: 'Mechanical and Mechatronics Engineering' },
  'league-b-6': { shortName: 'ECU', department: 'Electrical and Chemical Engineering' },
};

const FIRST_NAMES = [
  'Chinedu', 'Emeka', 'Tunde', 'Seyi', 'Ifeanyi', 'Ayo', 'Kelechi', 'Sadiq', 'Mubarak', 'Osaze',
  'Buchi', 'Femi', 'Ibrahim', 'Samuel', 'Daniel', 'Victor', 'Peter', 'John', 'Michael', 'David',
  'Uchenna', 'Obinna', 'Yusuf', 'Abdul', 'Kingsley', 'Godwin', 'Collins', 'Bright', 'Efe', 'Tobi',
  'Nnamdi', 'Suleiman', 'Terhemba', 'Aondofa', 'Chidi', 'Ebuka', 'Gideon', 'Ikenna', 'Jamiu', 'Kunle',
];

const LAST_NAMES = [
  'Okafor', 'Adeyemi', 'Balogun', 'Eze', 'Ibrahim', 'Okonkwo', 'Olawale', 'Musa', 'Chukwu', 'Adebayo',
  'Nwosu', 'Bello', 'Ogunleye', 'Uche', 'Lawal', 'Abubakar', 'Obi', 'Ojo', 'Danjuma', 'Ilesanmi',
  'Ike', 'Okechukwu', 'Ahmed', 'Bassey', 'Etim', 'Oni', 'Sule', 'Agbo', 'Nnamdi', 'Oyelaran',
  'Achebe', 'Olabisi', 'Garba', 'Ekwueme', 'Oladipo', 'Ezeani', 'Kalu', 'Umar', 'Akin', 'Ogundipe',
];

const POSITION_PLAN: PlayerPosition[] = [
  'GK', 'GK',
  'DF', 'DF', 'DF', 'DF', 'DF', 'DF',
  'MF', 'MF', 'MF', 'MF', 'MF', 'MF',
  'FW', 'FW', 'FW', 'FW',
];

function uniqueName(teamId: string, index: number, used: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const h = hash(`${teamId}:${index}:${attempt}`);
    const name = `${FIRST_NAMES[h % FIRST_NAMES.length]!} ${LAST_NAMES[(h >>> 8) % LAST_NAMES.length]!}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Player ${teamId} ${index + 1}`;
  used.add(fallback);
  return fallback;
}

export function buildDemoTeams(): Team[] {
  return baseTeams.map((team) => ({ ...team, ...(TEAM_DETAILS[team.id] ?? {}) }));
}

export function buildDemoPlayers(teams: Team[]): Player[] {
  const usedNames = new Set<string>();
  const players: Player[] = [];
  for (const team of teams) {
    POSITION_PLAN.forEach((position, i) => {
      const h = hash(`${team.id}:dob:${i}`);
      const year = 2002 + (h % 5);
      const month = 1 + ((h >>> 3) % 12);
      const day = 1 + ((h >>> 7) % 28);
      players.push({
        id: `demo-player-${team.id}-${i + 1}`,
        fullName: uniqueName(team.id, i, usedNames),
        teamId: team.id,
        department: team.department,
        position,
        shirtNumber: i + 1,
        dateOfBirth: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        squadStatus: 'approved',
      });
    });
  }
  return players;
}

export function buildDemoMatches(): Match[] {
  const matches: Match[] = [];
  for (const leagueId of ['league-a', 'league-b']) {
    const ids = registrations.filter((r) => r.leagueId === leagueId).map((r) => r.teamId);
    let liveUsed = false;
    for (const pairing of roundRobin(ids, true)) {
      const id = `demo-${leagueId}-${pairing.round}-${pairing.homeId}-${pairing.awayId}`;
      const h = hash(id);
      const played = pairing.round <= PLAYED_ROUNDS;
      const live = pairing.round === LIVE_ROUND && !liveUsed;
      if (live) liveUsed = true;

      // One match per league is in progress: League A in the second half, League B at half-time.
      const liveStatus = leagueId === 'league-a' ? 'second-half' : 'half-time';
      const liveScore = leagueId === 'league-a' ? { home: 2, away: 1 } : { home: 0, away: 1 };
      const score = played
        ? { home: h % 5, away: (h >>> 5) % 4 }
        : live
          ? liveScore
          : null;

      matches.push({
        id,
        competitionId: COMPETITION_ID,
        seasonId: SEASON_ID,
        leagueId,
        round: pairing.round,
        homeTeamId: pairing.homeId,
        awayTeamId: pairing.awayId,
        kickoffAt: new Date(FIRST_ROUND + (pairing.round - 1) * WEEK + (h % 2) * 2 * 3600 * 1000).toISOString(),
        venue: VENUES[h % VENUES.length]!,
        status: played ? 'full-time' : live ? liveStatus : 'scheduled',
        score,
        resultConfirmed: played,
      });
    }
  }
  return matches;
}

function take<T>(items: T[], count: number, seed: string): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return [...items];
  const offset = hash(seed) % items.length;
  return Array.from({ length: count }, (_, index) => items[(offset + index) % items.length]!);
}

function buildLineup(match: Match, teamId: string, players: Player[], clubCaptainId?: string): MatchLineup {
  const formation = SUPPORTED_FORMATIONS[hash(`${match.id}:${teamId}:formation`) % SUPPORTED_FORMATIONS.length]!;
  const rows = formationRows(formation);
  const categories = rowCategories(rows);
  const groups = {
    GK: players.filter((p) => p.position === 'GK'),
    DF: players.filter((p) => p.position === 'DF'),
    MF: players.filter((p) => p.position === 'MF'),
    FW: players.filter((p) => p.position === 'FW'),
  };
  const counts: Record<'GK' | 'DF' | 'MF' | 'FW', number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  rows.forEach((count, row) => { counts[categories[row]!] += count; });
  const starters = [
    ...take(groups.GK, counts.GK, `${match.id}:${teamId}:GK`),
    ...take(groups.DF, counts.DF, `${match.id}:${teamId}:DF`),
    ...take(groups.MF, counts.MF, `${match.id}:${teamId}:MF`),
    ...take(groups.FW, counts.FW, `${match.id}:${teamId}:FW`),
  ];
  const placed = placeStarters(formation, starters);
  const starterIds = new Set(placed.map(({ player }) => player.id));
  const remaining = players.filter((p) => !starterIds.has(p.id));
  const substitutes = remaining.slice(0, 5);
  const unavailable = remaining.slice(5);
  const captain = placed.find(({ player }) => player.id === clubCaptainId)?.player.id
    ?? placed.find(({ player }) => player.position === 'FW')?.player.id
    ?? placed[0]?.player.id;
  const kickoff = match.kickoffAt ? Date.parse(match.kickoffAt) : Number.NaN;
  const unavailableReasons = ['Injured', 'Illness', 'Personal reasons'];

  return {
    matchId: match.id,
    teamId,
    formation,
    submittedAt: Number.isNaN(kickoff) ? undefined : new Date(kickoff - 60 * 60 * 1000).toISOString(),
    players: [
      ...placed.map(({ player, slot }) => ({
        playerId: player.id,
        role: 'starter' as const,
        shirtNumber: player.shirtNumber,
        position: positionCategory(player.position) ?? undefined,
        slot,
        isCaptain: player.id === captain,
      })),
      ...substitutes.map((p) => ({
        playerId: p.id,
        role: 'substitute' as const,
        shirtNumber: p.shirtNumber,
        position: positionCategory(p.position) ?? undefined,
      })),
      ...unavailable.map((p) => ({
        playerId: p.id,
        role: 'unavailable' as const,
        shirtNumber: p.shirtNumber,
        position: positionCategory(p.position) ?? undefined,
        unavailableReason: unavailableReasons[hash(`${match.id}:${teamId}:${p.id}:reason`) % unavailableReasons.length]!,
      })),
    ],
  };
}

function pickPlayer(players: LineupPlayer[], seed: string, filter?: (p: LineupPlayer) => boolean) {
  const pool = filter ? players.filter(filter) : players;
  const list = pool.length > 0 ? pool : players;
  return list[hash(seed) % list.length]!;
}

/** Starters plus the two substitutes who come on. Keeps goals and cards off the bench. */
function appearingPlayers(lineup: MatchLineup): LineupPlayer[] {
  const starters = lineup.players.filter((p) => p.role === 'starter');
  const substitutes = lineup.players.filter((p) => p.role === 'substitute');
  return [...starters, ...substitutes.slice(1, 3)];
}

function buildMatchEvents(match: Match, homeLineup: MatchLineup, awayLineup: MatchLineup): MatchEvent[] {
  const events: MatchEvent[] = [];
  const eventId = (suffix: string) => `demo-event-${match.id}-${suffix}`;
  const score = match.score ?? { home: 0, away: 0 };
  const limit = matchMinute(match.status);
  const isLive = match.status !== 'full-time';
  const minuteBetween = (seed: string, from: number, to: number) =>
    from + (hash(seed) % Math.max(1, to - from));
  const added = (minute: number, seed: string) =>
    minute >= 45 && hash(`${seed}:added`) % 5 === 0
      ? { addedMinutes: 1 + (hash(`${seed}:added:value`) % 3) }
      : {};

  const sides = [
    {
      teamId: match.homeTeamId, lineup: homeLineup,
      players: appearingPlayers(homeLineup), opponents: appearingPlayers(awayLineup), goals: score.home,
    },
    {
      teamId: match.awayTeamId, lineup: awayLineup,
      players: appearingPlayers(awayLineup), opponents: appearingPlayers(homeLineup), goals: score.away,
    },
  ];

  events.push({ id: eventId('kickoff'), matchId: match.id, minute: 0, teamId: match.homeTeamId, type: 'kickoff', syncState: 'confirmed' });
  if (limit >= 45) {
    events.push({ id: eventId('half-time'), matchId: match.id, minute: 45, addedMinutes: 2, teamId: match.homeTeamId, type: 'half-time', syncState: 'confirmed' });
  }

  for (const side of sides) {
    for (let g = 0; g < side.goals; g++) {
      const seed = `${match.id}:goal:${side.teamId}:${g}`;
      const minute = minuteBetween(`${seed}:minute`, 4, Math.max(6, limit - 1));
      const roll = hash(`${seed}:type`) % 20;

      if (roll === 0 && side.opponents.length > 0) {
        const scorer = pickPlayer(side.opponents, seed);
        events.push({
          id: eventId(`own-goal-${side.teamId}-${g}`),
          matchId: match.id,
          minute,
          ...added(minute, seed),
          teamId: side.teamId,
          playerId: scorer.playerId,
          type: 'own-goal',
          description: 'Turned into their own net',
          syncState: 'confirmed',
        });
        continue;
      }

      const scorer = pickPlayer(side.players, seed, (p) => p.position === 'FW' || p.position === 'MF');
      if (roll <= 2) {
        events.push({
          id: eventId(`penalty-${side.teamId}-${g}`),
          matchId: match.id,
          minute,
          ...added(minute, seed),
          teamId: side.teamId,
          playerId: scorer.playerId,
          type: 'penalty-scored',
          description: 'Converted from the spot',
          syncState: 'confirmed',
        });
        continue;
      }

      const assist = hash(`${seed}:assist`) % 10 < 7
        ? pickPlayer(side.players, `${seed}:assist`, (p) => p.playerId !== scorer.playerId && (p.position === 'FW' || p.position === 'MF'))
        : undefined;
      events.push({
        id: eventId(`goal-${side.teamId}-${g}`),
        matchId: match.id,
        minute,
        ...added(minute, seed),
        teamId: side.teamId,
        playerId: scorer.playerId,
        assistPlayerId: assist?.playerId,
        type: 'goal',
        syncState: 'confirmed',
      });
    }

    // An awarded penalty that is not converted, independent of the scoreline.
    if (limit > 25 && hash(`${match.id}:pen-miss:${side.teamId}`) % 7 === 0) {
      const seed = `${match.id}:pen-miss:${side.teamId}`;
      const minute = minuteBetween(`${seed}:minute`, 18, limit - 2);
      const taker = pickPlayer(side.players, seed, (p) => p.position !== 'GK');
      events.push({
        id: eventId(`pen-awarded-${side.teamId}`),
        matchId: match.id,
        minute,
        ...added(minute, seed),
        teamId: side.teamId,
        playerId: taker.playerId,
        type: 'penalty-awarded',
        syncState: 'confirmed',
      });
      events.push({
        id: eventId(`pen-missed-${side.teamId}`),
        matchId: match.id,
        minute: Math.min(limit, minute + 1),
        teamId: side.teamId,
        playerId: taker.playerId,
        type: 'penalty-missed',
        description: 'Saved by the goalkeeper',
        syncState: 'confirmed',
      });
    }

    const cardCount = hash(`${match.id}:cards:${side.teamId}`) % 4;
    for (let i = 0; i < cardCount; i++) {
      const seed = `${match.id}:yellow:${side.teamId}:${i}`;
      const minute = minuteBetween(`${seed}:minute`, 10, Math.max(12, limit - 2));
      const carded = pickPlayer(side.players, seed, (p) => p.position !== 'GK');
      events.push({
        id: eventId(`yellow-${side.teamId}-${i}`),
        matchId: match.id,
        minute,
        ...added(minute, seed),
        teamId: side.teamId,
        playerId: carded.playerId,
        type: 'yellow-card',
        syncState: 'confirmed',
      });
    }

    if (limit > 55 && hash(`${match.id}:second-yellow:${side.teamId}`) % 8 === 0) {
      const seed = `${match.id}:second-yellow:${side.teamId}`;
      const player = pickPlayer(side.players, seed, (p) => p.position !== 'GK');
      const first = minuteBetween(`${seed}:first`, 22, Math.max(24, limit - 8));
      const second = Math.min(limit - 1, first + 8 + (hash(`${seed}:gap`) % 14));
      if (second > first) {
        events.push({
          id: eventId(`yellow-first-${side.teamId}`),
          matchId: match.id,
          minute: first,
          teamId: side.teamId,
          playerId: player.playerId,
          type: 'yellow-card',
          syncState: 'confirmed',
        });
        events.push({
          id: eventId(`yellow-second-${side.teamId}`),
          matchId: match.id,
          minute: second,
          teamId: side.teamId,
          playerId: player.playerId,
          type: 'second-yellow',
          description: 'Sent off after a second booking',
          syncState: 'confirmed',
        });
      }
    } else if (limit > 55 && hash(`${match.id}:red:${side.teamId}`) % 9 === 0) {
      const seed = `${match.id}:red:${side.teamId}`;
      const minute = minuteBetween(`${seed}:minute`, 55, limit - 1);
      const carded = pickPlayer(side.players, seed, (p) => p.position !== 'GK');
      events.push({
        id: eventId(`red-${side.teamId}`),
        matchId: match.id,
        minute,
        ...added(minute, seed),
        teamId: side.teamId,
        playerId: carded.playerId,
        type: 'red-card',
        syncState: 'confirmed',
      });
    }

    if (limit > 15 && hash(`${match.id}:injury:${side.teamId}`) % 5 === 0) {
      const seed = `${match.id}:injury:${side.teamId}`;
      const minute = minuteBetween(`${seed}:minute`, 8, limit - 2);
      const injured = pickPlayer(side.players, seed, (p) => p.position !== 'GK');
      events.push({
        id: eventId(`injury-${side.teamId}`),
        matchId: match.id,
        minute,
        ...added(minute, seed),
        teamId: side.teamId,
        playerId: injured.playerId,
        type: 'injury',
        description: 'Forced off after treatment',
        syncState: 'confirmed',
      });
    }

    const starters = side.lineup.players.filter((p) => p.role === 'starter');
    const substitutes = side.lineup.players.filter((p) => p.role === 'substitute');
    const maxSubs = limit < 58 ? 0 : limit < 70 ? 1 : 2;
    for (let i = 0; i < maxSubs; i++) {
      const off = starters[10 - i];
      const on = substitutes[i + 1];
      if (!off || !on) continue;
      const seed = `${match.id}:sub:${side.teamId}:${i}`;
      const minute = minuteBetween(seed, 55 + i * 10, limit - 1);
      events.push({
        id: eventId(`sub-${side.teamId}-${i}`),
        matchId: match.id,
        minute,
        teamId: side.teamId,
        playerOffId: off.playerId,
        playerOnId: on.playerId,
        type: 'substitution',
        syncState: 'confirmed',
      });
    }
  }

  if (isLive && events.length > 0) {
    // The most recent event of an in-progress match has not reached the server yet.
    const latest = events.reduce((a, b) => (b.minute > a.minute ? b : a));
    latest.syncState = 'pending';
  } else {
    events.push({ id: eventId('full-time'), matchId: match.id, minute: 90, addedMinutes: 4, teamId: match.homeTeamId, type: 'full-time', syncState: 'confirmed' });
  }
  return events;
}

function buildMatchStatistics(match: Match): MatchStatistics {
  const score = match.score ?? { home: 0, away: 0 };
  const h = hash(match.id);
  const a = hash(`${match.id}:away`);
  const possession = 42 + (h % 17);
  // Live statistics cover only the part of the match that has been played.
  const factor = matchMinute(match.status) / MATCH_MINUTES;
  const scaled = (value: number) => Math.round(value * factor);
  const homeOnTarget = score.home + scaled(1 + ((h >>> 4) % 5));
  const awayOnTarget = score.away + scaled(1 + ((a >>> 4) % 5));

  return {
    matchId: match.id,
    home: {
      possession,
      shots: homeOnTarget + scaled(1 + ((h >>> 8) % 7)),
      shotsOnTarget: homeOnTarget,
      corners: scaled(1 + ((h >>> 12) % 8)),
      fouls: scaled(5 + ((h >>> 16) % 11)),
      offsides: scaled((h >>> 20) % 5),
      saves: Math.max(0, awayOnTarget - score.away),
      passAccuracy: 68 + ((h >>> 24) % 24),
    },
    away: {
      possession: 100 - possession,
      shots: awayOnTarget + scaled(1 + ((a >>> 8) % 7)),
      shotsOnTarget: awayOnTarget,
      corners: scaled(1 + ((a >>> 12) % 8)),
      fouls: scaled(5 + ((a >>> 16) % 11)),
      offsides: scaled((a >>> 20) % 5),
      saves: Math.max(0, homeOnTarget - score.home),
      passAccuracy: 68 + ((a >>> 24) % 24),
    },
  };
}

function buildMatchReport(match: Match, events: MatchEvent[], teams: Team[], playerById: Map<string, Player>): MatchReport {
  const score = match.score ?? { home: 0, away: 0 };
  const home = teams.find((t) => t.id === match.homeTeamId)?.name ?? match.homeTeamId;
  const away = teams.find((t) => t.id === match.awayTeamId)?.name ?? match.awayTeamId;
  const scorers = events
    .filter((e) => (e.type === 'goal' || e.type === 'penalty-scored' || e.type === 'own-goal') && e.playerId)
    .map((e) => {
      const name = playerById.get(e.playerId!)?.fullName;
      if (!name) return null;
      return `${name}${e.type === 'penalty-scored' ? ' (pen)' : e.type === 'own-goal' ? ' (og)' : ''}`;
    })
    .filter((name): name is string => Boolean(name));
  const result = score.home === score.away
    ? `${home} and ${away} shared the points`
    : `${score.home > score.away ? home : away} took the win`;
  const kickoff = match.kickoffAt ? Date.parse(match.kickoffAt) : Number.NaN;

  return {
    matchId: match.id,
    summary: `${home} ${score.home}–${score.away} ${away}. ${result} in a demo fixture at ${match.venue ?? 'the league venue'}.${scorers.length ? ` Goals: ${scorers.join(', ')}.` : ''}`,
    publishedAt: Number.isNaN(kickoff) ? undefined : new Date(kickoff + 3 * 3600 * 1000).toISOString(),
    officialId: OFFICIAL_ID,
  };
}

interface Tally {
  appearances: number;
  starts: number;
  substituteAppearances: number;
  minutesPlayed: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}

function emptyTally(): Tally {
  return { appearances: 0, starts: 0, substituteAppearances: 0, minutesPlayed: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0 };
}

function buildPlayerStatistics(players: Player[], lineups: MatchLineup[], events: MatchEvent[]): PlayerStatistics[] {
  const tallies = new Map(players.map((p) => [p.id, emptyTally()]));
  const eventsByMatch = new Map<string, MatchEvent[]>();
  for (const event of events) {
    eventsByMatch.set(event.matchId, [...(eventsByMatch.get(event.matchId) ?? []), event]);
  }

  for (const lineup of lineups) {
    const matchEvents = eventsByMatch.get(lineup.matchId) ?? [];
    const subbedOffAt = new Map<string, number>();
    const cameOnAt = new Map<string, number>();
    for (const event of matchEvents) {
      if (event.type !== 'substitution') continue;
      subbedOffAt.set(event.playerOffId, event.minute);
      cameOnAt.set(event.playerOnId, event.minute);
    }

    for (const player of lineup.players) {
      const tally = tallies.get(player.playerId);
      if (!tally) continue;
      if (player.role === 'starter') {
        tally.starts += 1;
        tally.appearances += 1;
        tally.minutesPlayed += subbedOffAt.get(player.playerId) ?? MATCH_MINUTES;
      } else if (player.role === 'substitute' && cameOnAt.has(player.playerId)) {
        tally.substituteAppearances += 1;
        tally.appearances += 1;
        tally.minutesPlayed += MATCH_MINUTES - cameOnAt.get(player.playerId)!;
      }
    }
  }

  for (const event of events) {
    if (!event.playerId) continue;
    const tally = tallies.get(event.playerId);
    if (!tally) continue;
    if (event.type === 'goal' || event.type === 'penalty-scored') tally.goals += 1;
    if (event.type === 'goal' && event.assistPlayerId) {
      const assister = tallies.get(event.assistPlayerId);
      if (assister) assister.assists += 1;
    }
    if (event.type === 'yellow-card') tally.yellowCards += 1;
    if (event.type === 'red-card' || event.type === 'second-yellow') tally.redCards += 1;
  }

  return players.map((player) => {
    const tally = tallies.get(player.id)!;
    return {
      playerId: player.id,
      competitionId: COMPETITION_ID,
      seasonId: SEASON_ID,
      appearances: known(tally.appearances),
      starts: known(tally.starts),
      substituteAppearances: known(tally.substituteAppearances),
      minutesPlayed: known(tally.minutesPlayed),
      goals: known(tally.goals),
      assists: known(tally.assists),
      yellowCards: known(tally.yellowCards),
      redCards: known(tally.redCards),
    };
  });
}

function buildTeamStatistics(teams: Team[], matches: Match[], events: MatchEvent[]): TeamStatistics[] {
  const counted = matches.filter((m) => m.status === 'full-time' && m.resultConfirmed && m.score !== null);

  return teams.map((team) => {
    let played = 0;
    let won = 0;
    let drawn = 0;
    let lost = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    let cleanSheets = 0;

    for (const match of counted) {
      const isHome = match.homeTeamId === team.id;
      if (!isHome && match.awayTeamId !== team.id) continue;
      const own = isHome ? match.score!.home : match.score!.away;
      const other = isHome ? match.score!.away : match.score!.home;
      played += 1;
      goalsFor += own;
      goalsAgainst += other;
      if (own > other) won += 1;
      else if (own < other) lost += 1;
      else drawn += 1;
      if (other === 0) cleanSheets += 1;
    }

    const cards = events.filter((e) => e.teamId === team.id);
    return {
      teamId: team.id,
      competitionId: COMPETITION_ID,
      seasonId: SEASON_ID,
      played,
      won,
      drawn,
      lost,
      goalsFor,
      goalsAgainst,
      cleanSheets: known(cleanSheets),
      yellowCards: known(cards.filter((e) => e.type === 'yellow-card').length),
      redCards: known(cards.filter((e) => e.type === 'red-card' || e.type === 'second-yellow').length),
    };
  });
}

function buildDemoAnnouncements(matches: Match[]): Announcement[] {
  const at = (offsetDays: number) => new Date(FIRST_ROUND + offsetDays * DAY).toISOString();
  const roundIds = (round: number) => matches.filter((m) => m.round === round).slice(0, 4).map((m) => m.id);
  const liveIds = matches
    .filter((m) => m.status === 'half-time' || m.status === 'second-half')
    .map((m) => m.id);

  return [
    {
      id: 'demo-news-matchday-six-live',
      competitionId: COMPETITION_ID,
      category: 'notice',
      title: 'Matchday six: two games in progress',
      summary: 'League A is into the second half and League B has reached the break.',
      body: 'Matchday six is under way. One fixture in each league has kicked off, with the remaining games scheduled later today. Live scores, events and statistics update in the match centre as the officials record them.',
      author: 'Competition Office',
      status: 'published',
      publishedAt: at(35),
      relatedMatchIds: liveIds,
    },
    {
      id: 'demo-news-five-rounds',
      competitionId: COMPETITION_ID,
      category: 'update',
      title: 'Five rounds in: the title race takes shape',
      summary: 'Every team has now played the first leg of the season.',
      body: 'The first five matchdays are complete in both leagues. The tables are beginning to settle, with the leading sides opening a small gap. The reverse fixtures start on matchday six, so every team still has a chance to respond.',
      author: 'TOUCHLINE Media',
      status: 'published',
      publishedAt: at(34),
      relatedTeamIds: ['league-a-1', 'league-b-1'],
    },
    {
      id: 'demo-news-golden-boot',
      competitionId: COMPETITION_ID,
      category: 'update',
      title: 'Golden boot watch: the early front-runners',
      summary: 'The scoring charts are led by a small group of forwards.',
      body: 'Five matchdays have produced a healthy number of goals across both leagues. The leading scorers are separated by fine margins, and the assists chart is just as tight. Player statistics are available on every player profile.',
      author: 'TOUCHLINE Media',
      status: 'published',
      publishedAt: at(32),
    },
    {
      id: 'demo-news-matchday-five',
      competitionId: COMPETITION_ID,
      category: 'match-report',
      title: 'Matchday five round-up',
      summary: 'The first leg closes with wins, draws and a red card.',
      body: 'Matchday five completed the first half of the league programme. Results have been confirmed and the tables updated. Full lineups, events and statistics are available in each match centre, including penalties and own goals from the round.',
      author: 'TOUCHLINE Media',
      status: 'published',
      publishedAt: at(29),
      relatedMatchIds: roundIds(5),
    },
    {
      id: 'demo-news-discipline',
      competitionId: COMPETITION_ID,
      category: 'notice',
      title: 'Disciplinary panel publishes first decisions',
      summary: 'Bookings and dismissals from the opening rounds have been reviewed.',
      body: 'The competition disciplinary panel has reviewed the cards recorded in the opening rounds. Suspensions apply to the next fixture and are reflected in team selection. Match officials are reminded to submit reports before the next matchday.',
      author: 'Competition Office',
      status: 'published',
      publishedAt: at(27),
    },
    {
      id: 'demo-news-matchday-four',
      competitionId: COMPETITION_ID,
      category: 'match-report',
      title: 'Matchday four round-up',
      summary: 'Late goals and a penalty save made the fourth round memorable.',
      body: 'The fourth round produced another set of closely contested fixtures. A late winner settled one game, while a penalty save preserved a point in another. Results are confirmed and the tables have been updated.',
      author: 'TOUCHLINE Media',
      status: 'published',
      publishedAt: at(22),
      relatedMatchIds: roundIds(4),
    },
    {
      id: 'demo-news-matchday-three',
      competitionId: COMPETITION_ID,
      category: 'match-report',
      title: 'Matchday three round-up',
      summary: 'The first return fixtures of the season are complete.',
      body: 'Matchday three brought the first reverse fixtures and another full round of goals. All results have been confirmed, with lineups and match statistics recorded for every game.',
      author: 'TOUCHLINE Media',
      status: 'published',
      publishedAt: at(15),
      relatedMatchIds: roundIds(3),
    },
    {
      id: 'demo-news-title-race',
      competitionId: COMPETITION_ID,
      category: 'update',
      title: 'League A tightens after two matchdays',
      summary: 'Two rounds in, only goal difference separates the top two in League A.',
      body: 'Two matchdays into the AFIT U25 Super League and League A is already tight at the top. The early leaders have set the pace, but the chasing pack is close behind. Matchday three kicks off this weekend at the AFIT pitches.',
      author: 'TOUCHLINE Media',
      status: 'published',
      publishedAt: at(11),
    },
    {
      id: 'demo-news-matchday-two',
      competitionId: COMPETITION_ID,
      category: 'match-report',
      title: 'Matchday two round-up',
      summary: 'Goals, cards and a late winner: the second round of fixtures had it all.',
      body: 'The second round produced another entertaining set of fixtures across both leagues. Results have been confirmed and the tables have been updated. Full statistics and reports are available in the match centre.',
      author: 'TOUCHLINE Media',
      status: 'published',
      publishedAt: at(9),
      relatedMatchIds: roundIds(2),
    },
    {
      id: 'demo-news-squads',
      competitionId: COMPETITION_ID,
      category: 'announcement',
      title: 'Approved squad lists published',
      summary: 'Captains can now check the approved player list for every team.',
      body: 'Approved squad lists are available on each team profile and in the player directory. Any corrections must be raised with the competition office before the next matchday.',
      author: 'Competition Office',
      status: 'published',
      publishedAt: at(6),
    },
    {
      id: 'demo-news-captain',
      competitionId: COMPETITION_ID,
      category: 'team-news',
      title: 'AUTOMECH BOIS confirm their captain',
      summary: 'The Automotive Engineering side have named their on-field leader for the season.',
      body: 'AUTOMECH BOIS have confirmed their captain for the 2026/2027 campaign. The captain will lead the side out for the next fixture and will be listed on the team sheet.',
      author: 'Competition Office',
      status: 'published',
      publishedAt: at(4),
      relatedTeamIds: ['league-a-1'],
    },
    {
      id: 'demo-news-matchday-one',
      competitionId: COMPETITION_ID,
      category: 'match-report',
      title: 'Matchday one round-up',
      summary: 'The U25 Super League opened with a full round of fixtures.',
      body: 'The opening matchday is complete. Every fixture has a confirmed result, with goals, cards and lineups recorded in the match centre. The first tables are now live.',
      author: 'TOUCHLINE Media',
      status: 'published',
      publishedAt: at(2),
      relatedMatchIds: roundIds(1),
    },
    {
      id: 'demo-news-venues',
      competitionId: COMPETITION_ID,
      category: 'notice',
      title: 'Venues and kick-off times confirmed',
      summary: 'Matches will be played on the AFIT Main Pitch and AFIT North Pitch.',
      body: 'The competition office has confirmed the venues for the season. Kick-off times are listed on every fixture. Teams should arrive at least 30 minutes before kick-off.',
      author: 'Competition Office',
      status: 'published',
      publishedAt: at(-2),
    },
    {
      id: 'demo-news-kickoff',
      competitionId: COMPETITION_ID,
      category: 'announcement',
      title: 'AFIT U25 Super League 2026/2027 kicks off',
      summary: 'Twelve departmental teams, two leagues and a full season of football.',
      body: 'The AFIT U25 Super League returns for the 2026/2027 season. Twelve departmental teams will compete across two leagues, with the top sides contesting the title. Fixtures, results and tables are available on TOUCHLINE throughout the season.',
      author: 'Competition Office',
      status: 'published',
      publishedAt: at(-3),
      featured: true,
    },
  ];
}

export interface DemoData {
  teams: Team[];
  players: Player[];
  matches: Match[];
  events: MatchEvent[];
  lineups: MatchLineup[];
  matchStatistics: MatchStatistics[];
  reports: MatchReport[];
  playerStatistics: PlayerStatistics[];
  teamStatistics: TeamStatistics[];
  announcements: Announcement[];
}

export function buildDemoData(): DemoData {
  const baseTeams = buildDemoTeams();
  const players = buildDemoPlayers(baseTeams);
  const playersByTeam = new Map(baseTeams.map((team) => [team.id, players.filter((p) => p.teamId === team.id)]));

  // Every club has a named captain, and the same player wears the armband in the lineup when selected.
  const captainByTeam = new Map<string, string>();
  for (const team of baseTeams) {
    const captain = players.find((p) => p.teamId === team.id && p.position === 'FW');
    if (captain) captainByTeam.set(team.id, captain.id);
  }
  const teams = baseTeams.map((team) => {
    const captainId = captainByTeam.get(team.id);
    return captainId ? { ...team, captainPlayerId: captainId } : team;
  });

  const matches = buildDemoMatches();
  const playerById = new Map(players.map((player) => [player.id, player]));

  const events: MatchEvent[] = [];
  const lineups: MatchLineup[] = [];
  const matchStatistics: MatchStatistics[] = [];
  const reports: MatchReport[] = [];

  // Completed matches feed the season statistics; live matches only feed the match centre.
  const completedEvents: MatchEvent[] = [];
  const completedLineups: MatchLineup[] = [];

  for (const match of matches) {
    if (match.status === 'scheduled') continue;
    const homePlayers = playersByTeam.get(match.homeTeamId) ?? [];
    const awayPlayers = playersByTeam.get(match.awayTeamId) ?? [];
    const homeLineup = buildLineup(match, match.homeTeamId, homePlayers, captainByTeam.get(match.homeTeamId));
    const awayLineup = buildLineup(match, match.awayTeamId, awayPlayers, captainByTeam.get(match.awayTeamId));
    lineups.push(homeLineup, awayLineup);

    const matchEvents = buildMatchEvents(match, homeLineup, awayLineup);
    events.push(...matchEvents);
    matchStatistics.push(buildMatchStatistics(match));

    if (match.status === 'full-time') {
      reports.push(buildMatchReport(match, matchEvents, teams, playerById));
      completedEvents.push(...matchEvents);
      completedLineups.push(homeLineup, awayLineup);
    }
  }

  return {
    teams,
    players,
    matches,
    events,
    lineups,
    matchStatistics,
    reports,
    playerStatistics: buildPlayerStatistics(players, completedLineups, completedEvents),
    teamStatistics: buildTeamStatistics(teams, matches, completedEvents),
    announcements: buildDemoAnnouncements(matches),
  };
}
