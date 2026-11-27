import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const databaseUrl = process.env.TEST_DATABASE_URL;
const PASSWORD = 'match-details-test-password';

if (databaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = 'match-details-test-secret-at-least-32-chars';
  process.env.JWT_ISSUER = 'touchline-api';
  process.env.JWT_AUDIENCE = 'touchline-client';
  process.env.ACCESS_TOKEN_TTL = '15m';
  process.env.REFRESH_TOKEN_DAYS = '30';
  process.env.COOKIE_SECURE = 'false';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.TRUST_PROXY = 'false';
}

if (!databaseUrl) {
  describe.skip('match venue and duration editing (requires TEST_DATABASE_URL)', () => {
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
    method: 'GET' | 'POST' | 'PATCH',
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
    });
  }

  async function register(email: string): Promise<string> {
    const response = await http('POST', '/api/v1/auth/register', {
      payload: { email, password: PASSWORD, displayName: 'Match Details Tester' },
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

  async function createSuperAdmin(): Promise<string> {
    const email = `${unique('super')}@example.test`;
    const userId = await register(email);
    const schema = await import('../src/database/schema/index.js');
    const { db } = await import('../src/database/client.js');
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'super_admin'));
    if (!role) throw new Error('Missing super_admin role');
    await db.insert(schema.userRoles).values({ userId, roleId: role.id });
    return login(email);
  }

  async function createWorld() {
    const adminToken = await createSuperAdmin();
    const created = await http('POST', '/api/v1/competitions', {
      token: adminToken,
      payload: { slug: unique('competition').toLowerCase(), name: unique('Competition'), visibility: 'public' },
    });
    expect(created.statusCode).toBe(201);
    const competitionId = (created.json().data as { id: string }).id;
    await http('POST', `/api/v1/competitions/${competitionId}/publish`, { token: adminToken });

    const season = await http('POST', `/api/v1/competitions/${competitionId}/seasons`, {
      token: adminToken,
      payload: { label: unique('Season') },
    });
    expect(season.statusCode).toBe(201);
    const seasonId = (season.json().data as { id: string }).id;

    const registrationIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const team = await http('POST', '/api/v1/teams', {
        token: adminToken,
        payload: { name: unique('Team'), seasonId },
      });
      expect(team.statusCode).toBe(201);
      const { registration } = team.json().data as { registration: { id: string } };
      const approved = await http('PATCH', `/api/v1/team-entries/${registration.id}`, {
        token: adminToken,
        payload: { status: 'approved' },
      });
      expect(approved.statusCode).toBe(200);
      registrationIds.push(registration.id);
    }

    const fixture = await http('POST', '/api/v1/fixtures', {
      token: adminToken,
      payload: {
        seasonId,
        homeTeamRegistrationId: registrationIds[0],
        awayTeamRegistrationId: registrationIds[1],
        round: 1,
        scheduledAt: new Date().toISOString(),
      },
    });
    expect(fixture.statusCode).toBe(201);
    const createdFixture = fixture.json().data as { fixture: { id: string }; match: { id: string } };
    const published = await http('POST', `/api/v1/fixtures/${createdFixture.fixture.id}/publish`, {
      token: adminToken,
    });
    expect(published.statusCode).toBe(200);
    return { adminToken, competitionId, seasonId, matchId: createdFixture.match.id };
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

  it('lets an administrator edit venue and duration independently and audits both', async () => {
    const world = await createWorld();

    const venue = await http('PATCH', `/api/v1/matches/${world.matchId}/venue`, {
      token: world.adminToken,
      payload: { venue: 'AFIT Main Pitch' },
    });
    expect(venue.statusCode).toBe(200);
    expect(venue.json().data).toEqual({ venue: 'AFIT Main Pitch' });

    const duration = await http('PATCH', `/api/v1/matches/${world.matchId}/duration`, {
      token: world.adminToken,
      payload: { durationMinutes: 80 },
    });
    expect(duration.statusCode).toBe(200);
    expect(duration.json().data).toEqual({ durationMinutes: 80 });

    const detail = await http('GET', `/api/v1/matches/${world.matchId}`);
    expect(detail.statusCode).toBe(200);
    const data = detail.json().data as {
      match: { durationMinutes: number; fixture: { venue: string | null } };
    };
    expect(data.match.durationMinutes).toBe(80);
    expect(data.match.fixture.venue).toBe('AFIT Main Pitch');

    const audits = await sql<{ action: string; before: { venue?: string; durationMinutes?: number }; after: { venue?: string; durationMinutes?: number } }[]>`
      SELECT action, before, after FROM audit_logs
      WHERE entity_id = ${world.matchId} AND action IN ('match.venue.updated', 'match.duration.updated')
      ORDER BY created_at
    `;
    expect(audits.map((row) => row.action)).toEqual(['match.venue.updated', 'match.duration.updated']);
    expect(audits[0]!.before.venue).toBeNull();
    expect(audits[0]!.after.venue).toBe('AFIT Main Pitch');
    expect(audits[1]!.before.durationMinutes).toBe(90);
    expect(audits[1]!.after.durationMinutes).toBe(80);
  });

  it('rejects invalid durations and oversized venues', async () => {
    const world = await createWorld();
    for (const durationMinutes of [0, 9, 121, 90.5]) {
      const response = await http('PATCH', `/api/v1/matches/${world.matchId}/duration`, {
        token: world.adminToken,
        payload: { durationMinutes },
      });
      expect(response.statusCode).toBe(400);
    }
    const venue = await http('PATCH', `/api/v1/matches/${world.matchId}/venue`, {
      token: world.adminToken,
      payload: { venue: 'x'.repeat(201) },
    });
    expect(venue.statusCode).toBe(400);
  });

  it('does not allow officials or anonymous callers to edit details', async () => {
    const world = await createWorld();
    const officialEmail = `${unique('official')}@example.test`;
    const officialId = await register(officialEmail);
    const { db } = await import('../src/database/client.js');
    const schema = await import('../src/database/schema/index.js');
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'match_official'));
    if (!role) throw new Error('Missing match_official role');
    await db.insert(schema.userRoles).values({
      userId: officialId,
      roleId: role.id,
      competitionId: world.competitionId,
    });
    const officialToken = await login(officialEmail);

    const asOfficial = await http('PATCH', `/api/v1/matches/${world.matchId}/duration`, {
      token: officialToken,
      payload: { durationMinutes: 80 },
    });
    expect(asOfficial.statusCode).toBe(403);

    const anonymous = await http('PATCH', `/api/v1/matches/${world.matchId}/venue`, {
      payload: { venue: 'Somewhere else' },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('locks details after kick-off and uses the configured duration for lifecycle minutes', async () => {
    const world = await createWorld();
    const changed = await http('PATCH', `/api/v1/matches/${world.matchId}/duration`, {
      token: world.adminToken,
      payload: { durationMinutes: 80 },
    });
    expect(changed.statusCode).toBe(200);

    const start = await http('POST', `/api/v1/matches/${world.matchId}/start`, {
      token: world.adminToken,
      payload: {},
    });
    expect(start.statusCode).toBe(200);

    const lateEdit = await http('PATCH', `/api/v1/matches/${world.matchId}/venue`, {
      token: world.adminToken,
      payload: { venue: 'Too late' },
    });
    expect(lateEdit.statusCode).toBe(409);

    const half = await http('POST', `/api/v1/matches/${world.matchId}/half-time`, {
      token: world.adminToken,
      payload: {},
    });
    expect(half.statusCode).toBe(200);
    expect((half.json().data as { match: { currentMinute: number } }).match.currentMinute).toBe(40);

    const second = await http('POST', `/api/v1/matches/${world.matchId}/second-half`, {
      token: world.adminToken,
      payload: {},
    });
    expect((second.json().data as { match: { currentMinute: number } }).match.currentMinute).toBe(41);

    const end = await http('POST', `/api/v1/matches/${world.matchId}/end`, {
      token: world.adminToken,
      payload: {},
    });
    expect((end.json().data as { match: { currentMinute: number } }).match.currentMinute).toBe(80);
  });
}
