import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (databaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = 'integrity-test-secret-with-at-least-32-chars';
  process.env.JWT_ISSUER = 'touchline-api';
  process.env.JWT_AUDIENCE = 'touchline-client';
  process.env.ACCESS_TOKEN_TTL = '15m';
  process.env.REFRESH_TOKEN_DAYS = '30';
  process.env.REFRESH_REUSE_GRACE_SECONDS = '2';
  process.env.COOKIE_SECURE = 'false';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.TRUST_PROXY = 'false';
}

if (!databaseUrl) {
  describe.skip('database integrity (requires TEST_DATABASE_URL)', () => {
    it('is skipped without an isolated database', () => {
      expect(true).toBe(true);
    });
  });
} else {
  type Sql = (typeof import('../src/database/client.js'))['sql'];
  type Db = (typeof import('../src/database/client.js'))['db'];

  let sql: Sql;
  let db: Db;
  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${++counter}-${randomUUID().slice(0, 8)}`;

  type Row = Record<string, unknown>;

  async function rows(query: Promise<Row[]>): Promise<Row[]> {
    return query;
  }

  async function idOf(query: Promise<Row[]>): Promise<string> {
    const [row] = await query;
    if (!row || typeof row.id !== 'string') throw new Error('Expected an inserted row id');
    return row.id;
  }

  async function expectDbError(run: () => Promise<unknown>, code: string): Promise<void> {
    try {
      await run();
    } catch (error) {
      expect((error as { code?: string }).code).toBe(code);
      return;
    }
    throw new Error(`Expected database error ${code}, but the statement succeeded`);
  }

  interface World {
    competitionId: string;
    seasonId: string;
    groupId: string;
    homeRegistrationId: string;
    awayRegistrationId: string;
    homePlayerId: string;
    awayPlayerId: string;
    homePlayerRegistrationId: string;
    awayPlayerRegistrationId: string;
    fixtureId: string;
    matchId: string;
    homeLineupId: string;
    awayLineupId: string;
  }

  async function insertCompetition(): Promise<string> {
    return idOf(
      rows(
        sql`INSERT INTO competitions (slug, name, status, visibility)
            VALUES (${unique('competition')}, ${unique('Competition')}, 'published', 'public')
            RETURNING id`,
      ),
    );
  }

  async function insertSeason(competitionId: string): Promise<string> {
    return idOf(
      rows(
        sql`INSERT INTO seasons (competition_id, label)
            VALUES (${competitionId}, ${unique('Season')}) RETURNING id`,
      ),
    );
  }

  async function insertGroup(seasonId: string, name = unique('Group')): Promise<string> {
    return idOf(
      rows(
        sql`INSERT INTO competition_groups (season_id, name, kind)
            VALUES (${seasonId}, ${name}, 'league') RETURNING id`,
      ),
    );
  }

  async function insertTeam(name = unique('Team')): Promise<string> {
    return idOf(rows(sql`INSERT INTO teams (name) VALUES (${name}) RETURNING id`));
  }

  async function insertTeamRegistration(
    teamId: string,
    seasonId: string,
    groupId: string | null,
    status = 'approved',
  ): Promise<string> {
    return idOf(
      rows(
        sql`INSERT INTO team_registrations (team_id, season_id, group_id, status)
            VALUES (${teamId}, ${seasonId}, ${groupId}, ${status}) RETURNING id`,
      ),
    );
  }

  async function insertPlayer(name = unique('Player')): Promise<string> {
    return idOf(
      rows(sql`INSERT INTO players (full_name, position) VALUES (${name}, 'MF') RETURNING id`),
    );
  }

  async function insertPlayerRegistration(
    playerId: string,
    teamRegistrationId: string,
    seasonId: string,
    matriculationNumber: string | null,
    shirtNumber: number | null,
    status = 'approved',
  ): Promise<string> {
    return idOf(
      rows(
        sql`INSERT INTO player_registrations
              (player_id, team_registration_id, season_id, matriculation_number, shirt_number, status)
            VALUES (${playerId}, ${teamRegistrationId}, ${seasonId}, ${matriculationNumber}, ${shirtNumber}, ${status})
            RETURNING id`,
      ),
    );
  }

  async function insertFixture(
    seasonId: string,
    groupId: string | null,
    homeTeamRegistrationId: string,
    awayTeamRegistrationId: string,
    round: number | null,
  ): Promise<string> {
    return idOf(
      rows(
        sql`INSERT INTO fixtures
              (season_id, group_id, home_team_registration_id, away_team_registration_id, round, scheduled_at, published_at)
            VALUES (${seasonId}, ${groupId}, ${homeTeamRegistrationId}, ${awayTeamRegistrationId}, ${round}, now() + interval '1 day', now())
            RETURNING id`,
      ),
    );
  }

  async function insertMatch(fixtureId: string): Promise<string> {
    return idOf(rows(sql`INSERT INTO matches (fixture_id) VALUES (${fixtureId}) RETURNING id`));
  }

  async function insertLineup(
    matchId: string,
    teamRegistrationId: string,
    formation: string | null,
    status = 'published',
  ): Promise<string> {
    return idOf(
      rows(
        sql`INSERT INTO lineups (match_id, team_registration_id, formation, status)
            VALUES (${matchId}, ${teamRegistrationId}, ${formation}, ${status}) RETURNING id`,
      ),
    );
  }

  async function insertLineupPlayer(
    lineupId: string,
    matchId: string,
    teamRegistrationId: string,
    playerRegistrationId: string,
    options: {
      role?: string;
      shirtNumber?: number | null;
      position?: string | null;
      x?: number | null;
      y?: number | null;
      isCaptain?: boolean;
    } = {},
  ): Promise<void> {
    const {
      role = 'starter',
      shirtNumber = null,
      position = null,
      x = null,
      y = null,
      isCaptain = false,
    } = options;
    await sql`INSERT INTO lineup_players
                (lineup_id, match_id, team_registration_id, player_registration_id, role, shirt_number, position, x, y, is_captain)
              VALUES (${lineupId}, ${matchId}, ${teamRegistrationId}, ${playerRegistrationId}, ${role}, ${shirtNumber}, ${position}, ${x}, ${y}, ${isCaptain})`;
  }

  async function makeWorld(): Promise<World> {
    const competitionId = await insertCompetition();
    const seasonId = await insertSeason(competitionId);
    const groupId = await insertGroup(seasonId);
    const homeTeamId = await insertTeam();
    const awayTeamId = await insertTeam();
    const homeRegistrationId = await insertTeamRegistration(homeTeamId, seasonId, groupId);
    const awayRegistrationId = await insertTeamRegistration(awayTeamId, seasonId, groupId);
    const homePlayerId = await insertPlayer();
    const awayPlayerId = await insertPlayer();
    const homePlayerRegistrationId = await insertPlayerRegistration(
      homePlayerId,
      homeRegistrationId,
      seasonId,
      unique('MAT'),
      7,
    );
    const awayPlayerRegistrationId = await insertPlayerRegistration(
      awayPlayerId,
      awayRegistrationId,
      seasonId,
      unique('MAT'),
      9,
    );
    const fixtureId = await insertFixture(
      seasonId,
      groupId,
      homeRegistrationId,
      awayRegistrationId,
      1,
    );
    const matchId = await insertMatch(fixtureId);
    const homeLineupId = await insertLineup(matchId, homeRegistrationId, '4-3-3');
    const awayLineupId = await insertLineup(matchId, awayRegistrationId, '4-4-2');
    await insertLineupPlayer(homeLineupId, matchId, homeRegistrationId, homePlayerRegistrationId, {
      shirtNumber: 7,
      position: 'GK',
      x: 50,
      y: 8,
      isCaptain: true,
    });
    await insertLineupPlayer(awayLineupId, matchId, awayRegistrationId, awayPlayerRegistrationId, {
      shirtNumber: 9,
      position: 'FW',
      x: 50,
      y: 92,
      isCaptain: true,
    });
    return {
      competitionId,
      seasonId,
      groupId,
      homeRegistrationId,
      awayRegistrationId,
      homePlayerId,
      awayPlayerId,
      homePlayerRegistrationId,
      awayPlayerRegistrationId,
      fixtureId,
      matchId,
      homeLineupId,
      awayLineupId,
    };
  }

  beforeAll(async () => {
    const client = await import('../src/database/client.js');
    sql = client.sql;
    db = client.db;
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE users, competitions, teams RESTART IDENTITY CASCADE`;
  });

  describe('player and team registration integrity', () => {
    it('rejects a player with two active registrations in the same season', async () => {
      const world = await makeWorld();
      await expectDbError(
        () =>
          sql`INSERT INTO player_registrations
                (player_id, team_registration_id, season_id, status)
              VALUES (${world.homePlayerId}, ${world.awayRegistrationId}, ${world.seasonId}, 'approved')`,
        '23505',
      );
    });

    it('rejects duplicate active matriculation numbers within a season', async () => {
      const world = await makeWorld();
      const [existing] = await rows(
        sql`SELECT matriculation_number FROM player_registrations
            WHERE id = ${world.homePlayerRegistrationId}`,
      );
      const newPlayerId = await insertPlayer();
      await expectDbError(
        () =>
          sql`INSERT INTO player_registrations
                (player_id, team_registration_id, season_id, matriculation_number, status)
              VALUES (${newPlayerId}, ${world.awayRegistrationId}, ${world.seasonId}, ${existing!.matriculation_number}, 'approved')`,
        '23505',
      );
    });

    it('keeps withdrawn history and transfers possible', async () => {
      const world = await makeWorld();
      const historyId = await insertPlayerRegistration(
        world.homePlayerId,
        world.awayRegistrationId,
        world.seasonId,
        null,
        null,
        'withdrawn',
      );
      expect(historyId).toBeTruthy();
    });

    it('rejects a player registration whose season differs from the team entry season', async () => {
      const world = await makeWorld();
      const otherCompetitionId = await insertCompetition();
      const otherSeasonId = await insertSeason(otherCompetitionId);
      const otherGroupId = await insertGroup(otherSeasonId);
      const otherTeamId = await insertTeam();
      const otherRegistrationId = await insertTeamRegistration(
        otherTeamId,
        otherSeasonId,
        otherGroupId,
      );
      await expectDbError(
        () =>
          sql`INSERT INTO player_registrations
                (player_id, team_registration_id, season_id, status)
              VALUES (${world.homePlayerId}, ${otherRegistrationId}, ${world.seasonId}, 'withdrawn')`,
        '23503',
      );
    });

    it('rejects duplicate team participation in the same season', async () => {
      const world = await makeWorld();
      const [homeTeam] = await rows(
        sql`SELECT team_id FROM team_registrations WHERE id = ${world.homeRegistrationId}`,
      );
      await expectDbError(
        () =>
          sql`INSERT INTO team_registrations (team_id, season_id, status)
              VALUES (${homeTeam!.team_id}, ${world.seasonId}, 'draft')`,
        '23505',
      );
    });

    it('rejects a team entry assigned to a group from another season', async () => {
      const world = await makeWorld();
      const otherCompetitionId = await insertCompetition();
      const otherSeasonId = await insertSeason(otherCompetitionId);
      const otherGroupId = await insertGroup(otherSeasonId);
      await expectDbError(
        () =>
          sql`UPDATE team_registrations SET group_id = ${otherGroupId}
              WHERE id = ${world.homeRegistrationId}`,
        '23503',
      );
    });

    it('rejects case-insensitive duplicate user emails', async () => {
      await sql`INSERT INTO users (email, password_hash, display_name)
                VALUES ('captain@example.test', 'hash', 'Captain')`;
      await expectDbError(
        () =>
          sql`INSERT INTO users (email, password_hash, display_name)
              VALUES ('CAPTAIN@EXAMPLE.TEST', 'hash', 'Captain duplicate')`,
        '23505',
      );
    });
  });

  describe('fixture integrity', () => {
    it('rejects a team playing itself', async () => {
      const world = await makeWorld();
      await expectDbError(
        () =>
          sql`INSERT INTO fixtures
                (season_id, group_id, home_team_registration_id, away_team_registration_id, round)
              VALUES (${world.seasonId}, ${world.groupId}, ${world.homeRegistrationId}, ${world.homeRegistrationId}, 2)`,
        '23514',
      );
    });

    it('rejects participants from another season', async () => {
      const world = await makeWorld();
      const otherCompetitionId = await insertCompetition();
      const otherSeasonId = await insertSeason(otherCompetitionId);
      const otherGroupId = await insertGroup(otherSeasonId);
      const otherRegistrationId = await insertTeamRegistration(
        await insertTeam(),
        otherSeasonId,
        otherGroupId,
      );
      await expectDbError(
        () =>
          sql`INSERT INTO fixtures
                (season_id, group_id, home_team_registration_id, away_team_registration_id, round)
              VALUES (${world.seasonId}, ${world.groupId}, ${world.homeRegistrationId}, ${otherRegistrationId}, 2)`,
        '23503',
      );
    });

    it('rejects a group from another season', async () => {
      const world = await makeWorld();
      const otherCompetitionId = await insertCompetition();
      const otherSeasonId = await insertSeason(otherCompetitionId);
      const otherGroupId = await insertGroup(otherSeasonId);
      await expectDbError(
        () =>
          sql`INSERT INTO fixtures
                (season_id, group_id, home_team_registration_id, away_team_registration_id, round)
              VALUES (${world.seasonId}, ${otherGroupId}, ${world.homeRegistrationId}, ${world.awayRegistrationId}, 2)`,
        '23503',
      );
    });

    it('rejects an exact duplicate fixture but allows the reversed home-and-away leg', async () => {
      const world = await makeWorld();
      await expectDbError(
        () =>
          sql`INSERT INTO fixtures
                (season_id, group_id, home_team_registration_id, away_team_registration_id, round)
              VALUES (${world.seasonId}, ${world.groupId}, ${world.homeRegistrationId}, ${world.awayRegistrationId}, 1)`,
        '23505',
      );
      const reverseId = await insertFixture(
        world.seasonId,
        world.groupId,
        world.awayRegistrationId,
        world.homeRegistrationId,
        1,
      );
      expect(reverseId).toBeTruthy();
    });

    it('rejects a non-positive round', async () => {
      const world = await makeWorld();
      await expectDbError(
        () =>
          sql`INSERT INTO fixtures
                (season_id, group_id, home_team_registration_id, away_team_registration_id, round)
              VALUES (${world.seasonId}, ${world.groupId}, ${world.awayRegistrationId}, ${world.homeRegistrationId}, 0)`,
        '23514',
      );
    });
  });

  describe('match result and event integrity', () => {
    it('rejects negative scores', async () => {
      const world = await makeWorld();
      await expectDbError(
        () => sql`UPDATE matches SET home_score = -1 WHERE id = ${world.matchId}`,
        '23514',
      );
    });

    it('rejects unsupported event types and invalid minutes', async () => {
      const world = await makeWorld();
      await expectDbError(
        () =>
          sql`INSERT INTO match_events (match_id, client_event_id, event_type, minute)
              VALUES (${world.matchId}, ${randomUUID()}, 'not-a-football-event', 10)`,
        '23514',
      );
      await expectDbError(
        () =>
          sql`INSERT INTO match_events (match_id, client_event_id, event_type, minute)
              VALUES (${world.matchId}, ${randomUUID()}, 'goal', -1)`,
        '23514',
      );
      await expectDbError(
        () =>
          sql`INSERT INTO match_events (match_id, client_event_id, event_type, minute, added_minutes)
              VALUES (${world.matchId}, ${randomUUID()}, 'goal', 45, 31)`,
        '23514',
      );
    });

    it('rejects event participants from the opposing team or outside the match', async () => {
      const world = await makeWorld();
      await expectDbError(
        () =>
          sql`INSERT INTO match_events
                (match_id, client_event_id, event_type, team_registration_id, player_registration_id, minute)
              VALUES (${world.matchId}, ${randomUUID()}, 'goal', ${world.homeRegistrationId}, ${world.awayPlayerRegistrationId}, 10)`,
        '23514',
      );

      const outsiderRegistrationId = await insertTeamRegistration(
        await insertTeam(),
        world.seasonId,
        world.groupId,
      );
      await expectDbError(
        () =>
          sql`INSERT INTO match_events
                (match_id, client_event_id, event_type, team_registration_id, minute)
              VALUES (${world.matchId}, ${randomUUID()}, 'goal', ${outsiderRegistrationId}, 10)`,
        '23514',
      );
    });

    it('accepts a legitimate own goal and a well-formed substitution', async () => {
      const world = await makeWorld();
      await sql`INSERT INTO match_events
                  (match_id, client_event_id, event_type, team_registration_id, player_registration_id, minute)
                VALUES (${world.matchId}, ${randomUUID()}, 'own-goal', ${world.homeRegistrationId}, ${world.homePlayerRegistrationId}, 12)`;

      const substitutePlayerId = await insertPlayer();
      const substituteRegistrationId = await insertPlayerRegistration(
        substitutePlayerId,
        world.homeRegistrationId,
        world.seasonId,
        unique('MAT'),
        14,
      );
      await sql`INSERT INTO match_events
                  (match_id, client_event_id, event_type, team_registration_id, player_registration_id, secondary_player_registration_id, minute)
                VALUES (${world.matchId}, ${randomUUID()}, 'substitution', ${world.homeRegistrationId}, ${world.homePlayerRegistrationId}, ${substituteRegistrationId}, 60)`;
    });

    it('rejects an incomplete or self-referencing substitution', async () => {
      const world = await makeWorld();
      await expectDbError(
        () =>
          sql`INSERT INTO match_events
                (match_id, client_event_id, event_type, team_registration_id, player_registration_id, minute)
              VALUES (${world.matchId}, ${randomUUID()}, 'substitution', ${world.homeRegistrationId}, ${world.homePlayerRegistrationId}, 60)`,
        '23514',
      );
      await expectDbError(
        () =>
          sql`INSERT INTO match_events
                (match_id, client_event_id, event_type, team_registration_id, player_registration_id, secondary_player_registration_id, minute)
              VALUES (${world.matchId}, ${randomUUID()}, 'goal', ${world.homeRegistrationId}, ${world.homePlayerRegistrationId}, ${world.homePlayerRegistrationId}, 20)`,
        '23514',
      );
    });

    it('makes duplicate offline event submissions idempotent', async () => {
      const world = await makeWorld();
      const clientEventId = randomUUID();
      const first = await rows(
        sql`INSERT INTO match_events (match_id, client_event_id, event_type, minute)
            VALUES (${world.matchId}, ${clientEventId}, 'kickoff', 0)
            ON CONFLICT (match_id, client_event_id) DO NOTHING
            RETURNING id`,
      );
      const second = await rows(
        sql`INSERT INTO match_events (match_id, client_event_id, event_type, minute)
            VALUES (${world.matchId}, ${clientEventId}, 'kickoff', 0)
            ON CONFLICT (match_id, client_event_id) DO NOTHING
            RETURNING id`,
      );
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
      const [count] = await rows(
        sql`SELECT count(*)::int AS count FROM match_events
            WHERE match_id = ${world.matchId} AND client_event_id = ${clientEventId}`,
      );
      expect(count!.count).toBe(1);
    });
  });

  describe('lineup integrity', () => {
    it('rejects a lineup for a team that does not participate in the match', async () => {
      const world = await makeWorld();
      const outsiderRegistrationId = await insertTeamRegistration(
        await insertTeam(),
        world.seasonId,
        world.groupId,
      );
      await expectDbError(
        () => insertLineup(world.matchId, outsiderRegistrationId, '4-4-2'),
        '23514',
      );
    });

    it('rejects an opposing-team player in a lineup', async () => {
      const world = await makeWorld();
      const opposingPlayerId = await insertPlayer();
      const opposingRegistrationId = await insertPlayerRegistration(
        opposingPlayerId,
        world.awayRegistrationId,
        world.seasonId,
        unique('MAT'),
        15,
      );
      await expectDbError(
        () =>
          insertLineupPlayer(
            world.homeLineupId,
            world.matchId,
            world.homeRegistrationId,
            opposingRegistrationId,
            { role: 'starter' },
          ),
        '23503',
      );
    });

    it('rejects duplicate player appearances and multiple captains', async () => {
      const world = await makeWorld();
      await expectDbError(
        () =>
          insertLineupPlayer(
            world.homeLineupId,
            world.matchId,
            world.homeRegistrationId,
            world.homePlayerRegistrationId,
            { role: 'substitute' },
          ),
        '23505',
      );

      const secondPlayerId = await insertPlayer();
      const secondRegistrationId = await insertPlayerRegistration(
        secondPlayerId,
        world.homeRegistrationId,
        world.seasonId,
        unique('MAT'),
        11,
      );
      await expectDbError(
        () =>
          insertLineupPlayer(
            world.homeLineupId,
            world.matchId,
            world.homeRegistrationId,
            secondRegistrationId,
            { role: 'starter', isCaptain: true },
          ),
        '23505',
      );
    });

    it('rejects invalid roles, positions, formation, shirt numbers and coordinates', async () => {
      const world = await makeWorld();
      const secondPlayerId = await insertPlayer();
      const secondRegistrationId = await insertPlayerRegistration(
        secondPlayerId,
        world.homeRegistrationId,
        world.seasonId,
        unique('MAT'),
        11,
      );
      await expectDbError(
        () =>
          insertLineupPlayer(
            world.homeLineupId,
            world.matchId,
            world.homeRegistrationId,
            secondRegistrationId,
            { role: 'wizard' },
          ),
        '23514',
      );
      await expectDbError(
        () =>
          insertLineupPlayer(
            world.homeLineupId,
            world.matchId,
            world.homeRegistrationId,
            secondRegistrationId,
            { role: 'starter', position: 'XX' },
          ),
        '23514',
      );
      await expectDbError(
        () =>
          insertLineupPlayer(
            world.homeLineupId,
            world.matchId,
            world.homeRegistrationId,
            secondRegistrationId,
            { role: 'starter', x: 999, y: 50 },
          ),
        '23514',
      );
      await expectDbError(
        () =>
          insertLineupPlayer(
            world.homeLineupId,
            world.matchId,
            world.homeRegistrationId,
            secondRegistrationId,
            { role: 'starter', x: 50, y: null },
          ),
        '23514',
      );
      await expectDbError(
        () => sql`UPDATE lineups SET formation = '4-4-3' WHERE id = ${world.homeLineupId}`,
        '23514',
      );
      await expectDbError(
        () => sql`UPDATE lineups SET formation = 'wizard' WHERE id = ${world.homeLineupId}`,
        '23514',
      );
      await expectDbError(
        () => sql`UPDATE lineup_players SET shirt_number = 100 WHERE lineup_id = ${world.homeLineupId}`,
        '23514',
      );
    });

    it('accepts the documented 0-100 pitch coordinate system', async () => {
      const world = await makeWorld();
      await sql`UPDATE lineup_players SET x = 0, y = 100
                WHERE lineup_id = ${world.homeLineupId} AND player_registration_id = ${world.homePlayerRegistrationId}`;
      await sql`UPDATE lineup_players SET x = null, y = null
                WHERE lineup_id = ${world.homeLineupId} AND player_registration_id = ${world.homePlayerRegistrationId}`;
    });
  });

  describe('cross-record integrity', () => {
    it('rejects duplicate standings snapshot versions and allows a new version', async () => {
      const world = await makeWorld();
      await sql`INSERT INTO standings_snapshots (season_id, group_id, rows)
                VALUES (${world.seasonId}, ${world.groupId}, '[]')`;
      await expectDbError(
        () =>
          sql`INSERT INTO standings_snapshots (season_id, group_id, rows)
              VALUES (${world.seasonId}, ${world.groupId}, '[]')`,
        '23505',
      );
      await sql`INSERT INTO standings_snapshots (season_id, group_id, version, rows)
                VALUES (${world.seasonId}, ${world.groupId}, 2, '[]')`;
    });

    it('rejects announcements whose season belongs to another competition', async () => {
      const world = await makeWorld();
      const otherCompetitionId = await insertCompetition();
      const otherSeasonId = await insertSeason(otherCompetitionId);
      await expectDbError(
        () =>
          sql`INSERT INTO announcements (competition_id, season_id, title, body)
              VALUES (${world.competitionId}, ${otherSeasonId}, 'Notice', 'Body')`,
        '23503',
      );
      await expectDbError(
        () =>
          sql`INSERT INTO announcements (season_id, title, body)
              VALUES (${world.seasonId}, 'Notice', 'Body')`,
        '23514',
      );
    });

    it('rejects invalid uploaded file metadata', async () => {
      await expectDbError(
        () =>
          sql`INSERT INTO uploaded_files (storage_key, original_name, content_type, size_bytes)
              VALUES (${unique('key')}, 'file.txt', 'text/plain', -1)`,
        '23514',
      );
      await expectDbError(
        () =>
          sql`INSERT INTO uploaded_files (storage_key, original_name, content_type, size_bytes, sha256)
              VALUES (${unique('key')}, 'file.txt', 'text/plain', 1, 'not-a-sha')`,
        '23514',
      );
    });
  });

  describe('transaction and concurrency behavior', () => {
    it('rolls back every write when a later statement in the transaction fails', async () => {
      const world = await makeWorld();
      const rollbackTeamName = unique('Rollback FC');
      await expect(
        sql.begin(async (tx) => {
          await tx`INSERT INTO teams (name) VALUES (${rollbackTeamName})`;
          await tx`INSERT INTO fixtures
                     (season_id, group_id, home_team_registration_id, away_team_registration_id, round)
                   VALUES (${world.seasonId}, ${world.groupId}, ${world.homeRegistrationId}, ${world.homeRegistrationId}, 9)`;
        }),
      ).rejects.toBeTruthy();
      const [count] = await rows(
        sql`SELECT count(*)::int AS count FROM teams WHERE name = ${rollbackTeamName}`,
      );
      expect(count!.count).toBe(0);
    });

    it('prevents concurrent inserts from bypassing fixture uniqueness', async () => {
      const world = await makeWorld();
      const insert = () =>
        sql`INSERT INTO fixtures
              (season_id, group_id, home_team_registration_id, away_team_registration_id, round)
            VALUES (${world.seasonId}, ${world.groupId}, ${world.awayRegistrationId}, ${world.homeRegistrationId}, 1)
            RETURNING id`;
      const results = await Promise.allSettled([insert(), insert()]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      expect(rejected).toHaveLength(1);
      expect((rejected[0]!.reason as { code?: string }).code).toBe('23505');
      const [count] = await rows(
        sql`SELECT count(*)::int AS count FROM fixtures
            WHERE season_id = ${world.seasonId}
              AND home_team_registration_id = ${world.awayRegistrationId}
              AND away_team_registration_id = ${world.homeRegistrationId}
              AND round = 1`,
      );
      expect(count!.count).toBe(1);
    });
  });
}
