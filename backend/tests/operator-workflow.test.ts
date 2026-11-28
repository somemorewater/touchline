import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const databaseUrl = process.env.TEST_DATABASE_URL;
const PASSWORD = 'operator-test-password';

if (databaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = 'operator-test-secret-at-least-32-chars';
  process.env.JWT_ISSUER = 'touchline-api';
  process.env.JWT_AUDIENCE = 'touchline-client';
  process.env.ACCESS_TOKEN_TTL = '15m';
  process.env.REFRESH_TOKEN_DAYS = '30';
  process.env.COOKIE_SECURE = 'false';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.TRUST_PROXY = 'false';
}

if (!databaseUrl) {
  describe.skip('match operator workflow (requires TEST_DATABASE_URL)', () => {
    it('is skipped without an isolated database', () => {
      expect(true).toBe(true);
    });
  });
} else {
  let app: FastifyInstance;
  let sql: (typeof import('../src/database/client.js'))['sql'];
  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${++counter}-${randomUUID().slice(0, 6)}`;

  function http(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    options: { token?: string; payload?: unknown } = {},
  ) {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    return app.inject({
      method,
      url,
      headers,
      payload: options.payload as object | undefined,
      remoteAddress: `10.0.${(counter >> 8) & 255}.${counter & 255}`,
    });
  }

  async function login(email: string): Promise<string> {
    const response = await http('POST', '/api/v1/auth/login', {
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return (response.json().data as { accessToken: string }).accessToken;
  }

  async function createUserWithRole(
    email: string,
    roleName: string,
    competitionId: string | null,
  ) {
    const { db } = await import('../src/database/client.js');
    const schema = await import('../src/database/schema/index.js');
    const { hashPassword } = await import('../src/security/passwords.js');
    const [user] = await db.insert(schema.users).values({
      email, passwordHash: await hashPassword(PASSWORD), displayName: 'Operator Tester',
    }).returning({ id: schema.users.id });
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, roleName));
    if (!role) throw new Error(`Missing role ${roleName}`);
    await db.insert(schema.userRoles).values({
      userId: user!.id, roleId: role.id, competitionId,
    });
    return { id: user!.id, token: await login(email) };
  }

  async function createWorld() {
    const admin = await createUserWithRole(`${unique('admin')}@example.test`, 'super_admin', null);
    const created = await http('POST', '/api/v1/competitions', {
      token: admin.token,
      payload: { slug: unique('comp').toLowerCase(), name: unique('Competition'), visibility: 'public' },
    });
    expect(created.statusCode).toBe(201);
    const competitionId = (created.json().data as { id: string }).id;
    await http('POST', `/api/v1/competitions/${competitionId}/publish`, { token: admin.token, payload: {} });

    const other = await http('POST', '/api/v1/competitions', {
      token: admin.token,
      payload: { slug: unique('other').toLowerCase(), name: unique('Other Competition'), visibility: 'public' },
    });
    const otherCompetitionId = (other.json().data as { id: string }).id;

    const season = await http('POST', `/api/v1/competitions/${competitionId}/seasons`, {
      token: admin.token, payload: { label: unique('Season') },
    });
    const seasonId = (season.json().data as { id: string }).id;

    const registrationIds: string[] = [];
    for (const name of ['Operators United', 'Operators City']) {
      const team = await http('POST', '/api/v1/teams', {
        token: admin.token, payload: { name, seasonId },
      });
      const { registration } = team.json().data as { registration: { id: string } };
      await http('PATCH', `/api/v1/team-entries/${registration.id}`, {
        token: admin.token, payload: { status: 'approved' },
      });
      registrationIds.push(registration.id);
    }
    const { db } = await import('../src/database/client.js');
    const schema = await import('../src/database/schema/index.js');
    const [player] = await db.insert(schema.players).values({ fullName: unique('Home Scorer') }).returning({ id: schema.players.id });
    const [playerRegistration] = await db.insert(schema.playerRegistrations).values({
      playerId: player!.id,
      teamRegistrationId: registrationIds[0]!,
      seasonId,
      shirtNumber: 10,
      status: 'approved',
      eligibilityApproved: true,
    }).returning({ id: schema.playerRegistrations.id });
    const [awayPlayer] = await db.insert(schema.players).values({ fullName: unique('Away Scorer') }).returning({ id: schema.players.id });
    const [awayRegistration] = await db.insert(schema.playerRegistrations).values({
      playerId: awayPlayer!.id,
      teamRegistrationId: registrationIds[1]!,
      seasonId,
      shirtNumber: 9,
      status: 'approved',
      eligibilityApproved: true,
    }).returning({ id: schema.playerRegistrations.id });

    const fixture = await http('POST', '/api/v1/fixtures', {
      token: admin.token,
      payload: {
        seasonId,
        homeTeamRegistrationId: registrationIds[0],
        awayTeamRegistrationId: registrationIds[1],
        round: 1,
        scheduledAt: new Date().toISOString(),
      },
    });
    const data = fixture.json().data as { fixture: { id: string }; match: { id: string } };
    await http('POST', `/api/v1/fixtures/${data.fixture.id}/publish`, { token: admin.token, payload: {} });
    return {
      admin, competitionId, otherCompetitionId, seasonId,
      matchId: data.match.id, registrationIds,
      playerRegistrationId: playerRegistration!.id,
      awayPlayerRegistrationId: awayRegistration!.id,
    };
  }

  beforeAll(async () => {
    const client = await import('../src/database/client.js');
    sql = client.sql;
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(client.db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
    const { seedSecurity } = await import('../src/database/seed/security.js');
    await seedSecurity();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE users, competitions, teams, players, audit_logs RESTART IDENTITY CASCADE`;
  });

  it('lets a scoped competition admin assign the operator role but blocks escalation and cross-scope grants', async () => {
    const world = await createWorld();
    const competitionAdmin = await createUserWithRole(
      `${unique('scoped-admin')}@example.test`, 'competition_admin', world.competitionId,
    );
    const { db } = await import('../src/database/client.js');
    const schema = await import('../src/database/schema/index.js');
    const { hashPassword } = await import('../src/security/passwords.js');
    const [target] = await db.insert(schema.users).values({
      email: `${unique('target')}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      displayName: 'Grant Target',
    }).returning({ id: schema.users.id });

    const allowed = await http('POST', `/api/v1/users/${target!.id}/roles`, {
      token: competitionAdmin.token,
      payload: { role: 'commentary_operator', competitionId: world.competitionId },
    });
    expect(allowed.statusCode).toBe(201);

    const adminRole = await http('POST', `/api/v1/users/${target!.id}/roles`, {
      token: competitionAdmin.token,
      payload: { role: 'competition_admin', competitionId: world.competitionId },
    });
    expect(adminRole.statusCode).toBe(403);

    const globalRole = await http('POST', `/api/v1/users/${target!.id}/roles`, {
      token: competitionAdmin.token,
      payload: { role: 'match_official' },
    });
    expect(globalRole.statusCode).toBe(403);

    const crossScope = await http('POST', `/api/v1/users/${target!.id}/roles`, {
      token: competitionAdmin.token,
      payload: { role: 'match_official', competitionId: world.otherCompetitionId },
    });
    expect(crossScope.statusCode).toBe(403);
  });

  it('gives an assigned operator full live control and editorial access', async () => {
    const world = await createWorld();
    const operator = await createUserWithRole(
      `${unique('operator')}@example.test`, 'commentary_operator', world.competitionId,
    );
    const assigned = await http('POST', `/api/v1/matches/${world.matchId}/officials`, {
      token: world.admin.token,
      payload: { userId: operator.id, role: 'commentary' },
    });
    expect(assigned.statusCode).toBe(201);

    const mine = await http('GET', '/api/v1/officials/me/matches', { token: operator.token });
    expect(mine.statusCode).toBe(200);
    expect((mine.json().data as { matchId: string }[]).some((m) => m.matchId === world.matchId)).toBe(true);

    const start = await http('POST', `/api/v1/matches/${world.matchId}/start`, { token: operator.token, payload: {} });
    expect(start.statusCode).toBe(200);

    const clientEventId = randomUUID();
    const goal = await http('POST', `/api/v1/matches/${world.matchId}/events`, {
      token: operator.token,
      payload: {
        clientEventId, eventType: 'goal', teamRegistrationId: world.registrationIds[0],
        playerRegistrationId: world.playerRegistrationId,
        minute: 12, description: 'Opening goal',
      },
    });
    expect(goal.statusCode).toBe(201);
    const eventId = (goal.json().data as { event: { id: string } }).event.id;

    const result = await http('GET', `/api/v1/matches/${world.matchId}/result`, { token: operator.token });
    expect((result.json().data as { derivedScore: { homeScore: number } }).derivedScore.homeScore).toBe(1);
    const publicResult = await http('GET', `/api/v1/matches/${world.matchId}/result`);
    expect(publicResult.statusCode).toBe(200);

    const corrected = await http('PATCH', `/api/v1/matches/${world.matchId}/events/${eventId}`, {
      token: operator.token,
      payload: { minute: 14, reason: 'Minute corrected' },
    });
    expect(corrected.statusCode).toBe(200);

    const voided = await http('POST', `/api/v1/matches/${world.matchId}/events/${eventId}/void`, {
      token: operator.token, payload: { reason: 'Recorded in error' },
    });
    expect(voided.statusCode).toBe(200);
    const afterVoid = await http('GET', `/api/v1/matches/${world.matchId}/result`, { token: operator.token });
    expect((afterVoid.json().data as { derivedScore: { homeScore: number } }).derivedScore.homeScore).toBe(0);

    const commentary = await http('POST', `/api/v1/matches/${world.matchId}/commentary`, {
      token: operator.token,
      payload: { kind: 'commentary', body: 'A bright start', minute: 3 },
    });
    expect(commentary.statusCode).toBe(201);
    const entryId = (commentary.json().data as { id: string }).id;

    const edited = await http('PATCH', `/api/v1/matches/${world.matchId}/commentary/${entryId}`, {
      token: operator.token, payload: { body: 'A bright start with chances' },
    });
    expect(edited.statusCode).toBe(200);

    const overview = await http('PUT', `/api/v1/matches/${world.matchId}/overview`, {
      token: operator.token,
      payload: {
        introduction: 'A local derby', preMatchNotes: null,
        liveSummary: 'End to end', narrative: null,
      },
    });
    expect(overview.statusCode).toBe(200);

    const publicCommentary = await http('GET', `/api/v1/matches/${world.matchId}/commentary`);
    expect((publicCommentary.json().data as { body: string }[])[0]?.body).toBe('A bright start with chances');
    const publicOverview = await http('GET', `/api/v1/matches/${world.matchId}/overview`);
    expect((publicOverview.json().data as { introduction: string }).introduction).toBe('A local derby');
  });

  it('denies unassigned and non-operator users', async () => {
    const world = await createWorld();
    const unassigned = await createUserWithRole(
      `${unique('unassigned')}@example.test`, 'commentary_operator', world.competitionId,
    );

    const clock = await http('PATCH', `/api/v1/matches/${world.matchId}/clock`, {
      token: unassigned.token, payload: { minute: 20 },
    });
    expect(clock.statusCode).toBe(403);

    const venue = await http('PATCH', `/api/v1/matches/${world.matchId}/venue`, {
      token: unassigned.token, payload: { venue: 'Not allowed' },
    });
    expect(venue.statusCode).toBe(403);

    const comment = await http('POST', `/api/v1/matches/${world.matchId}/commentary`, {
      token: unassigned.token, payload: { body: 'Nope' },
    });
    expect(comment.statusCode).toBe(403);

    const users = await http('GET', '/api/v1/users', { token: unassigned.token });
    expect(users.statusCode).toBe(403);
  });

  it('creates a match with personnel atomically, replaces and removes assignments', async () => {
    const world = await createWorld();
    const official = await createUserWithRole(
      `${unique('create-official')}@example.test`, 'match_official', world.competitionId,
    );
    const operator = await createUserWithRole(
      `${unique('create-operator')}@example.test`, 'commentary_operator', world.competitionId,
    );
    const replacement = await createUserWithRole(
      `${unique('replace-official')}@example.test`, 'match_official', world.competitionId,
    );
    const foreigner = await createUserWithRole(
      `${unique('foreign-official')}@example.test`, 'match_official', world.otherCompetitionId,
    );

    const created = await http('POST', '/api/v1/fixtures', {
      token: world.admin.token,
      payload: {
        seasonId: world.seasonId,
        homeTeamRegistrationId: world.registrationIds[0],
        awayTeamRegistrationId: world.registrationIds[1],
        round: 11,
        officialUserId: official.id,
        commentaryUserId: operator.id,
      },
    });
    expect(created.statusCode).toBe(201);
    const data = created.json().data as {
      match: { id: string };
      official: { userId: string; role: string };
      commentary: { userId: string; role: string };
    };
    expect(data.official).toMatchObject({ userId: official.id, role: 'official' });
    expect(data.commentary).toMatchObject({ userId: operator.id, role: 'commentary' });

    const personnel = await http('GET', `/api/v1/matches/${data.match.id}/officials`, { token: world.admin.token });
    expect((personnel.json().data as { userId: string; role: string }[]).map((row) => [row.userId, row.role]))
      .toEqual(expect.arrayContaining([[official.id, 'official'], [operator.id, 'commentary']]));

    const operatorAccess = await http('POST', `/api/v1/matches/${data.match.id}/commentary`, {
      token: operator.token, payload: { body: 'Hello from the operator' },
    });
    expect(operatorAccess.statusCode).toBe(201);

    const beforeBad = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM fixtures`;
    const crossScope = await http('POST', '/api/v1/fixtures', {
      token: world.admin.token,
      payload: {
        seasonId: world.seasonId,
        homeTeamRegistrationId: world.registrationIds[0],
        awayTeamRegistrationId: world.registrationIds[1],
        round: 12,
        officialUserId: foreigner.id,
      },
    });
    expect(crossScope.statusCode).toBe(400);
    const afterBad = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM fixtures`;
    expect(afterBad[0]!.count).toBe(beforeBad[0]!.count);

    const empty = await http('POST', '/api/v1/fixtures', {
      token: world.admin.token,
      payload: {
        seasonId: world.seasonId,
        homeTeamRegistrationId: world.registrationIds[0],
        awayTeamRegistrationId: world.registrationIds[1],
        round: 13,
      },
    });
    expect(empty.statusCode).toBe(201);
    expect((empty.json().data as { official: unknown; commentary: unknown }).official).toBeNull();

    const replaced = await http('PUT', `/api/v1/matches/${data.match.id}/personnel/official`, {
      token: world.admin.token, payload: { userId: replacement.id },
    });
    expect(replaced.statusCode).toBe(200);
    const afterReplace = await http('GET', `/api/v1/matches/${data.match.id}/officials`, { token: world.admin.token });
    const rows = afterReplace.json().data as { userId: string; role: string }[];
    expect(rows.find((row) => row.role === 'official')?.userId).toBe(replacement.id);
    expect(rows.some((row) => row.userId === official.id)).toBe(false);

    const removed = await http('DELETE', `/api/v1/matches/${data.match.id}/officials/${operator.id}`, {
      token: world.admin.token,
    });
    expect(removed.statusCode).toBe(200);
    const revoked = await http('POST', `/api/v1/matches/${data.match.id}/commentary`, {
      token: operator.token, payload: { body: 'Should be rejected' },
    });
    expect([403, 404]).toContain(revoked.statusCode);
  });

  it('serves match players by team and keeps a server-authoritative running clock', async () => {
    const world = await createWorld();
    const operator = await createUserWithRole(
      `${unique('clock-operator')}@example.test`, 'commentary_operator', world.competitionId,
    );
    const assigned = await http('POST', `/api/v1/matches/${world.matchId}/officials`, {
      token: world.admin.token,
      payload: { userId: operator.id, role: 'commentary' },
    });
    expect(assigned.statusCode).toBe(201);

    const squad = await http('GET', `/api/v1/matches/${world.matchId}/squad`, { token: operator.token });
    expect(squad.statusCode).toBe(200);
    const squadData = squad.json().data as {
      homeRegistrationId: string;
      awayRegistrationId: string;
      players: { registrationId: string; teamRegistrationId: string; fullName: string; shirtNumber: number | null }[];
    };
    expect(squadData.players).toHaveLength(2);
    expect(squadData.players.find((p) => p.registrationId === world.playerRegistrationId))
      .toMatchObject({ teamRegistrationId: squadData.homeRegistrationId, shirtNumber: 10 });
    expect(squadData.players.find((p) => p.registrationId === world.awayPlayerRegistrationId))
      .toMatchObject({ teamRegistrationId: squadData.awayRegistrationId, shirtNumber: 9 });

    const start = await http('POST', `/api/v1/matches/${world.matchId}/start`, { token: operator.token, payload: {} });
    expect(start.statusCode).toBe(200);
    const startedMatch = (start.json().data as { match: { clockRunningAt: string | null; clockAccumulatedSeconds: number } }).match;
    expect(startedMatch.clockRunningAt).not.toBeNull();
    expect(startedMatch.clockAccumulatedSeconds).toBe(0);

    const corrected = await http('PATCH', `/api/v1/matches/${world.matchId}/clock`, {
      token: operator.token, payload: { minute: 10, addedMinutes: null },
    });
    expect(corrected.statusCode).toBe(200);
    const correctedMatch = corrected.json().data as { clockAccumulatedSeconds: number };
    expect(correctedMatch.clockAccumulatedSeconds).toBe(600);

    const half = await http('POST', `/api/v1/matches/${world.matchId}/half-time`, { token: operator.token, payload: {} });
    expect(half.statusCode).toBe(200);
    const halfMatch = (half.json().data as { match: { clockRunningAt: string | null; clockAccumulatedSeconds: number } }).match;
    expect(halfMatch.clockRunningAt).toBeNull();
    expect(halfMatch.clockAccumulatedSeconds).toBeGreaterThanOrEqual(600);

    const second = await http('POST', `/api/v1/matches/${world.matchId}/second-half`, { token: operator.token, payload: {} });
    expect(second.statusCode).toBe(200);
    const secondMatch = (second.json().data as { match: { clockRunningAt: string | null; clockAccumulatedSeconds: number } }).match;
    expect(secondMatch.clockRunningAt).not.toBeNull();
    expect(secondMatch.clockAccumulatedSeconds).toBe(halfMatch.clockAccumulatedSeconds);

    const ownGoal = await http('POST', `/api/v1/matches/${world.matchId}/events`, {
      token: operator.token,
      payload: {
        clientEventId: randomUUID(), eventType: 'own-goal',
        teamRegistrationId: world.registrationIds[1],
        playerRegistrationId: world.awayPlayerRegistrationId,
        minute: 20,
      },
    });
    expect(ownGoal.statusCode).toBe(201);
    const result = await http('GET', `/api/v1/matches/${world.matchId}/result`, { token: operator.token });
    expect((result.json().data as { derivedScore: { homeScore: number; awayScore: number } }).derivedScore)
      .toEqual({ homeScore: 1, awayScore: 0 });

    const end = await http('POST', `/api/v1/matches/${world.matchId}/end`, { token: operator.token, payload: {} });
    expect(end.statusCode).toBe(200);
    const endedMatch = (end.json().data as { match: { clockRunningAt: string | null; clockAccumulatedSeconds: number } }).match;
    expect(endedMatch.clockRunningAt).toBeNull();
    expect(endedMatch.clockAccumulatedSeconds).toBe(90 * 60);
  });
}
