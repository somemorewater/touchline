import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  announcements,
  competitions,
  fixtures,
  lineups,
  matchOfficials,
  matches,
  playerRegistrations,
  players,
  roles,
  seasons,
  sessions,
  teamRegistrations,
  teams,
  userRoles,
} from '../src/database/schema/index.js';
import { PERMISSIONS, ROLES } from '../src/security/permissions.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (databaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = 'security-test-secret-with-at-least-32-chars';
  process.env.JWT_ISSUER = 'touchline-api';
  process.env.JWT_AUDIENCE = 'touchline-client';
  process.env.ACCESS_TOKEN_TTL = '15m';
  process.env.REFRESH_TOKEN_DAYS = '30';
  process.env.REFRESH_REUSE_GRACE_SECONDS = '2';
  process.env.COOKIE_SECURE = 'false';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.TRUST_PROXY = 'false';
}

const PASSWORD = 'security-test-password';

if (!databaseUrl) {
  describe.skip('security regression (requires TEST_DATABASE_URL)', () => {
    it('is skipped without an isolated database', () => {
      expect(true).toBe(true);
    });
  });
} else {
  type Db = (typeof import('../src/database/client.js'))['db'];
  type Sql = (typeof import('../src/database/client.js'))['sql'];
  type AuthModule = typeof import('../src/modules/auth/service.js');
  type AccessModule = typeof import('../src/security/access.js');
  type ServiceModule = typeof import('../src/security/service.js');

  let app: FastifyInstance;
  let db: Db;
  let sql: Sql;
  let access: AccessModule;
  let services: ServiceModule;
  let authModule: AuthModule;

  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${++counter}`;
  const nextIp = () => `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;

  interface HttpOptions {
    token?: string;
    cookies?: Record<string, string>;
    payload?: unknown;
    headers?: Record<string, string>;
  }

  function http(method: 'GET' | 'POST', url: string, options: HttpOptions = {}) {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.cookies) {
      headers.cookie = Object.entries(options.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    }
    return app.inject({
      method,
      url,
      headers,
      payload: options.payload as string | object | undefined,
      remoteAddress: nextIp(),
    });
  }

  function cookiesOf(response: Awaited<ReturnType<typeof http>>): Record<string, string> {
    const list = (response as unknown as { cookies: Array<{ name: string; value: string }> }).cookies;
    return Object.fromEntries(list.map((cookie) => [cookie.name, cookie.value]));
  }

  async function register(email: string): Promise<{ id: string }> {
    const response = await http('POST', '/api/v1/auth/register', {
      payload: { email, password: PASSWORD, displayName: 'Security Test' },
    });
    expect(response.statusCode).toBe(201);
    return response.json().data as { id: string };
  }

  async function grantRole(
    userId: string,
    roleName: string,
    competitionId: string | null = null,
  ): Promise<void> {
    const [role] = await db.select().from(roles).where(eq(roles.name, roleName));
    if (!role) throw new Error(`Missing seeded role ${roleName}`);
    await db.insert(userRoles).values({ userId, roleId: role.id, competitionId });
  }

  interface Session {
    userId: string;
    sid: string;
    accessToken: string;
    accessCookie: string;
    refreshToken: string;
  }

  async function login(email: string): Promise<Session> {
    const response = await http('POST', '/api/v1/auth/login', {
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data as { accessToken: string };
    const cookies = cookiesOf(response);
    const claims = app.jwt.verify<{ sub: string; sid: string }>(body.accessToken);
    return {
      userId: claims.sub,
      sid: claims.sid,
      accessToken: body.accessToken,
      accessCookie: cookies.access_token ?? '',
      refreshToken: cookies.refresh_token ?? '',
    };
  }

  async function createUser(options: {
    role?: string;
    competitionId?: string | null;
    email?: string;
  } = {}) {
    const email = options.email ?? `${unique('user')}@example.test`;
    const registered = await register(email);
    if (options.role && options.role !== ROLES.registeredUser) {
      await grantRole(registered.id, options.role, options.competitionId ?? null);
    }
    const session = await login(email);
    return { ...session, email };
  }

  async function contextFor(token: string) {
    const claims = app.jwt.verify<{ sub: string; sid: string }>(token);
    const context = await services.loadAuthContext(claims.sub, claims.sid);
    if (!context) throw new Error('Expected an authenticated context');
    return context;
  }

  async function insertCompetition(
    status = 'published',
    visibility = 'public',
  ): Promise<string> {
    const [row] = await db
      .insert(competitions)
      .values({ slug: unique('competition'), name: unique('Competition'), status, visibility })
      .returning({ id: competitions.id });
    return row!.id;
  }

  async function insertSeason(competitionId: string): Promise<string> {
    const [row] = await db
      .insert(seasons)
      .values({ competitionId, label: unique('Season') })
      .returning({ id: seasons.id });
    return row!.id;
  }

  async function insertTeam(): Promise<string> {
    const [row] = await db
      .insert(teams)
      .values({ name: unique('Team') })
      .returning({ id: teams.id });
    return row!.id;
  }

  async function insertRegistration(
    teamId: string,
    seasonId: string,
    captainUserId: string | null = null,
  ): Promise<string> {
    const [row] = await db
      .insert(teamRegistrations)
      .values({ teamId, seasonId, captainUserId, status: 'approved' })
      .returning({ id: teamRegistrations.id });
    return row!.id;
  }

  async function insertFixture(
    seasonId: string,
    homeTeamRegistrationId: string,
    awayTeamRegistrationId: string,
    publishedAt: Date | null,
  ): Promise<string> {
    const [row] = await db
      .insert(fixtures)
      .values({
        seasonId,
        homeTeamRegistrationId,
        awayTeamRegistrationId,
        publishedAt,
        scheduledAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: fixtures.id });
    return row!.id;
  }

  async function insertMatch(fixtureId: string): Promise<string> {
    const [row] = await db
      .insert(matches)
      .values({ fixtureId })
      .returning({ id: matches.id });
    return row!.id;
  }

  async function insertLineup(
    matchId: string,
    teamRegistrationId: string,
    status: string,
  ): Promise<string> {
    const [row] = await db
      .insert(lineups)
      .values({ matchId, teamRegistrationId, status })
      .returning({ id: lineups.id });
    return row!.id;
  }

  async function insertAnnouncement(
    competitionId: string | null,
    audience: string,
    title: string,
  ): Promise<string> {
    const [row] = await db
      .insert(announcements)
      .values({
        competitionId,
        audience,
        title,
        body: title,
        publishedAt: new Date(Date.now() - 60_000),
      })
      .returning({ id: announcements.id });
    return row!.id;
  }

  interface WsClient {
    ws: {
      send: (data: string) => void;
      close: () => void;
      on: (event: string, listener: (...args: never[]) => void) => void;
    };
    next: () => Promise<{ type: string; [key: string]: unknown }>;
    closed: () => Promise<{ code: number; reason: string }>;
  }

  async function connectSocket(
    path: string,
    token?: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<WsClient> {
    const queue: Array<{ type: string; [key: string]: unknown }> = [];
    const waiters: Array<(value: { type: string; [key: string]: unknown }) => void> = [];
    let closeInfo: { code: number; reason: string } | null = null;
    let closeResolve: ((value: { code: number; reason: string }) => void) | null = null;

    const headers: Record<string, string> = { ...extraHeaders };
    if (token) headers.authorization = `Bearer ${token}`;

    const ready = app.injectWS(
      path,
      Object.keys(headers).length > 0 ? { headers } : {},
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
          ws.on('close', ((code: number, reason: { toString: () => string }) => {
            closeInfo = { code, reason: reason.toString() };
            closeResolve?.(closeInfo);
          }) as never);
        },
      },
    );

    const ws = await ready;
    return {
      ws: ws as unknown as WsClient['ws'],
      next: () =>
        new Promise((resolveNext, rejectNext) => {
          const queued = queue.shift();
          if (queued) return resolveNext(queued);
          const timer = setTimeout(
            () => rejectNext(new Error('Timed out waiting for a WebSocket message')),
            3_000,
          );
          waiters.push((message) => {
            clearTimeout(timer);
            resolveNext(message);
          });
        }),
      closed: () =>
        closeInfo
          ? Promise.resolve(closeInfo)
          : new Promise((resolveClose) => {
              closeResolve = resolveClose;
            }),
    };
  }

  beforeAll(async () => {
    const client = await import('../src/database/client.js');
    db = client.db;
    sql = client.sql;

    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
    const { seedSecurity } = await import('../src/database/seed/security.js');
    await seedSecurity();

    services = await import('../src/security/service.js');
    access = await import('../src/security/access.js');
    authModule = await import('../src/modules/auth/service.js');

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE users, competitions, teams RESTART IDENTITY CASCADE`;
  });

  describe('central authentication', () => {
    it('rejects anonymous, missing and invalid credentials', async () => {
      const anonymous = await http('GET', '/api/v1/auth/me');
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().error.code).toBe('UNAUTHENTICATED');

      const invalid = await http('GET', '/api/v1/auth/me', { token: 'not-a-token' });
      expect(invalid.statusCode).toBe(401);
      expect(invalid.json().error.code).toBe('UNAUTHENTICATED');

      const logoutAll = await http('POST', '/api/v1/auth/logout-all');
      expect(logoutAll.statusCode).toBe(401);
    });

    it('rejects tokens signed for another issuer or audience', async () => {
      const user = await createUser();
      const wrongIssuer = app.jwt.sign(
        { sub: user.userId, sid: user.sid, email: user.email },
        { iss: 'other-api', expiresIn: '15m' },
      );
      const issuerResponse = await http('GET', '/api/v1/auth/me', { token: wrongIssuer });
      expect(issuerResponse.statusCode).toBe(401);

      const wrongAudience = app.jwt.sign(
        { sub: user.userId, sid: user.sid, email: user.email },
        { aud: 'other-client', expiresIn: '15m' },
      );
      const audienceResponse = await http('GET', '/api/v1/auth/me', { token: wrongAudience });
      expect(audienceResponse.statusCode).toBe(401);

      const missingSession = app.jwt.sign(
        { sub: user.userId, email: user.email },
        { expiresIn: '15m' },
      );
      const missingResponse = await http('GET', '/api/v1/auth/me', { token: missingSession });
      expect(missingResponse.statusCode).toBe(401);
    });

    it('rejects expired access tokens', async () => {
      const user = await createUser();
      const expired = app.jwt.sign(
        {
          sub: user.userId,
          sid: user.sid,
          email: user.email,
          exp: Math.floor(Date.now() / 1000) - 60,
        },
        { noTimestamp: true },
      );
      const response = await http('GET', '/api/v1/auth/me', { token: expired });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects inactive accounts and does not restore revoked sessions on reactivation', async () => {
      const user = await createUser();
      const service = new authModule.AuthService(app);
      await service.setUserActive(user.userId, false);

      const inactive = await http('GET', '/api/v1/auth/me', { token: user.accessToken });
      expect(inactive.statusCode).toBe(401);

      await service.setUserActive(user.userId, true);
      const stillRevoked = await http('GET', '/api/v1/auth/me', { token: user.accessToken });
      expect(stillRevoked.statusCode).toBe(401);

      const relogin = await login(user.email);
      const fresh = await http('GET', '/api/v1/auth/me', { token: relogin.accessToken });
      expect(fresh.statusCode).toBe(200);
    });

    it('does not trust client-supplied roles during registration', async () => {
      const email = `${unique('escalation')}@example.test`;
      const response = await http('POST', '/api/v1/auth/register', {
        payload: {
          email,
          password: PASSWORD,
          displayName: 'Escalation Attempt',
          role: 'super_admin',
        },
      });
      expect(response.statusCode).toBe(400);

      const user = await createUser({ email });
      const me = await http('GET', '/api/v1/auth/me', { token: user.accessToken });
      expect(me.statusCode).toBe(200);
      const body = me.json().data as {
        roles: Array<{ role: string }>;
        permissions: string[];
      };
      expect(body.roles.some((assignment) => assignment.role === ROLES.superAdmin)).toBe(false);
      expect(body.permissions).not.toContain(PERMISSIONS.rolesManage);
    });
  });

  describe('session lifecycle and revocation', () => {
    it('revokes the current session immediately on logout', async () => {
      const user = await createUser();
      const before = await http('GET', '/api/v1/auth/me', { token: user.accessToken });
      expect(before.statusCode).toBe(200);

      const logout = await http('POST', '/api/v1/auth/logout', {
        token: user.accessToken,
        cookies: { refresh_token: user.refreshToken },
      });
      expect(logout.statusCode).toBe(200);

      const after = await http('GET', '/api/v1/auth/me', { token: user.accessToken });
      expect(after.statusCode).toBe(401);

      const refresh = await http('POST', '/api/v1/auth/refresh', {
        cookies: { refresh_token: user.refreshToken },
      });
      expect(refresh.statusCode).toBe(401);
    });

    it('logout-all revokes every session for the user', async () => {
      const user = await createUser();
      const second = await login(user.email);

      const firstCheck = await http('GET', '/api/v1/auth/me', { token: user.accessToken });
      const secondCheck = await http('GET', '/api/v1/auth/me', { token: second.accessToken });
      expect(firstCheck.statusCode).toBe(200);
      expect(secondCheck.statusCode).toBe(200);

      const logoutAll = await http('POST', '/api/v1/auth/logout-all', {
        token: user.accessToken,
      });
      expect(logoutAll.statusCode).toBe(200);

      for (const session of [user, second]) {
        const check = await http('GET', '/api/v1/auth/me', { token: session.accessToken });
        expect(check.statusCode).toBe(401);
        const refresh = await http('POST', '/api/v1/auth/refresh', {
          cookies: { refresh_token: session.refreshToken },
        });
        expect(refresh.statusCode).toBe(401);
      }
    });

    it('rotates refresh tokens, rejects concurrent losers and detects reuse', async () => {
      const user = await createUser();
      const original = user.refreshToken;

      const [first, second] = await Promise.all([
        http('POST', '/api/v1/auth/refresh', { cookies: { refresh_token: original } }),
        http('POST', '/api/v1/auth/refresh', { cookies: { refresh_token: original } }),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();
      expect(statuses).toEqual([200, 401]);

      const winner = first.statusCode === 200 ? first : second;
      const loser = winner === first ? second : first;
      expect(loser.json().error.code).toBe('REFRESH_TOKEN_ROTATED');

      const winnerData = winner.json().data as { accessToken: string };
      const winnerRefresh = cookiesOf(winner).refresh_token;
      expect(winnerRefresh).toBeTruthy();

      const activeTokens = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM refresh_tokens
        WHERE family_id = ${user.sid} AND revoked_at IS NULL
      `;
      expect(activeTokens[0]?.count).toBe(1);

      const healthy = await http('GET', '/api/v1/auth/me', {
        token: winnerData.accessToken,
      });
      expect(healthy.statusCode).toBe(200);

      const originalHash = createHash('sha256').update(original).digest('hex');
      await sql`UPDATE refresh_tokens SET revoked_at = now() - interval '1 hour' WHERE token_hash = ${originalHash}`;

      const reuse = await http('POST', '/api/v1/auth/refresh', {
        cookies: { refresh_token: original },
      });
      expect(reuse.statusCode).toBe(401);
      expect(reuse.json().error.code).toBe('REFRESH_REUSE_DETECTED');

      const afterReuse = await http('GET', '/api/v1/auth/me', {
        token: winnerData.accessToken,
      });
      expect(afterReuse.statusCode).toBe(401);

      const rotatedAfterReuse = await http('POST', '/api/v1/auth/refresh', {
        cookies: { refresh_token: winnerRefresh },
      });
      expect(rotatedAfterReuse.statusCode).toBe(401);
    });
  });

  describe('public and private resource visibility', () => {
    interface VisibilityFixture {
      publicCompetitionId: string;
      publicSeasonId: string;
      publicMatchId: string;
      publicLineupId: string;
      privateCompetitionId: string;
      privateSeasonId: string;
      privateMatchId: string;
      privateLineupId: string;
      privateFixtureId: string;
      publicAnnouncementId: string;
      publicAdminAnnouncementId: string;
      privateAnnouncementId: string;
      privateAdminAnnouncementId: string;
      homeRegistrationId: string;
      awayRegistrationId: string;
    }

    async function buildVisibilityFixture(): Promise<VisibilityFixture> {
      const publicCompetitionId = await insertCompetition('published', 'public');
      const publicSeasonId = await insertSeason(publicCompetitionId);
      const publicHomeTeam = await insertTeam();
      const publicAwayTeam = await insertTeam();
      const publicHomeRegistration = await insertRegistration(publicHomeTeam, publicSeasonId);
      const publicAwayRegistration = await insertRegistration(publicAwayTeam, publicSeasonId);
      const publicFixtureId = await insertFixture(
        publicSeasonId,
        publicHomeRegistration,
        publicAwayRegistration,
        new Date(Date.now() - 60_000),
      );
      const publicMatchId = await insertMatch(publicFixtureId);
      const publicLineupId = await insertLineup(publicMatchId, publicHomeRegistration, 'published');
      await insertLineup(publicMatchId, publicAwayRegistration, 'draft');

      const privateCompetitionId = await insertCompetition('draft', 'public');
      const privateSeasonId = await insertSeason(privateCompetitionId);
      const privateHomeTeam = await insertTeam();
      const privateAwayTeam = await insertTeam();
      const homeRegistrationId = await insertRegistration(privateHomeTeam, privateSeasonId);
      const awayRegistrationId = await insertRegistration(privateAwayTeam, privateSeasonId);
      const privateFixtureId = await insertFixture(
        privateSeasonId,
        homeRegistrationId,
        awayRegistrationId,
        null,
      );
      const privateMatchId = await insertMatch(privateFixtureId);
      const privateLineupId = await insertLineup(privateMatchId, homeRegistrationId, 'draft');

      return {
        publicCompetitionId,
        publicSeasonId,
        publicMatchId,
        publicLineupId,
        privateCompetitionId,
        privateSeasonId,
        privateMatchId,
        privateLineupId,
        privateFixtureId,
        homeRegistrationId,
        awayRegistrationId,
        publicAnnouncementId: await insertAnnouncement(
          publicCompetitionId,
          'public',
          'Public notice',
        ),
        publicAdminAnnouncementId: await insertAnnouncement(
          publicCompetitionId,
          'administrators',
          'Admin notice',
        ),
        privateAnnouncementId: await insertAnnouncement(
          privateCompetitionId,
          'public',
          'Private competition notice',
        ),
        privateAdminAnnouncementId: await insertAnnouncement(
          privateCompetitionId,
          'administrators',
          'Private admin notice',
        ),
      };
    }

    it('hides private and unpublished records from anonymous callers', async () => {
      const fixture = await buildVisibilityFixture();

      const publicCompetitions = await http('GET', '/api/v1/competitions');
      expect(publicCompetitions.statusCode).toBe(200);
      const competitionIds = (publicCompetitions.json().data as Array<{ id: string }>).map(
        (row) => row.id,
      );
      expect(competitionIds).toContain(fixture.publicCompetitionId);
      expect(competitionIds).not.toContain(fixture.privateCompetitionId);

      const privateCompetition = await http(
        'GET',
        `/api/v1/competitions/${fixture.privateCompetitionId}`,
      );
      expect(privateCompetition.statusCode).toBe(404);
      expect(privateCompetition.json().error.code).toBe('RESOURCE_NOT_FOUND');

      const publicCompetition = await http(
        'GET',
        `/api/v1/competitions/${fixture.publicCompetitionId}`,
      );
      expect(publicCompetition.statusCode).toBe(200);

      const privateFixtures = await http(
        'GET',
        `/api/v1/fixtures?seasonId=${fixture.privateSeasonId}`,
      );
      expect(privateFixtures.statusCode).toBe(404);

      const publicFixtures = await http(
        'GET',
        `/api/v1/fixtures?seasonId=${fixture.publicSeasonId}`,
      );
      expect(publicFixtures.statusCode).toBe(200);
      expect(publicFixtures.json().data).toHaveLength(1);

      const privateMatch = await http('GET', `/api/v1/matches/${fixture.privateMatchId}`);
      expect(privateMatch.statusCode).toBe(404);

      const publicMatch = await http('GET', `/api/v1/matches/${fixture.publicMatchId}`);
      expect(publicMatch.statusCode).toBe(200);
      const publicMatchLineups = (publicMatch.json().data as { lineups: Array<{ id: string }> })
        .lineups;
      expect(publicMatchLineups.map((lineup) => lineup.id)).toEqual([fixture.publicLineupId]);

      const announcements = await http('GET', '/api/v1/announcements');
      const announcementIds = (announcements.json().data as Array<{ id: string }>).map(
        (row) => row.id,
      );
      expect(announcementIds).toContain(fixture.publicAnnouncementId);
      expect(announcementIds).not.toContain(fixture.publicAdminAnnouncementId);
      expect(announcementIds).not.toContain(fixture.privateAnnouncementId);
      expect(announcementIds).not.toContain(fixture.privateAdminAnnouncementId);
    });

    it('allows scoped competition administrators to see their private records', async () => {
      const fixture = await buildVisibilityFixture();
      const admin = await createUser({
        role: ROLES.competitionAdmin,
        competitionId: fixture.privateCompetitionId,
      });

      const privateCompetition = await http(
        'GET',
        `/api/v1/competitions/${fixture.privateCompetitionId}`,
        { token: admin.accessToken },
      );
      expect(privateCompetition.statusCode).toBe(200);

      const privateFixtures = await http(
        'GET',
        `/api/v1/fixtures?seasonId=${fixture.privateSeasonId}`,
        { token: admin.accessToken },
      );
      expect(privateFixtures.statusCode).toBe(200);
      expect(privateFixtures.json().data).toHaveLength(1);

      const privateMatch = await http('GET', `/api/v1/matches/${fixture.privateMatchId}`, {
        token: admin.accessToken,
      });
      expect(privateMatch.statusCode).toBe(200);
      const lineups = (privateMatch.json().data as { lineups: Array<{ id: string }> }).lineups;
      expect(lineups.map((lineup) => lineup.id)).toContain(fixture.privateLineupId);

      const announcements = await http(
        'GET',
        `/api/v1/announcements?competitionId=${fixture.privateCompetitionId}`,
        { token: admin.accessToken },
      );
      const ids = (announcements.json().data as Array<{ id: string }>).map((row) => row.id);
      expect(ids).toContain(fixture.privateAnnouncementId);
      expect(ids).toContain(fixture.privateAdminAnnouncementId);
    });

    it('keeps private records hidden from ordinary registered users', async () => {
      const fixture = await buildVisibilityFixture();
      const user = await createUser();

      const privateCompetition = await http(
        'GET',
        `/api/v1/competitions/${fixture.privateCompetitionId}`,
        { token: user.accessToken },
      );
      expect(privateCompetition.statusCode).toBe(404);

      const privateMatch = await http('GET', `/api/v1/matches/${fixture.privateMatchId}`, {
        token: user.accessToken,
      });
      expect(privateMatch.statusCode).toBe(404);

      const publicMatch = await http('GET', `/api/v1/matches/${fixture.publicMatchId}`, {
        token: user.accessToken,
      });
      expect(publicMatch.statusCode).toBe(200);
    });

    it('lets a participating captain see only their own draft lineup on a private match', async () => {
      const fixture = await buildVisibilityFixture();
      const captain = await createUser({ role: ROLES.teamCaptain });
      await db
        .update(teamRegistrations)
        .set({ captainUserId: captain.userId })
        .where(eq(teamRegistrations.id, fixture.homeRegistrationId));

      const match = await http('GET', `/api/v1/matches/${fixture.privateMatchId}`, {
        token: captain.accessToken,
      });
      expect(match.statusCode).toBe(200);
      const lineups = (match.json().data as { lineups: Array<{ id: string }> }).lineups;
      expect(lineups.map((lineup) => lineup.id)).toEqual([fixture.privateLineupId]);

      const lineupsResponse = await http(
        'GET',
        `/api/v1/matches/${fixture.privateMatchId}/lineups`,
        { token: captain.accessToken },
      );
      expect(lineupsResponse.statusCode).toBe(200);
      expect(lineupsResponse.json().data).toHaveLength(1);
    });
  });

  describe('resource-level authorization primitives', () => {
    it('restricts captains to teams they own', async () => {
      const competitionId = await insertCompetition('published', 'public');
      const seasonId = await insertSeason(competitionId);
      const captain = await createUser({ role: ROLES.teamCaptain });
      const other = await createUser({ role: ROLES.teamCaptain });

      const ownTeam = await insertTeam();
      const otherTeam = await insertTeam();
      const ownRegistration = await insertRegistration(ownTeam, seasonId, captain.userId);
      const otherRegistration = await insertRegistration(otherTeam, seasonId, other.userId);

      const [player] = await db
        .insert(players)
        .values({ fullName: unique('Player') })
        .returning({ id: players.id });
      const [otherPlayerRecord] = await db
        .insert(players)
        .values({ fullName: unique('Player') })
        .returning({ id: players.id });
      const [ownPlayer] = await db
        .insert(playerRegistrations)
        .values({
          playerId: player!.id,
          teamRegistrationId: ownRegistration,
          seasonId,
          status: 'approved',
        })
        .returning({ id: playerRegistrations.id });
      const [otherPlayer] = await db
        .insert(playerRegistrations)
        .values({
          playerId: otherPlayerRecord!.id,
          teamRegistrationId: otherRegistration,
          seasonId,
          status: 'approved',
        })
        .returning({ id: playerRegistrations.id });

      const context = await contextFor(captain.accessToken);
      expect(
        await access.canManageTeamRegistration(
          context,
          ownRegistration,
          PERMISSIONS.teamsManage,
        ),
      ).toBe(true);
      expect(
        await access.canManageTeamRegistration(
          context,
          otherRegistration,
          PERMISSIONS.teamsManage,
        ),
      ).toBe(false);

      expect(
        await access.canManagePlayerRegistration(
          context,
          ownPlayer!.id,
          PERMISSIONS.playersManage,
        ),
      ).toBe(true);
      expect(
        await access.canManagePlayerRegistration(
          context,
          otherPlayer!.id,
          PERMISSIONS.playersManage,
        ),
      ).toBe(false);
    });

    it('requires an explicit official assignment to report a match', async () => {
      const competitionId = await insertCompetition('published', 'public');
      const seasonId = await insertSeason(competitionId);
      const home = await insertRegistration(await insertTeam(), seasonId);
      const away = await insertRegistration(await insertTeam(), seasonId);
      const fixtureId = await insertFixture(seasonId, home, away, new Date(Date.now() - 60_000));
      const matchId = await insertMatch(fixtureId);
      const official = await createUser({ role: ROLES.matchOfficial });

      const context = await contextFor(official.accessToken);
      const scope = await access.loadMatchScope(matchId);
      expect(scope).not.toBeNull();
      expect(await access.canReportMatch(context, scope!)).toBe(false);

      await db.insert(matchOfficials).values({ matchId, userId: official.userId });
      expect(await access.canReportMatch(context, scope!)).toBe(true);
    });

    it('limits competition administrators to their assigned competition', async () => {
      const scopedCompetition = await insertCompetition('draft', 'public');
      const otherCompetition = await insertCompetition('draft', 'public');
      const admin = await createUser({
        role: ROLES.competitionAdmin,
        competitionId: scopedCompetition,
      });
      const context = await contextFor(admin.accessToken);

      expect(
        access.canManageCompetition(context, PERMISSIONS.competitionsUpdate, scopedCompetition),
      ).toBe(true);
      expect(
        access.canManageCompetition(context, PERMISSIONS.competitionsUpdate, otherCompetition),
      ).toBe(false);
    });

    it('prevents self role escalation and requires role management permission', async () => {
      const ordinary = await createUser();
      const superAdmin = await createUser({ role: ROLES.superAdmin });
      const target = await createUser();
      const ordinaryContext = await contextFor(ordinary.accessToken);
      const superContext = await contextFor(superAdmin.accessToken);

      await expect(
        access.assertRoleAssignmentAllowed(ordinaryContext, {
          targetUserId: target.userId,
          role: ROLES.competitionAdmin,
          competitionId: null,
        }),
      ).rejects.toThrow();

      await expect(
        access.assertRoleAssignmentAllowed(superContext, {
          targetUserId: superAdmin.userId,
          role: ROLES.superAdmin,
          competitionId: null,
        }),
      ).rejects.toThrow();

      await expect(
        access.assertRoleAssignmentAllowed(superContext, {
          targetUserId: target.userId,
          role: ROLES.matchOfficial,
          competitionId: null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('WebSocket authentication and subscriptions', () => {
    async function publicMatch(): Promise<string> {
      const competitionId = await insertCompetition('published', 'public');
      const seasonId = await insertSeason(competitionId);
      const home = await insertRegistration(await insertTeam(), seasonId);
      const away = await insertRegistration(await insertTeam(), seasonId);
      const fixtureId = await insertFixture(seasonId, home, away, new Date(Date.now() - 60_000));
      return insertMatch(fixtureId);
    }

    async function privateMatch(): Promise<string> {
      const competitionId = await insertCompetition('draft', 'public');
      const seasonId = await insertSeason(competitionId);
      const home = await insertRegistration(await insertTeam(), seasonId);
      const away = await insertRegistration(await insertTeam(), seasonId);
      const fixtureId = await insertFixture(seasonId, home, away, null);
      return insertMatch(fixtureId);
    }

    it('rejects anonymous and invalid websocket credentials before upgrade', async () => {
      const matchId = await publicMatch();
      await expect(app.injectWS(`/ws/matches/${matchId}`)).rejects.toThrow();
      await expect(
        app.injectWS(`/ws/matches/${matchId}`, {
          headers: { authorization: 'Bearer invalid-token' },
        }),
      ).rejects.toThrow();
    });

    it('accepts cookie authentication only from an allowlisted origin', async () => {
      const matchId = await publicMatch();
      const user = await createUser();

      const allowed = await connectSocket(`/ws/matches/${matchId}`, undefined, {
        cookie: `access_token=${user.accessCookie}`,
        origin: 'http://localhost:3000',
      });
      expect((await allowed.next()).type).toBe('connection.ready');
      allowed.ws.close();

      await expect(
        app.injectWS(`/ws/matches/${matchId}`, {
          headers: {
            cookie: `access_token=${user.accessCookie}`,
            origin: 'http://evil.example',
          },
        }),
      ).rejects.toThrow();

      await expect(
        app.injectWS(`/ws/matches/${matchId}`, {
          headers: { cookie: `access_token=${user.accessCookie}` },
        }),
      ).rejects.toThrow();
    });

    it('rejects revoked sessions on websocket upgrade', async () => {
      const matchId = await publicMatch();
      const user = await createUser();
      await http('POST', '/api/v1/auth/logout', {
        token: user.accessToken,
        cookies: { refresh_token: user.refreshToken },
      });
      await expect(
        app.injectWS(`/ws/matches/${matchId}`, {
          headers: { authorization: `Bearer ${user.accessToken}` },
        }),
      ).rejects.toThrow();
    });

    it('accepts authorized subscriptions and rejects cross-match subscriptions', async () => {
      const allowedMatch = await publicMatch();
      const otherMatch = await privateMatch();
      const user = await createUser();
      const client = await connectSocket(`/ws/matches/${allowedMatch}`, user.accessToken);

      const ready = await client.next();
      expect(ready.type).toBe('connection.ready');
      expect(ready.matchId).toBe(allowedMatch);

      client.ws.send(JSON.stringify({ type: 'subscribe', matchId: allowedMatch }));
      const subscribed = await client.next();
      expect(subscribed.type).toBe('subscribed');

      client.ws.send(JSON.stringify({ type: 'subscribe', matchId: otherMatch }));
      const rejected = await client.next();
      expect(rejected.type).toBe('error');
      expect(rejected.code).toBe('SUBSCRIPTION_FORBIDDEN');

      client.ws.close();
    });

    it('refuses to open a private match channel for an unauthorized user', async () => {
      const matchId = await privateMatch();
      const user = await createUser();
      const client = await connectSocket(`/ws/matches/${matchId}`, user.accessToken);

      const first = await client.next();
      expect(first.type).toBe('error');
      expect(first.code).toBe('RESOURCE_NOT_FOUND');
      const closed = await client.closed();
      expect(closed.code).toBe(4404);
    });

    it('closes live connections when the session is revoked', async () => {
      const matchId = await publicMatch();
      const user = await createUser();
      const client = await connectSocket(`/ws/matches/${matchId}`, user.accessToken);
      expect((await client.next()).type).toBe('connection.ready');

      await http('POST', '/api/v1/auth/logout', { token: user.accessToken });
      const closed = await client.closed();
      expect(closed.code).toBe(4401);
    });
  });
}
