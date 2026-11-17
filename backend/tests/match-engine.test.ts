import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (databaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = 'phase5-test-secret-with-at-least-32-chars';
  process.env.JWT_ISSUER = 'touchline-api';
  process.env.JWT_AUDIENCE = 'touchline-client';
  process.env.ACCESS_TOKEN_TTL = '15m';
  process.env.REFRESH_TOKEN_DAYS = '30';
  process.env.REFRESH_REUSE_GRACE_SECONDS = '2';
  process.env.COOKIE_SECURE = 'false';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.TRUST_PROXY = 'false';
}

const PASSWORD = 'phase5-test-password';

if (!databaseUrl) {
  describe.skip('match engine (requires TEST_DATABASE_URL)', () => {
    it('is skipped without an isolated database', () => {
      expect(true).toBe(true);
    });
  });
} else {
  type Db = (typeof import('../src/database/client.js'))['db'];
  type Sql = (typeof import('../src/database/client.js'))['sql'];
  type PlayersTable = typeof import('../src/database/schema/index.js')['players'];
  type PlayerRegistrationsTable =
    typeof import('../src/database/schema/index.js')['playerRegistrations'];
  type RolesTable = typeof import('../src/database/schema/index.js')['roles'];
  type UserRolesTable = typeof import('../src/database/schema/index.js')['userRoles'];
  type AuditLogsTable = typeof import('../src/database/schema/index.js')['auditLogs'];

  let app: FastifyInstance;
  let db: Db;
  let sql: Sql;
  let playersTable: PlayersTable;
  let playerRegistrationsTable: PlayerRegistrationsTable;
  let rolesTable: RolesTable;
  let userRolesTable: UserRolesTable;
  let auditLogsTable: AuditLogsTable;

  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${++counter}-${randomUUID().slice(0, 6)}`;
  const nextIp = () => `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;

  interface HttpOptions {
    token?: string;
    payload?: unknown;
  }

  function http(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    options: HttpOptions = {},
  ) {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    return app.inject({
      method,
      url,
      headers,
      payload: options.payload as string | object | undefined,
      remoteAddress: nextIp(),
    });
  }

  async function register(email: string): Promise<string> {
    const response = await http('POST', '/api/v1/auth/register', {
      payload: { email, password: PASSWORD, displayName: 'Phase 5 User' },
    });
    expect(response.statusCode).toBe(201);
    return (response.json().data as { id: string }).id;
  }

  async function login(email: string): Promise<string> {
    const response = await http('POST', '/api/v1/auth/login', {
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return (response.json().data as { accessToken: string }).accessToken;
  }

  async function grantRole(
    userId: string,
    roleName: string,
    competitionId: string | null = null,
  ): Promise<void> {
    const [role] = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(eq(rolesTable.name, roleName));
    if (!role) throw new Error(`Missing role ${roleName}`);
    await db.insert(userRolesTable).values({ userId, roleId: role.id, competitionId });
  }

  async function createSuperAdmin(): Promise<string> {
    const email = `${unique('super')}@example.test`;
    const id = await register(email);
    await grantRole(id, 'super_admin');
    return login(email);
  }

  async function createOfficial(competitionId: string) {
    const email = `${unique('official')}@example.test`;
    const userId = await register(email);
    await grantRole(userId, 'match_official', competitionId);
    return { userId, token: await login(email) };
  }

  async function createCompetitionAdmin(competitionId: string) {
    const email = `${unique('admin')}@example.test`;
    const response = await http('POST', '/api/v1/admin-accounts', {
      token: await createSuperAdmin(),
      payload: {
        email,
        password: PASSWORD,
        displayName: 'Competition Admin',
        role: 'competition_admin',
        competitionIds: [competitionId],
      },
    });
    expect(response.statusCode).toBe(201);
    return login(email);
  }

  async function createCompetition(
    token: string,
    options: { visibility?: 'public' | 'private'; publish?: boolean } = {},
  ): Promise<string> {
    const response = await http('POST', '/api/v1/competitions', {
      token,
      payload: {
        slug: unique('competition').toLowerCase(),
        name: unique('Competition'),
        visibility: options.visibility ?? 'public',
      },
    });
    expect(response.statusCode).toBe(201);
    const id = (response.json().data as { id: string }).id;
    if (options.publish !== false) {
      const published = await http('POST', `/api/v1/competitions/${id}/publish`, { token });
      expect(published.statusCode).toBe(200);
    }
    return id;
  }

  async function createSeason(token: string, competitionId: string): Promise<string> {
    const response = await http('POST', `/api/v1/competitions/${competitionId}/seasons`, {
      token,
      payload: { label: unique('Season') },
    });
    expect(response.statusCode).toBe(201);
    return (response.json().data as { id: string }).id;
  }

  interface TeamSetup {
    teamId: string;
    registrationId: string;
    captainToken: string;
    captainEmail: string;
  }

  async function setupTeam(
    adminToken: string,
    seasonId: string,
    name: string,
  ): Promise<TeamSetup> {
    const created = await http('POST', '/api/v1/teams', {
      token: adminToken,
      payload: { name, seasonId },
    });
    expect(created.statusCode).toBe(201);
    const team = created.json().data as { id: string; registration: { id: string } };
    const approved = await http('PATCH', `/api/v1/team-entries/${team.registration.id}`, {
      token: adminToken,
      payload: { status: 'approved' },
    });
    expect(approved.statusCode).toBe(200);

    const email = `${unique('captain')}@example.test`;
    const captain = await http('POST', '/api/v1/captains', {
      token: adminToken,
      payload: {
        email,
        password: PASSWORD,
        displayName: 'Team Captain',
        teamRegistrationId: team.registration.id,
      },
    });
    expect(captain.statusCode).toBe(201);
    return {
      teamId: team.id,
      registrationId: team.registration.id,
      captainToken: await login(email),
      captainEmail: email,
    };
  }

  async function addPlayer(teamRegistrationId: string, seasonId: string): Promise<string> {
    const [player] = await db
      .insert(playersTable)
      .values({ fullName: unique('Player') })
      .returning({ id: playersTable.id });
    const [registration] = await db
      .insert(playerRegistrationsTable)
      .values({
        playerId: player!.id,
        teamRegistrationId,
        seasonId,
        status: 'approved',
      })
      .returning({ id: playerRegistrationsTable.id });
    return registration!.id;
  }

  interface World {
    adminToken: string;
    competitionId: string;
    seasonId: string;
    teams: TeamSetup[];
  }

  async function buildWorld(teamCount: number, visibility: 'public' | 'private' = 'public'): Promise<World> {
    const adminToken = await createSuperAdmin();
    const competitionId = await createCompetition(adminToken, { visibility });
    const seasonId = await createSeason(adminToken, competitionId);
    const teams: TeamSetup[] = [];
    for (let index = 0; index < teamCount; index += 1) {
      teams.push(await setupTeam(adminToken, seasonId, unique('Team')));
    }
    return { adminToken, competitionId, seasonId, teams };
  }

  interface MatchSetup {
    fixtureId: string;
    matchId: string;
  }

  async function createFixture(
    adminToken: string,
    seasonId: string,
    homeRegistrationId: string,
    awayRegistrationId: string,
    extra: Record<string, unknown> = {},
  ): Promise<MatchSetup> {
    const response = await http('POST', '/api/v1/fixtures', {
      token: adminToken,
      payload: {
        seasonId,
        homeTeamRegistrationId: homeRegistrationId,
        awayTeamRegistrationId: awayRegistrationId,
        ...extra,
      },
    });
    expect(response.statusCode).toBe(201);
    const data = response.json().data as {
      fixture: { id: string };
      match: { id: string };
    };
    return { fixtureId: data.fixture.id, matchId: data.match.id };
  }

  async function publishFixture(adminToken: string, fixtureId: string): Promise<void> {
    const response = await http('POST', `/api/v1/fixtures/${fixtureId}/publish`, {
      token: adminToken,
    });
    expect(response.statusCode).toBe(200);
  }

  async function readyMatch(world: World) {
    const fixture = await createFixture(
      world.adminToken,
      world.seasonId,
      world.teams[0]!.registrationId,
      world.teams[1]!.registrationId,
      { round: 1, scheduledAt: new Date().toISOString() },
    );
    await publishFixture(world.adminToken, fixture.fixtureId);
    return fixture;
  }

  async function assignOfficial(
    adminToken: string,
    matchId: string,
    userId: string,
  ) {
    return http('POST', `/api/v1/matches/${matchId}/officials`, {
      token: adminToken,
      payload: { userId },
    });
  }

  async function startedMatch(world: World, officialToken: string) {
    const match = await readyMatch(world);
    const start = await http('POST', `/api/v1/matches/${match.matchId}/start`, {
      token: officialToken,
      payload: {},
    });
    expect(start.statusCode).toBe(200);
    return match;
  }

  beforeAll(async () => {
    const client = await import('../src/database/client.js');
    db = client.db;
    sql = client.sql;
    const schema = await import('../src/database/schema/index.js');
    playersTable = schema.players;
    playerRegistrationsTable = schema.playerRegistrations;
    rolesTable = schema.roles;
    userRolesTable = schema.userRoles;
    auditLogsTable = schema.auditLogs;

    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
    const { seedSecurity } = await import('../src/database/seed/security.js');
    await seedSecurity();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE users, competitions, teams, players, audit_logs RESTART IDENTITY CASCADE`;
  });

  describe('fixture management', () => {
    it('creates draft fixtures, allows reversed legs, and rejects invalid identities', async () => {
      const world = await buildWorld(3);
      const [home, away, other] = world.teams;

      const created = await createFixture(
        world.adminToken,
        world.seasonId,
        home!.registrationId,
        away!.registrationId,
        { round: 1 },
      );
      const [fixtureRow] = await sql<{ status: string }[]>`
        SELECT status FROM fixtures WHERE id = ${created.fixtureId}
      `;
      expect(fixtureRow?.status).toBe('draft');

      const reversed = await createFixture(
        world.adminToken,
        world.seasonId,
        away!.registrationId,
        home!.registrationId,
        { round: 1 },
      );
      expect(reversed.fixtureId).not.toBe(created.fixtureId);

      const self = await http('POST', '/api/v1/fixtures', {
        token: world.adminToken,
        payload: {
          seasonId: world.seasonId,
          homeTeamRegistrationId: home!.registrationId,
          awayTeamRegistrationId: home!.registrationId,
        },
      });
      expect(self.statusCode).toBe(400);

      const duplicate = await http('POST', '/api/v1/fixtures', {
        token: world.adminToken,
        payload: {
          seasonId: world.seasonId,
          homeTeamRegistrationId: home!.registrationId,
          awayTeamRegistrationId: away!.registrationId,
          round: 1,
        },
      });
      expect(duplicate.statusCode).toBe(409);

      const secondSeason = await createSeason(world.adminToken, world.competitionId);
      const foreignTeam = await setupTeam(world.adminToken, secondSeason, unique('Team'));
      const crossSeason = await http('POST', '/api/v1/fixtures', {
        token: world.adminToken,
        payload: {
          seasonId: world.seasonId,
          homeTeamRegistrationId: home!.registrationId,
          awayTeamRegistrationId: foreignTeam.registrationId,
        },
      });
      expect(crossSeason.statusCode).toBe(400);
      void other;
    });

    it('keeps fixture creation inside competition scope and public reads to published fixtures', async () => {
      const world = await buildWorld(2);
      const captainToken = world.teams[0]!.captainToken;
      const forbidden = await http('POST', '/api/v1/fixtures', {
        token: captainToken,
        payload: {
          seasonId: world.seasonId,
          homeTeamRegistrationId: world.teams[0]!.registrationId,
          awayTeamRegistrationId: world.teams[1]!.registrationId,
        },
      });
      expect(forbidden.statusCode).toBe(403);

      const match = await createFixture(
        world.adminToken,
        world.seasonId,
        world.teams[0]!.registrationId,
        world.teams[1]!.registrationId,
        { round: 1, scheduledAt: new Date().toISOString() },
      );

      const beforePublish = await http(
        'GET',
        `/api/v1/fixtures?seasonId=${world.seasonId}`,
      );
      expect(beforePublish.statusCode).toBe(200);
      expect(beforePublish.json().data).toHaveLength(0);

      await publishFixture(world.adminToken, match.fixtureId);
      const afterPublish = await http(
        'GET',
        `/api/v1/fixtures?seasonId=${world.seasonId}`,
      );
      expect(afterPublish.statusCode).toBe(200);
      expect(afterPublish.json().data).toHaveLength(1);

      const filtered = await http(
        'GET',
        `/api/v1/fixtures?seasonId=${world.seasonId}&status=scheduled&teamId=${world.teams[0]!.teamId}`,
      );
      expect(filtered.statusCode).toBe(200);
      expect(filtered.json().data).toHaveLength(1);

      const byCompetition = await http(
        'GET',
        `/api/v1/fixtures?competitionId=${world.competitionId}`,
      );
      expect(byCompetition.statusCode).toBe(200);
      expect(byCompetition.json().data).toHaveLength(1);
    });

    it('generates even round-robin schedules with preview and idempotent commit', async () => {
      const world = await buildWorld(4);
      const preview = await http('POST', '/api/v1/fixtures/generate/preview', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, legs: 1 },
      });
      expect(preview.statusCode).toBe(200);
      const previewData = preview.json().data as {
        fixtures: Array<{ round: number; homeTeamRegistrationId: string; awayTeamRegistrationId: string }>;
      };
      expect(previewData.fixtures).toHaveLength(6);
      expect(new Set(previewData.fixtures.map((row) => row.round))).toEqual(new Set([1, 2, 3]));
      for (const row of previewData.fixtures) {
        expect(row.homeTeamRegistrationId).not.toBe(row.awayTeamRegistrationId);
      }

      const commit = await http('POST', '/api/v1/fixtures/generate', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, legs: 1 },
      });
      expect(commit.statusCode).toBe(201);
      expect((commit.json().data as { createdCount: number }).createdCount).toBe(6);

      const repeat = await http('POST', '/api/v1/fixtures/generate', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, legs: 1 },
      });
      expect(repeat.statusCode).toBe(409);

      const [count] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM fixtures WHERE season_id = ${world.seasonId}
      `;
      expect(count?.count).toBe(6);
    });

    it('handles odd team counts and double legs with reversed pairings', async () => {
      const oddWorld = await buildWorld(3);
      const oddPreview = await http('POST', '/api/v1/fixtures/generate/preview', {
        token: oddWorld.adminToken,
        payload: { seasonId: oddWorld.seasonId, legs: 1 },
      });
      expect(oddPreview.statusCode).toBe(200);
      expect((oddPreview.json().data as { fixtures: unknown[] }).fixtures).toHaveLength(3);

      const doubleWorld = await buildWorld(4);
      const doublePreview = await http('POST', '/api/v1/fixtures/generate/preview', {
        token: doubleWorld.adminToken,
        payload: { seasonId: doubleWorld.seasonId, legs: 2 },
      });
      expect(doublePreview.statusCode).toBe(200);
      const pairings = (
        doublePreview.json().data as {
          fixtures: Array<{
            round: number;
            homeTeamRegistrationId: string;
            awayTeamRegistrationId: string;
          }>;
        }
      ).fixtures;
      expect(pairings).toHaveLength(12);
      const keys = new Set(
        pairings.map((row) => `${row.round}|${row.homeTeamRegistrationId}|${row.awayTeamRegistrationId}`),
      );
      for (const row of pairings.filter((entry) => entry.round <= 3)) {
        expect(
          keys.has(
            `${row.round + 3}|${row.awayTeamRegistrationId}|${row.homeTeamRegistrationId}`,
          ),
        ).toBe(true);
      }
    }, 20_000);

    it('preserves manual fixtures and never partially duplicates an existing schedule', async () => {
      const world = await buildWorld(4);
      const manual = await createFixture(
        world.adminToken,
        world.seasonId,
        world.teams[0]!.registrationId,
        world.teams[1]!.registrationId,
        { round: 1 },
      );
      const preview = await http('POST', '/api/v1/fixtures/generate/preview', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, legs: 1 },
      });
      expect(preview.statusCode).toBe(200);
      expect((preview.json().data as { fixtures: unknown[] }).fixtures).toHaveLength(5);

      const commit = await http('POST', '/api/v1/fixtures/generate', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, legs: 1 },
      });
      expect(commit.statusCode).toBe(201);
      expect((commit.json().data as { createdCount: number }).createdCount).toBe(5);

      const [manualCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM fixtures WHERE id = ${manual.fixtureId}
      `;
      expect(manualCount?.count).toBe(1);
      const [total] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM fixtures WHERE season_id = ${world.seasonId}
      `;
      expect(total?.count).toBe(6);
    });
  });

  describe('match officials', () => {
    it('assigns eligible officials, rejects duplicates, and lists assigned matches', async () => {
      const world = await buildWorld(2);
      const match = await readyMatch(world);
      const official = await createOfficial(world.competitionId);

      const assigned = await assignOfficial(world.adminToken, match.matchId, official.userId);
      expect(assigned.statusCode).toBe(201);

      const duplicate = await assignOfficial(world.adminToken, match.matchId, official.userId);
      expect(duplicate.statusCode).toBe(409);

      const read = await http('GET', `/api/v1/matches/${match.matchId}`, {
        token: official.token,
      });
      expect(read.statusCode).toBe(200);

      const mine = await http('GET', '/api/v1/officials/me/matches', {
        token: official.token,
      });
      expect(mine.statusCode).toBe(200);
      expect((mine.json().data as Array<{ id: string }>).map((row) => row.id)).toContain(
        match.matchId,
      );

      const captainAssign = await assignOfficial(
        world.teams[0]!.captainToken,
        match.matchId,
        official.userId,
      );
      expect(captainAssign.statusCode).toBe(403);

      const selfAssign = await http('POST', `/api/v1/matches/${match.matchId}/officials`, {
        token: world.adminToken,
        payload: { userId: (await http('GET', '/api/v1/auth/me', { token: world.adminToken }))
          .json().data.id },
      });
      expect(selfAssign.statusCode).toBe(403);
    });

    it('keeps unassigned officials out of private matches and prevents removal after kickoff', async () => {
      const world = await buildWorld(2, 'private');
      const match = await readyMatch(world);
      const assigned = await createOfficial(world.competitionId);
      const outsider = await createOfficial(world.competitionId);

      const assignment = await assignOfficial(world.adminToken, match.matchId, assigned.userId);
      expect(assignment.statusCode).toBe(201);

      const outsiderRead = await http('GET', `/api/v1/matches/${match.matchId}`, {
        token: outsider.token,
      });
      expect(outsiderRead.statusCode).toBe(404);

      const start = await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: assigned.token,
        payload: {},
      });
      expect(start.statusCode).toBe(200);

      const removal = await http(
        'DELETE',
        `/api/v1/matches/${match.matchId}/officials/${assigned.userId}`,
        { token: world.adminToken },
      );
      expect(removal.statusCode).toBe(409);
    });
  });

  describe('match lifecycle and clock', () => {
    it('runs the period state machine, persists the clock and rejects invalid transitions', async () => {
      const world = await buildWorld(2);
      const match = await readyMatch(world);
      const official = await createOfficial(world.competitionId);
      await assignOfficial(world.adminToken, match.matchId, official.userId);

      const start = await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: official.token,
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      expect((start.json().data as { match: { status: string } }).match.status).toBe('first_half');

      const clock = await http('PATCH', `/api/v1/matches/${match.matchId}/clock`, {
        token: official.token,
        payload: { minute: 23, addedMinutes: 2 },
      });
      expect(clock.statusCode).toBe(200);
      expect(clock.json().data).toMatchObject({ currentMinute: 23, addedMinutes: 2 });

      const repeatStart = await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: official.token,
        payload: {},
      });
      expect(repeatStart.statusCode).toBe(409);

      const halfTime = await http('POST', `/api/v1/matches/${match.matchId}/half-time`, {
        token: official.token,
        payload: {},
      });
      expect(halfTime.statusCode).toBe(200);
      const secondHalf = await http('POST', `/api/v1/matches/${match.matchId}/second-half`, {
        token: official.token,
        payload: {},
      });
      expect(secondHalf.statusCode).toBe(200);
      const end = await http('POST', `/api/v1/matches/${match.matchId}/end`, {
        token: official.token,
        payload: {},
      });
      expect(end.statusCode).toBe(200);
      expect((end.json().data as { match: { status: string } }).match.status).toBe('full_time');

      const [fixture] = await sql<{ status: string }[]>`
        SELECT status FROM fixtures WHERE id = ${match.fixtureId}
      `;
      expect(fixture?.status).toBe('completed');

      const reopen = await http('POST', `/api/v1/matches/${match.matchId}/second-half`, {
        token: official.token,
        payload: {},
      });
      expect(reopen.statusCode).toBe(409);
    });

    it('serializes concurrent transitions and requires an assigned official', async () => {
      const world = await buildWorld(2);
      const match = await readyMatch(world);
      const official = await createOfficial(world.competitionId);
      const outsider = await createOfficial(world.competitionId);
      await assignOfficial(world.adminToken, match.matchId, official.userId);

      const unauthorized = await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: outsider.token,
        payload: {},
      });
      expect(unauthorized.statusCode).toBe(403);

      const [first, second] = await Promise.all([
        http('POST', `/api/v1/matches/${match.matchId}/start`, {
          token: official.token,
          payload: {},
        }),
        http('POST', `/api/v1/matches/${match.matchId}/start`, {
          token: official.token,
          payload: {},
        }),
      ]);
      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    });
  });

  describe('match events, corrections and score', () => {
    it('records valid events, derives the score and rejects invalid attribution', async () => {
      const world = await buildWorld(2);
      const official = await createOfficial(world.competitionId);
      const match = await readyMatch(world);
      await assignOfficial(world.adminToken, match.matchId, official.userId);
      await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: official.token,
        payload: {},
      });

      const homePlayer = await addPlayer(world.teams[0]!.registrationId, world.seasonId);
      const awayPlayer = await addPlayer(world.teams[1]!.registrationId, world.seasonId);

      const goal = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'goal',
          teamRegistrationId: world.teams[0]!.registrationId,
          playerRegistrationId: homePlayer,
          minute: 12,
        },
      });
      expect(goal.statusCode).toBe(201);
      expect(goal.json().data).toMatchObject({ created: true, score: { homeScore: 1, awayScore: 0 } });

      const ownGoal = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'own-goal',
          teamRegistrationId: world.teams[1]!.registrationId,
          playerRegistrationId: awayPlayer,
          minute: 30,
        },
      });
      expect(ownGoal.statusCode).toBe(201);
      expect(ownGoal.json().data).toMatchObject({ score: { homeScore: 2, awayScore: 0 } });

      const penalty = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'penalty-scored',
          teamRegistrationId: world.teams[1]!.registrationId,
          playerRegistrationId: awayPlayer,
          minute: 41,
        },
      });
      expect(penalty.statusCode).toBe(201);
      expect(penalty.json().data).toMatchObject({ score: { homeScore: 2, awayScore: 1 } });

      const invalidType = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'bogus',
          teamRegistrationId: world.teams[0]!.registrationId,
          playerRegistrationId: homePlayer,
          minute: 20,
        },
      });
      expect(invalidType.statusCode).toBe(400);

      const invalidMinute = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'goal',
          teamRegistrationId: world.teams[0]!.registrationId,
          playerRegistrationId: homePlayer,
          minute: 151,
        },
      });
      expect(invalidMinute.statusCode).toBe(400);

      const wrongTeamPlayer = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'goal',
          teamRegistrationId: world.teams[0]!.registrationId,
          playerRegistrationId: awayPlayer,
          minute: 20,
        },
      });
      expect(wrongTeamPlayer.statusCode).toBe(400);

      const selfSubstitution = await http(
        'POST',
        `/api/v1/matches/${match.matchId}/events`,
        {
          token: official.token,
          payload: {
            clientEventId: randomUUID(),
            eventType: 'substitution',
            teamRegistrationId: world.teams[0]!.registrationId,
            playerRegistrationId: homePlayer,
            secondaryPlayerRegistrationId: homePlayer,
            minute: 60,
          },
        },
      );
      expect(selfSubstitution.statusCode).toBe(400);
    });

    it('is idempotent for offline retries and rejects conflicting payload reuse', async () => {
      const world = await buildWorld(2);
      const official = await createOfficial(world.competitionId);
      const match = await readyMatch(world);
      await assignOfficial(world.adminToken, match.matchId, official.userId);
      await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: official.token,
        payload: {},
      });
      const homePlayer = await addPlayer(world.teams[0]!.registrationId, world.seasonId);
      const clientEventId = randomUUID();
      const payload = {
        clientEventId,
        eventType: 'yellow-card',
        teamRegistrationId: world.teams[0]!.registrationId,
        playerRegistrationId: homePlayer,
        minute: 18,
      };

      const first = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload,
      });
      expect(first.statusCode).toBe(201);
      const firstId = (first.json().data as { event: { id: string } }).event.id;

      const replay = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().data).toMatchObject({ created: false, event: { id: firstId } });

      const conflict = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: { ...payload, minute: 19 },
      });
      expect(conflict.statusCode).toBe(409);

      const [count] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM match_events WHERE match_id = ${match.matchId}
      `;
      expect(count?.count).toBe(1);

      const concurrentId = randomUUID();
      const concurrentPayload = {
        clientEventId: concurrentId,
        eventType: 'injury',
        teamRegistrationId: world.teams[0]!.registrationId,
        playerRegistrationId: homePlayer,
        minute: 25,
      };
      const [one, two] = await Promise.all([
        http('POST', `/api/v1/matches/${match.matchId}/events`, {
          token: official.token,
          payload: concurrentPayload,
        }),
        http('POST', `/api/v1/matches/${match.matchId}/events`, {
          token: official.token,
          payload: concurrentPayload,
        }),
      ]);
      expect([one.statusCode, two.statusCode].sort()).toEqual([200, 201]);
      const [concurrentCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM match_events
        WHERE match_id = ${match.matchId} AND client_event_id = ${concurrentId}
      `;
      expect(concurrentCount?.count).toBe(1);
    });

    it('audits corrections, keeps voided history and excludes voided events from public lists and score', async () => {
      const world = await buildWorld(2);
      const official = await createOfficial(world.competitionId);
      const match = await readyMatch(world);
      await assignOfficial(world.adminToken, match.matchId, official.userId);
      await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: official.token,
        payload: {},
      });
      const homePlayer = await addPlayer(world.teams[0]!.registrationId, world.seasonId);

      const goal = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'goal',
          teamRegistrationId: world.teams[0]!.registrationId,
          playerRegistrationId: homePlayer,
          minute: 10,
        },
      });
      const eventId = (goal.json().data as { event: { id: string } }).event.id;

      const correction = await http(
        'PATCH',
        `/api/v1/matches/${match.matchId}/events/${eventId}`,
        {
          token: official.token,
          payload: { minute: 11, reason: 'Clock was misread.' },
        },
      );
      expect(correction.statusCode).toBe(200);
      expect(correction.json().data).toMatchObject({
        event: { minute: 11, corrected: true, correctionReason: 'Clock was misread.' },
      });
      const [audit] = await db
        .select()
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.entityId, match.matchId),
            eq(auditLogsTable.action, 'match.event.corrected'),
          ),
        );
      expect(audit?.action).toBe('match.event.corrected');

      const voided = await http(
        'POST',
        `/api/v1/matches/${match.matchId}/events/${eventId}/void`,
        { token: official.token, payload: { reason: 'Goal was disallowed.' } },
      );
      expect(voided.statusCode).toBe(200);
      expect(voided.json().data).toMatchObject({
        event: { voided: true, voidReason: 'Goal was disallowed.' },
        score: { homeScore: 0, awayScore: 0 },
      });

      const publicEvents = await http(
        'GET',
        `/api/v1/matches/${match.matchId}/events`,
      );
      expect(publicEvents.statusCode).toBe(200);
      expect(publicEvents.json().data).toHaveLength(0);

      const officialEvents = await http(
        'GET',
        `/api/v1/matches/${match.matchId}/events`,
        { token: official.token },
      );
      expect(officialEvents.statusCode).toBe(200);
      expect((officialEvents.json().data as Array<{ voided: boolean }>)[0]?.voided).toBe(true);

      const result = await http('GET', `/api/v1/matches/${match.matchId}/result`);
      expect(result.statusCode).toBe(200);
      expect(result.json().data).toMatchObject({
        derivedScore: { homeScore: 0, awayScore: 0 },
      });
    });
  });

  describe('results and reporting', () => {
    it('submits a full-time report, protects it from unauthorized users, and records corrections', async () => {
      const world = await buildWorld(2);
      const official = await createOfficial(world.competitionId);
      const match = await readyMatch(world);
      await assignOfficial(world.adminToken, match.matchId, official.userId);
      await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: official.token,
        payload: {},
      });

      const homePlayer = await addPlayer(world.teams[0]!.registrationId, world.seasonId);
      await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'goal',
          teamRegistrationId: world.teams[0]!.registrationId,
          playerRegistrationId: homePlayer,
          minute: 55,
        },
      });

      const earlyReport = await http('POST', `/api/v1/matches/${match.matchId}/report`, {
        token: official.token,
        payload: {},
      });
      expect(earlyReport.statusCode).toBe(409);

      await http('POST', `/api/v1/matches/${match.matchId}/half-time`, {
        token: official.token,
        payload: {},
      });
      await http('POST', `/api/v1/matches/${match.matchId}/second-half`, {
        token: official.token,
        payload: {},
      });
      await http('POST', `/api/v1/matches/${match.matchId}/end`, {
        token: official.token,
        payload: {},
      });

      const captainReport = await http('POST', `/api/v1/matches/${match.matchId}/report`, {
        token: world.teams[0]!.captainToken,
        payload: {},
      });
      expect(captainReport.statusCode).toBe(403);

      const report = await http('POST', `/api/v1/matches/${match.matchId}/report`, {
        token: official.token,
        payload: {},
      });
      expect(report.statusCode).toBe(200);
      expect(report.json().data).toMatchObject({
        score: { homeScore: 1, awayScore: 0 },
      });
      expect((report.json().data as { resultConfirmedAt: string | null }).resultConfirmedAt).not.toBeNull();

      const repeat = await http('POST', `/api/v1/matches/${match.matchId}/report`, {
        token: official.token,
        payload: {},
      });
      expect(repeat.statusCode).toBe(409);

      const officialCorrection = await http(
        'POST',
        `/api/v1/matches/${match.matchId}/result/correct`,
        { token: official.token, payload: { reason: 'Late correction.' } },
      );
      expect(officialCorrection.statusCode).toBe(403);

      const adminCorrection = await http(
        'POST',
        `/api/v1/matches/${match.matchId}/result/correct`,
        { token: world.adminToken, payload: { reason: 'Confirm after review.' } },
      );
      expect(adminCorrection.statusCode).toBe(200);
      expect(adminCorrection.json().data).toMatchObject({
        score: { homeScore: 1, awayScore: 0 },
      });

      const history = await http(
        'GET',
        `/api/v1/matches/${match.matchId}/result/history`,
        { token: world.adminToken },
      );
      expect(history.statusCode).toBe(200);
      const actions = (history.json().data as Array<{ action: string }>).map((row) => row.action);
      expect(actions).toContain('match.result.submitted');
      expect(actions).toContain('match.result.corrected');

      const result = await http('GET', `/api/v1/matches/${match.matchId}/result`);
      expect(result.statusCode).toBe(200);
      expect(result.json().data).toMatchObject({
        match: { status: 'full_time', homeScore: 1, awayScore: 0 },
        derivedScore: { homeScore: 1, awayScore: 0 },
      });
    });

    it('rejects events after full time and requires an administrator to correct a confirmed result', async () => {
      const world = await buildWorld(2);
      const official = await createOfficial(world.competitionId);
      const match = await readyMatch(world);
      await assignOfficial(world.adminToken, match.matchId, official.userId);
      await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: official.token,
        payload: {},
      });
      const homePlayer = await addPlayer(world.teams[0]!.registrationId, world.seasonId);
      const goal = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'goal',
          teamRegistrationId: world.teams[0]!.registrationId,
          playerRegistrationId: homePlayer,
          minute: 20,
        },
      });
      const eventId = (goal.json().data as { event: { id: string } }).event.id;

      await http('POST', `/api/v1/matches/${match.matchId}/half-time`, {
        token: official.token,
        payload: {},
      });
      await http('POST', `/api/v1/matches/${match.matchId}/second-half`, {
        token: official.token,
        payload: {},
      });
      await http('POST', `/api/v1/matches/${match.matchId}/end`, {
        token: official.token,
        payload: {},
      });
      const report = await http('POST', `/api/v1/matches/${match.matchId}/report`, {
        token: official.token,
        payload: {},
      });
      expect(report.statusCode).toBe(200);

      const lateEvent = await http('POST', `/api/v1/matches/${match.matchId}/events`, {
        token: official.token,
        payload: {
          clientEventId: randomUUID(),
          eventType: 'goal',
          teamRegistrationId: world.teams[0]!.registrationId,
          playerRegistrationId: homePlayer,
          minute: 90,
        },
      });
      expect(lateEvent.statusCode).toBe(409);

      const officialVoid = await http(
        'POST',
        `/api/v1/matches/${match.matchId}/events/${eventId}/void`,
        { token: official.token, payload: { reason: 'Disallowed.' } },
      );
      expect(officialVoid.statusCode).toBe(403);

      const adminVoid = await http(
        'POST',
        `/api/v1/matches/${match.matchId}/events/${eventId}/void`,
        { token: world.adminToken, payload: { reason: 'Disallowed after review.' } },
      );
      expect(adminVoid.statusCode).toBe(200);
      expect(adminVoid.json().data).toMatchObject({
        score: { homeScore: 0, awayScore: 0 },
        resultConfirmedAt: null,
      });

      const history = await http(
        'GET',
        `/api/v1/matches/${match.matchId}/result/history`,
        { token: world.adminToken },
      );
      expect(
        (history.json().data as Array<{ action: string }>).some(
          (row) => row.action === 'match.result.reopened',
        ),
      ).toBe(true);
    });
  });

  describe('websocket match updates', () => {
    interface WsClient {
      ws: {
        send: (data: string) => void;
        close: () => void;
        on: (event: string, listener: (...args: never[]) => void) => void;
      };
      next: () => Promise<{ type: string; [key: string]: unknown }>;
    }

    async function connectSocket(path: string, token: string): Promise<WsClient> {
      const queue: Array<{ type: string; [key: string]: unknown }> = [];
      const waiters: Array<(value: { type: string; [key: string]: unknown }) => void> = [];
      const ready = app.injectWS(
        path,
        { headers: { authorization: `Bearer ${token}` } },
        {
          onInit(ws: {
            on: (event: string, listener: (...args: never[]) => void) => void;
          }) {
            ws.on('message', ((raw: { toString: () => string }) => {
              const message = JSON.parse(raw.toString()) as { type: string };
              const waiter = waiters.shift();
              if (waiter) waiter(message);
              else queue.push(message);
            }) as never);
          },
        },
      );
      const ws = await ready;
      return {
        ws: ws as unknown as WsClient['ws'],
        next: () =>
          new Promise((resolvePromise) => {
            const queued = queue.shift();
            if (queued) resolvePromise(queued);
            else waiters.push(resolvePromise);
          }),
      };
    }

    it('broadcasts committed match updates to authorized subscribers', async () => {
      const world = await buildWorld(2);
      const match = await readyMatch(world);
      const watcherEmail = `${unique('watcher')}@example.test`;
      await register(watcherEmail);
      const watcherToken = await login(watcherEmail);
      const client = await connectSocket(`/ws/matches/${match.matchId}`, watcherToken);
      expect((await client.next()).type).toBe('connection.ready');

      const start = await http('POST', `/api/v1/matches/${match.matchId}/start`, {
        token: world.adminToken,
        payload: {},
      });
      expect(start.statusCode).toBe(200);

      const update = await client.next();
      expect(update.type).toBe('match.update');
      expect(update.reason).toBe('match.started');
      expect((update.match as { status: string }).status).toBe('first_half');
      client.ws.close();
    });
  });
}
