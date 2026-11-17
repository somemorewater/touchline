import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (databaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = 'phase7-test-secret-with-at-least-32-chars';
  process.env.JWT_ISSUER = 'touchline-api';
  process.env.JWT_AUDIENCE = 'touchline-client';
  process.env.ACCESS_TOKEN_TTL = '15m';
  process.env.REFRESH_TOKEN_DAYS = '30';
  process.env.REFRESH_REUSE_GRACE_SECONDS = '2';
  process.env.COOKIE_SECURE = 'false';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.TRUST_PROXY = 'false';
  process.env.FILE_STORAGE_DIR = './var/phase7-test-uploads';
  process.env.FILE_MAX_BYTES = '1048576';
}

const PASSWORD = 'phase7-test-password';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

if (!databaseUrl) {
  describe.skip('phase 7 (requires TEST_DATABASE_URL)', () => {
    it('is skipped without an isolated database', () => {
      expect(true).toBe(true);
    });
  });
} else {
  type Db = (typeof import('../src/database/client.js'))['db'];
  type Sql = (typeof import('../src/database/client.js'))['sql'];
  type RolesTable = typeof import('../src/database/schema/index.js')['roles'];
  type UserRolesTable = typeof import('../src/database/schema/index.js')['userRoles'];
  type AuditLogsTable = typeof import('../src/database/schema/index.js')['auditLogs'];
  type MatchesTable = typeof import('../src/database/schema/index.js')['matches'];

  let app: FastifyInstance;
  let db: Db;
  let sql: Sql;
  let rolesTable: RolesTable;
  let userRolesTable: UserRolesTable;
  let auditLogsTable: AuditLogsTable;
  let matchesTable: MatchesTable;

  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${++counter}-${randomUUID().slice(0, 6)}`;
  const nextIp = () =>
    `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;

  interface HttpOptions {
    token?: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }

  function http(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    options: HttpOptions = {},
  ) {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    return app.inject({
      method,
      url,
      headers,
      payload: options.payload as string | Buffer | object | undefined,
      remoteAddress: nextIp(),
    });
  }

  async function register(email: string): Promise<string> {
    const response = await http('POST', '/api/v1/auth/register', {
      payload: { email, password: PASSWORD, displayName: 'Phase 7 User' },
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
    const existing = await db
      .select({ userId: userRolesTable.userId })
      .from(userRolesTable)
      .where(
        and(
          eq(userRolesTable.userId, userId),
          eq(userRolesTable.roleId, role.id),
          competitionId === null
            ? isNull(userRolesTable.competitionId)
            : eq(userRolesTable.competitionId, competitionId),
        ),
      );
    if (existing.length > 0) return;
    await db.insert(userRolesTable).values({ userId, roleId: role.id, competitionId });
  }

  async function createUserWithRole(
    roleName: string,
    competitionId: string | null = null,
  ): Promise<{ id: string; email: string; token: string }> {
    const email = `${unique('user')}@example.test`;
    const id = await register(email);
    await grantRole(id, roleName, competitionId);
    return { id, email, token: await login(email) };
  }

  async function createCompetition(token: string): Promise<string> {
    const response = await http('POST', '/api/v1/competitions', {
      token,
      payload: {
        slug: unique('competition').toLowerCase(),
        name: unique('Competition'),
        visibility: 'public',
      },
    });
    expect(response.statusCode).toBe(201);
    const id = (response.json().data as { id: string }).id;
    const published = await http('POST', `/api/v1/competitions/${id}/publish`, { token });
    expect(published.statusCode).toBe(200);
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
    captain: { id: string; email: string; token: string };
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
        displayName: `${name} Captain`,
        teamRegistrationId: team.registration.id,
      },
    });
    expect(captain.statusCode).toBe(201);
    const captainId = (captain.json().data as { user: { id: string } }).user.id;
    return {
      teamId: team.id,
      registrationId: team.registration.id,
      captain: { id: captainId, email, token: await login(email) },
    };
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
  ): Promise<MatchSetup> {
    const response = await http('POST', '/api/v1/fixtures', {
      token: adminToken,
      payload: {
        seasonId,
        homeTeamRegistrationId: homeRegistrationId,
        awayTeamRegistrationId: awayRegistrationId,
        scheduledAt: new Date().toISOString(),
      },
    });
    expect(response.statusCode).toBe(201);
    const data = response.json().data as {
      fixture: { id: string };
      match: { id: string };
    };
    const published = await http('POST', `/api/v1/fixtures/${data.fixture.id}/publish`, {
      token: adminToken,
    });
    expect(published.statusCode).toBe(200);
    return { fixtureId: data.fixture.id, matchId: data.match.id };
  }

  interface World {
    adminToken: string;
    adminId: string;
    competitionId: string;
    seasonId: string;
    home: TeamSetup;
    away: TeamSetup;
    match: MatchSetup;
    scopedAdmin: { id: string; email: string; token: string };
  }

  async function buildWorld(): Promise<World> {
    const admin = await createUserWithRole('super_admin');
    const competitionId = await createCompetition(admin.token);
    const seasonId = await createSeason(admin.token, competitionId);
    const home = await setupTeam(admin.token, seasonId, unique('Home'));
    const away = await setupTeam(admin.token, seasonId, unique('Away'));
    const match = await createFixture(
      admin.token,
      seasonId,
      home.registrationId,
      away.registrationId,
    );
    const scopedAdmin = await createUserWithRole('competition_admin', competitionId);
    return {
      adminToken: admin.token,
      adminId: admin.id,
      competitionId,
      seasonId,
      home,
      away,
      match,
      scopedAdmin,
    };
  }

  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);

  beforeAll(async () => {
    const client = await import('../src/database/client.js');
    db = client.db;
    sql = client.sql;
    const schema = await import('../src/database/schema/index.js');
    rolesTable = schema.roles;
    userRolesTable = schema.userRoles;
    auditLogsTable = schema.auditLogs;
    matchesTable = schema.matches;

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

  describe('user and role administration', () => {
    it('lists, searches and paginates users without exposing secrets', async () => {
      const world = await buildWorld();
      const response = await http('GET', '/api/v1/users?limit=1', {
        token: world.adminToken,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: { items: Array<Record<string, unknown>>; pagination: { limit: number } };
      };
      expect(body.data.pagination.limit).toBe(1);
      expect(body.data.items.length).toBe(1);
      expect(body.data.items[0]).not.toHaveProperty('passwordHash');
      expect(body.data.items[0]).not.toHaveProperty('password_hash');

      const search = await http(
        'GET',
        `/api/v1/users?q=${encodeURIComponent(world.home.captain.email)}`,
        { token: world.adminToken },
      );
      expect(search.statusCode).toBe(200);
      const found = search.json().data as { items: Array<{ email: string }> };
      expect(found.items.some((row) => row.email === world.home.captain.email)).toBe(true);
    });

    it('grants and revokes roles while blocking escalation', async () => {
      const world = await buildWorld();
      const target = await createUserWithRole('registered_user');

      const granted = await http('POST', `/api/v1/users/${target.id}/roles`, {
        token: world.adminToken,
        payload: { role: 'match_official', competitionId: world.competitionId },
      });
      expect(granted.statusCode).toBe(201);

      const roles = await http('GET', `/api/v1/users/${target.id}/roles`, {
        token: world.adminToken,
      });
      expect(roles.statusCode).toBe(200);
      expect(
        (roles.json().data as Array<{ role: string }>).some(
          (row) => row.role === 'match_official',
        ),
      ).toBe(true);

      const escalation = await http('POST', `/api/v1/users/${target.id}/roles`, {
        token: world.scopedAdmin.token,
        payload: { role: 'super_admin' },
      });
      expect(escalation.statusCode).toBe(403);

      const scopedCaptain = await http('POST', `/api/v1/users/${target.id}/roles`, {
        token: world.scopedAdmin.token,
        payload: { role: 'team_captain', competitionId: world.competitionId },
      });
      expect(scopedCaptain.statusCode).toBe(201);

      const revoked = await http(
        'DELETE',
        `/api/v1/users/${target.id}/roles/match_official?competitionId=${world.competitionId}`,
        { token: world.adminToken },
      );
      expect(revoked.statusCode).toBe(200);
    });

    it('suspends, restores, deactivates and revokes sessions', async () => {
      const world = await buildWorld();
      const target = await createUserWithRole('registered_user');

      const suspended = await http('POST', `/api/v1/users/${target.id}/suspend`, {
        token: world.adminToken,
        payload: { reason: 'Policy violation' },
      });
      expect(suspended.statusCode).toBe(200);
      expect((suspended.json().data as { suspendedReason: string }).suspendedReason).toBe(
        'Policy violation',
      );

      const blocked = await http('GET', '/api/v1/auth/me', { token: target.token });
      expect(blocked.statusCode).toBe(401);

      const restored = await http('POST', `/api/v1/users/${target.id}/restore`, {
        token: world.adminToken,
      });
      expect(restored.statusCode).toBe(200);
      const afterRestore = await login(target.email);

      const revoked = await http('POST', `/api/v1/users/${target.id}/sessions/revoke`, {
        token: world.adminToken,
        payload: { reason: 'Administrative revocation' },
      });
      expect(revoked.statusCode).toBe(200);
      const revokedAccess = await http('GET', '/api/v1/auth/me', { token: afterRestore });
      expect(revokedAccess.statusCode).toBe(401);

      const deactivated = await http('POST', `/api/v1/users/${target.id}/deactivate`, {
        token: world.adminToken,
      });
      expect(deactivated.statusCode).toBe(200);
      const history = await http('GET', `/api/v1/users/${target.id}/history`, {
        token: world.adminToken,
      });
      expect(history.statusCode).toBe(200);
      const actions = (history.json().data as Array<{ action: string }>).map(
        (row) => row.action,
      );
      expect(actions).toContain('user.suspended');
      expect(actions).toContain('user.restored');
      expect(actions).toContain('user.deactivated');
    });

    it('keeps competition administrators inside their competition scope', async () => {
      const world = await buildWorld();
      const otherWorld = await buildWorld();
      const scoped = await http('GET', '/api/v1/users', {
        token: world.scopedAdmin.token,
      });
      expect(scoped.statusCode).toBe(200);
      const scopedIds = (scoped.json().data as { items: Array<{ id: string }> }).items.map(
        (row) => row.id,
      );
      expect(scopedIds).toContain(world.home.captain.id);
      expect(scopedIds).not.toContain(otherWorld.home.captain.id);

      const suspend = await http('POST', `/api/v1/users/${world.home.captain.id}/suspend`, {
        token: world.scopedAdmin.token,
        payload: { reason: 'Not allowed' },
      });
      expect(suspend.statusCode).toBe(403);
    });
  });

  describe('competition administration overview', () => {
    it('returns counts, filters and warnings for an authorized scope', async () => {
      const world = await buildWorld();
      const response = await http(
        'GET',
        `/api/v1/competitions/${world.competitionId}/administration?seasonId=${world.seasonId}`,
        { token: world.scopedAdmin.token },
      );
      expect(response.statusCode).toBe(200);
      const data = response.json().data as {
        teams: Record<string, number>;
        warnings: string[];
        operational: { upcomingMatchesWithoutLineups: number };
      };
      expect(data.teams.approved).toBe(2);
      expect(data.operational.upcomingMatchesWithoutLineups).toBe(1);
      expect(data.warnings).toContain('No current standings snapshot is published.');

      const stranger = await createUserWithRole('registered_user');
      const hidden = await http(
        'GET',
        `/api/v1/competitions/${world.competitionId}/administration`,
        { token: stranger.token },
      );
      expect(hidden.statusCode).toBe(404);
    });
  });

  describe('disciplinary cases', () => {
    it('runs the controlled lifecycle and sanctions without mutating registration status', async () => {
      const world = await buildWorld();

      const created = await http('POST', '/api/v1/disciplinary-cases', {
        token: world.adminToken,
        payload: {
          competitionId: world.competitionId,
          seasonId: world.seasonId,
          subjectType: 'team',
          subjectTeamRegistrationId: world.home.registrationId,
          originType: 'competition_administration',
          title: 'Eligibility investigation',
          description: 'Investigate an ineligible participation report.',
        },
      });
      expect(created.statusCode).toBe(201);
      const caseId = (created.json().data as { id: string }).id;

      const assigned = await http('POST', `/api/v1/disciplinary-cases/${caseId}/reviewer`, {
        token: world.adminToken,
        payload: { reviewerId: world.scopedAdmin.id },
      });
      expect(assigned.statusCode).toBe(200);

      const review = await http('POST', `/api/v1/disciplinary-cases/${caseId}/review`, {
        token: world.scopedAdmin.token,
        payload: { reason: 'Review started' },
      });
      expect(review.statusCode).toBe(200);

      const finding = await http('POST', `/api/v1/disciplinary-cases/${caseId}/findings`, {
        token: world.scopedAdmin.token,
        payload: { body: 'The report is corroborated by the match record.' },
      });
      expect(finding.statusCode).toBe(200);

      const requested = await http(
        'POST',
        `/api/v1/disciplinary-cases/${caseId}/request-response`,
        {
          token: world.scopedAdmin.token,
          payload: { reason: 'Please respond to the finding.' },
        },
      );
      expect(requested.statusCode).toBe(200);

      const response = await http('POST', `/api/v1/disciplinary-cases/${caseId}/responses`, {
        token: world.home.captain.token,
        payload: { body: 'The team accepts the finding.' },
      });
      expect(response.statusCode).toBe(200);

      const decided = await http('POST', `/api/v1/disciplinary-cases/${caseId}/decision`, {
        token: world.scopedAdmin.token,
        payload: { decision: 'The team is sanctioned with a one-match suspension.' },
      });
      expect(decided.statusCode).toBe(200);

      const sanction = await http('POST', `/api/v1/disciplinary-cases/${caseId}/sanctions`, {
        token: world.scopedAdmin.token,
        payload: {
          subjectType: 'team',
          subjectTeamRegistrationId: world.home.registrationId,
          sanctionType: 'match_suspension',
          reason: 'One match suspension for the team.',
          matchesCount: 1,
        },
      });
      expect(sanction.statusCode).toBe(201);

      const eligibility = await http(
        'GET',
        `/api/v1/disciplinary/eligibility/teams/${world.home.registrationId}`,
        { token: world.scopedAdmin.token },
      );
      expect(eligibility.statusCode).toBe(200);
      expect((eligibility.json().data as { eligible: boolean }).eligible).toBe(false);

      const registration = await http(
        'GET',
        `/api/v1/team-entries/${world.home.registrationId}`,
        { token: world.adminToken },
      );
      expect(registration.statusCode).toBe(200);
      expect((registration.json().data as { registration: { status: string } }).registration.status).toBe('approved');

      const appealed = await http('POST', `/api/v1/disciplinary-cases/${caseId}/appeal`, {
        token: world.home.captain.token,
        payload: { reason: 'The sanction is disproportionate.' },
      });
      expect(appealed.statusCode).toBe(200);

      const closed = await http('POST', `/api/v1/disciplinary-cases/${caseId}/close`, {
        token: world.adminToken,
        payload: { reason: 'Appeal reviewed and the case is closed.' },
      });
      expect(closed.statusCode).toBe(200);

      const history = await http('GET', `/api/v1/disciplinary-cases/${caseId}/history`, {
        token: world.adminToken,
      });
      expect(history.statusCode).toBe(200);
      expect((history.json().data as Array<{ action: string }>).length).toBeGreaterThan(3);
    });

    it('hides internal notes from subjects and exposes them to authorized reviewers', async () => {
      const world = await buildWorld();
      const subjectUser = await createUserWithRole('registered_user');
      const outsider = await createUserWithRole('registered_user');

      const created = await http('POST', '/api/v1/disciplinary-cases', {
        token: world.adminToken,
        payload: {
          competitionId: world.competitionId,
          seasonId: world.seasonId,
          subjectType: 'team',
          subjectTeamRegistrationId: world.home.registrationId,
          originType: 'competition_administration',
          title: 'Internal note visibility',
          description: 'Verify reviewer-only note visibility.',
        },
      });
      expect(created.statusCode).toBe(201);
      const caseId = (created.json().data as { id: string }).id;

      const assigned = await http('POST', `/api/v1/disciplinary-cases/${caseId}/reviewer`, {
        token: world.adminToken,
        payload: { reviewerId: world.scopedAdmin.id },
      });
      expect(assigned.statusCode).toBe(200);

      const internalBody = unique('internal-note');
      const sharedBody = unique('shared-note');
      const internalNote = await http('POST', `/api/v1/disciplinary-cases/${caseId}/notes`, {
        token: world.scopedAdmin.token,
        payload: { body: internalBody, isInternal: true },
      });
      expect(internalNote.statusCode).toBe(200);
      const sharedNote = await http('POST', `/api/v1/disciplinary-cases/${caseId}/notes`, {
        token: world.scopedAdmin.token,
        payload: { body: sharedBody, isInternal: false },
      });
      expect(sharedNote.statusCode).toBe(200);

      const entryBodies = (response: { json: () => unknown }) =>
        (response.json() as { data: { entries: Array<{ body: string | null }> } }).data.entries
          .map((entry) => entry.body);

      const captainDetail = await http('GET', `/api/v1/disciplinary-cases/${caseId}`, {
        token: world.home.captain.token,
      });
      expect(captainDetail.statusCode).toBe(200);
      expect(entryBodies(captainDetail)).not.toContain(internalBody);
      expect(entryBodies(captainDetail)).toContain(sharedBody);

      const reviewerDetail = await http('GET', `/api/v1/disciplinary-cases/${caseId}`, {
        token: world.scopedAdmin.token,
      });
      expect(reviewerDetail.statusCode).toBe(200);
      expect(entryBodies(reviewerDetail)).toContain(internalBody);

      const adminDetail = await http('GET', `/api/v1/disciplinary-cases/${caseId}`, {
        token: world.adminToken,
      });
      expect(adminDetail.statusCode).toBe(200);
      expect(entryBodies(adminDetail)).toContain(internalBody);

      const outsiderDetail = await http('GET', `/api/v1/disciplinary-cases/${caseId}`, {
        token: outsider.token,
      });
      expect(outsiderDetail.statusCode).toBe(404);

      const captainHistory = await http(
        'GET',
        `/api/v1/disciplinary-cases/${caseId}/history`,
        { token: world.home.captain.token },
      );
      expect(captainHistory.statusCode).toBe(200);
      expect(JSON.stringify(captainHistory.json().data)).not.toContain(internalBody);

      const adminHistory = await http('GET', `/api/v1/disciplinary-cases/${caseId}/history`, {
        token: world.adminToken,
      });
      expect(adminHistory.statusCode).toBe(200);
      expect(JSON.stringify(adminHistory.json().data)).toContain(internalBody);

      const userCase = await http('POST', '/api/v1/disciplinary-cases', {
        token: world.adminToken,
        payload: {
          competitionId: world.competitionId,
          seasonId: world.seasonId,
          subjectType: 'official',
          subjectUserId: subjectUser.id,
          originType: 'competition_administration',
          title: 'Subject user note visibility',
          description: 'Verify the subject cannot read reviewer-only notes.',
        },
      });
      expect(userCase.statusCode).toBe(201);
      const userCaseId = (userCase.json().data as { id: string }).id;
      const userCaseNote = unique('subject-internal-note');
      const added = await http('POST', `/api/v1/disciplinary-cases/${userCaseId}/notes`, {
        token: world.adminToken,
        payload: { body: userCaseNote, isInternal: true },
      });
      expect(added.statusCode).toBe(200);

      const subjectDetail = await http('GET', `/api/v1/disciplinary-cases/${userCaseId}`, {
        token: subjectUser.token,
      });
      expect(subjectDetail.statusCode).toBe(200);
      expect(entryBodies(subjectDetail)).not.toContain(userCaseNote);

      const subjectHistory = await http(
        'GET',
        `/api/v1/disciplinary-cases/${userCaseId}/history`,
        { token: subjectUser.token },
      );
      expect(subjectHistory.statusCode).toBe(200);
      expect(JSON.stringify(subjectHistory.json().data)).not.toContain(userCaseNote);
    });
  });

  describe('disputes', () => {
    it('allows captain submissions and administrative decisions without changing results', async () => {
      const world = await buildWorld();
      const stranger = await createUserWithRole('registered_user');

      const created = await http('POST', '/api/v1/disputes', {
        token: world.home.captain.token,
        payload: {
          competitionId: world.competitionId,
          seasonId: world.seasonId,
          matchId: world.match.matchId,
          teamRegistrationId: world.home.registrationId,
          subjectType: 'match_result',
          title: 'Incorrect result',
          description: 'The recorded result does not reflect the match.',
          submit: true,
        },
      });
      expect(created.statusCode).toBe(201);
      const disputeId = (created.json().data as { id: string }).id;

      const crossTeam = await http('POST', '/api/v1/disputes', {
        token: world.away.captain.token,
        payload: {
          competitionId: world.competitionId,
          matchId: world.match.matchId,
          teamRegistrationId: world.home.registrationId,
          subjectType: 'match_result',
          title: 'Cross-team attempt',
          description: 'This must not be allowed.',
          submit: true,
        },
      });
      expect(crossTeam.statusCode).toBe(403);

      const hidden = await http('GET', `/api/v1/disputes/${disputeId}`, {
        token: stranger.token,
      });
      expect(hidden.statusCode).toBe(404);

      const assigned = await http('POST', `/api/v1/disputes/${disputeId}/reviewer`, {
        token: world.adminToken,
        payload: { reviewerId: world.scopedAdmin.id },
      });
      expect(assigned.statusCode).toBe(200);

      const review = await http('POST', `/api/v1/disputes/${disputeId}/review`, {
        token: world.scopedAdmin.token,
        payload: {},
      });
      expect(review.statusCode).toBe(200);

      const response = await http('POST', `/api/v1/disputes/${disputeId}/responses`, {
        token: world.scopedAdmin.token,
        payload: { body: 'We are reviewing the match record.' },
      });
      expect(response.statusCode).toBe(200);

      const decision = await http('POST', `/api/v1/disputes/${disputeId}/decision`, {
        token: world.scopedAdmin.token,
        payload: {
          outcome: 'rejected',
          decision: 'The recorded result stands. Use the match correction flow if needed.',
        },
      });
      expect(decision.statusCode).toBe(200);

      const [match] = await db
        .select({ homeScore: matchesTable.homeScore, awayScore: matchesTable.awayScore })
        .from(matchesTable)
        .where(eq(matchesTable.id, world.match.matchId));
      expect(match?.homeScore).toBe(0);
      expect(match?.awayScore).toBe(0);

      const closed = await http('POST', `/api/v1/disputes/${disputeId}/close`, {
        token: world.scopedAdmin.token,
        payload: { reason: 'Decision communicated.' },
      });
      expect(closed.statusCode).toBe(200);
    });
  });

  describe('evidence files', () => {
    it('validates content, stores privately and enforces authorized access', async () => {
      const world = await buildWorld();
      const stranger = await createUserWithRole('registered_user');

      const dispute = await http('POST', '/api/v1/disputes', {
        token: world.adminToken,
        payload: {
          competitionId: world.competitionId,
          seasonId: world.seasonId,
          matchId: world.match.matchId,
          subjectType: 'match_event',
          title: 'Evidence dispute',
          description: 'Attach supporting evidence.',
          submit: true,
        },
      });
      expect(dispute.statusCode).toBe(201);
      const disputeId = (dispute.json().data as { id: string }).id;

      const upload = await http('POST', `/api/v1/disputes/${disputeId}/evidence`, {
        token: world.adminToken,
        headers: { 'content-type': 'image/png', 'x-file-name': 'proof.png' },
        payload: png,
      });
      expect(upload.statusCode).toBe(201);
      const evidence = upload.json().data as { id: string; fileId: string };
      expect(evidence.fileId).toBeTruthy();

      const wrongExtension = await http(
        'POST',
        `/api/v1/disputes/${disputeId}/evidence`,
        {
          token: world.adminToken,
          headers: { 'content-type': 'image/png', 'x-file-name': 'proof.pdf' },
          payload: png,
        },
      );
      expect(wrongExtension.statusCode).toBe(400);

      const traversal = await http('POST', `/api/v1/disputes/${disputeId}/evidence`, {
        token: world.adminToken,
        headers: { 'content-type': 'image/png', 'x-file-name': '../proof.png' },
        payload: png,
      });
      expect(traversal.statusCode).toBe(400);

      const content = await http('GET', `/api/v1/files/${evidence.fileId}/content`, {
        token: world.adminToken,
      });
      expect(content.statusCode).toBe(200);
      expect(content.headers['content-type']).toContain('image/png');

      const anonymous = await http('GET', `/api/v1/files/${evidence.fileId}/content`);
      expect(anonymous.statusCode).toBe(401);

      const forbidden = await http('GET', `/api/v1/files/${evidence.fileId}/content`, {
        token: stranger.token,
      });
      expect(forbidden.statusCode).toBe(404);

      const removed = await http(
        'DELETE',
        `/api/v1/disputes/${disputeId}/evidence/${evidence.id}?reason=Superseded`,
        { token: world.adminToken },
      );
      expect(removed.statusCode).toBe(200);

      const list = await http('GET', `/api/v1/disputes/${disputeId}/evidence`, {
        token: world.adminToken,
      });
      expect(list.statusCode).toBe(200);
      expect((list.json().data as unknown[]).length).toBe(0);
    });
  });

  describe('announcements', () => {
    it('keeps drafts private and applies audience visibility', async () => {
      const world = await buildWorld();
      const stranger = await createUserWithRole('registered_user');

      const draft = await http('POST', '/api/v1/announcements', {
        token: world.adminToken,
        payload: {
          competitionId: world.competitionId,
          title: 'Draft announcement',
          body: 'Not yet visible.',
          audience: 'public',
        },
      });
      expect(draft.statusCode).toBe(201);
      const draftId = (draft.json().data as { id: string }).id;

      const anonDraft = await http('GET', `/api/v1/announcements?competitionId=${world.competitionId}`);
      expect(anonDraft.statusCode).toBe(200);
      expect((anonDraft.json().data as Array<{ id: string }>).map((row) => row.id)).not.toContain(
        draftId,
      );

      const published = await http('POST', `/api/v1/announcements/${draftId}/publish`, {
        token: world.adminToken,
      });
      expect(published.statusCode).toBe(200);

      const anonPublished = await http(
        'GET',
        `/api/v1/announcements?competitionId=${world.competitionId}`,
      );
      expect(
        (anonPublished.json().data as Array<{ id: string }>).map((row) => row.id),
      ).toContain(draftId);

      const captainOnly = await http('POST', '/api/v1/announcements', {
        token: world.adminToken,
        payload: {
          competitionId: world.competitionId,
          title: 'Captain announcement',
          body: 'Captains only.',
          audience: 'captains',
        },
      });
      expect(captainOnly.statusCode).toBe(201);
      const captainOnlyId = (captainOnly.json().data as { id: string }).id;
      expect(
        (
          await http('POST', `/api/v1/announcements/${captainOnlyId}/publish`, {
            token: world.adminToken,
          })
        ).statusCode,
      ).toBe(200);

      const anonList = await http('GET', `/api/v1/announcements?competitionId=${world.competitionId}`);
      expect((anonList.json().data as Array<{ id: string }>).map((row) => row.id)).not.toContain(
        captainOnlyId,
      );

      const captainList = await http(
        'GET',
        `/api/v1/announcements?competitionId=${world.competitionId}`,
        { token: world.home.captain.token },
      );
      expect(
        (captainList.json().data as Array<{ id: string }>).map((row) => row.id),
      ).toContain(captainOnlyId);

      const strangerList = await http(
        'GET',
        `/api/v1/announcements?competitionId=${world.competitionId}`,
        { token: stranger.token },
      );
      expect(
        (strangerList.json().data as Array<{ id: string }>).map((row) => row.id),
      ).not.toContain(captainOnlyId);

      const unpublished = await http('POST', `/api/v1/announcements/${draftId}/unpublish`, {
        token: world.adminToken,
      });
      expect(unpublished.statusCode).toBe(200);
      const archived = await http('POST', `/api/v1/announcements/${captainOnlyId}/archive`, {
        token: world.adminToken,
      });
      expect(archived.statusCode).toBe(200);
    });
  });

  describe('notifications', () => {
    it('resolves recipients server-side and isolates each user', async () => {
      const world = await buildWorld();
      const stranger = await createUserWithRole('registered_user');

      const submitted = await http('POST', '/api/v1/player-registrations', {
        token: world.home.captain.token,
        payload: {
          teamRegistrationId: world.home.registrationId,
          player: {
            fullName: 'Notification Player',
            dateOfBirth: '2003-01-01',
            position: 'MF',
          },
          shirtNumber: 7,
        },
      });
      expect(submitted.statusCode).toBe(201);
      const registrationId = (submitted.json().data as { id: string }).id;

      const approved = await http(
        'POST',
        `/api/v1/player-registrations/${registrationId}/approve`,
        { token: world.adminToken, payload: {} },
      );
      expect(approved.statusCode).toBe(200);

      const captainFeed = await http('GET', '/api/v1/notifications', {
        token: world.home.captain.token,
      });
      expect(captainFeed.statusCode).toBe(200);
      const captainItems = (captainFeed.json().data as {
        items: Array<{ id: string; type: string; readAt: string | null }>;
      }).items;
      const approval = captainItems.find((row) => row.type === 'registration.approved');
      expect(approval).toBeTruthy();

      const unread = await http('GET', '/api/v1/notifications/unread-count', {
        token: world.home.captain.token,
      });
      expect((unread.json().data as { unread: number }).unread).toBeGreaterThan(0);

      const strangerFeed = await http('GET', '/api/v1/notifications', {
        token: stranger.token,
      });
      expect(strangerFeed.statusCode).toBe(200);
      expect((strangerFeed.json().data as { items: unknown[] }).items.length).toBe(0);

      const steal = await http('POST', `/api/v1/notifications/${approval!.id}/read`, {
        token: stranger.token,
      });
      expect(steal.statusCode).toBe(404);

      const read = await http('POST', `/api/v1/notifications/${approval!.id}/read`, {
        token: world.home.captain.token,
      });
      expect(read.statusCode).toBe(200);

      const readAll = await http('POST', '/api/v1/notifications/read-all', {
        token: world.home.captain.token,
      });
      expect(readAll.statusCode).toBe(200);

      const after = await http('GET', '/api/v1/notifications/unread-count', {
        token: world.home.captain.token,
      });
      expect((after.json().data as { unread: number }).unread).toBe(0);
    });
  });

  describe('audit log administration', () => {
    it('is scoped, paginated, sanitized and append-only', async () => {
      const world = await buildWorld();
      const otherWorld = await buildWorld();

      const audit = await http('GET', '/api/v1/audit-logs?limit=1', {
        token: world.adminToken,
      });
      expect(audit.statusCode).toBe(200);
      const page = audit.json().data as {
        items: Array<Record<string, unknown>>;
        pagination: { limit: number };
      };
      expect(page.pagination.limit).toBe(1);
      expect(page.items.length).toBe(1);

      const scoped = await http(
        'GET',
        `/api/v1/audit-logs?competitionId=${otherWorld.competitionId}`,
        { token: world.scopedAdmin.token },
      );
      expect(scoped.statusCode).toBe(200);
      expect((scoped.json().data as { items: unknown[] }).items.length).toBe(0);

      await db.insert(auditLogsTable).values({
        actorUserId: world.adminId,
        competitionId: world.competitionId,
        seasonId: world.seasonId,
        action: 'user.sensitive_test',
        entityType: 'user',
        entityId: world.adminId,
        before: { passwordHash: 'do-not-expose', nested: { token: 'secret', safe: 1 } },
        after: { email: 'safe@example.test' },
        reason: 'sanitization test',
      });

      const sensitive = await http(
        'GET',
        '/api/v1/audit-logs?action=user.sensitive_test',
        { token: world.adminToken },
      );
      expect(sensitive.statusCode).toBe(200);
      const row = (sensitive.json().data as { items: Array<Record<string, unknown>> }).items[0]!;
      const before = row.before as Record<string, unknown>;
      expect(before).not.toHaveProperty('passwordHash');
      expect((before.nested as Record<string, unknown>)).not.toHaveProperty('token');
      expect((before.nested as Record<string, unknown>).safe).toBe(1);

      await expect(
        sql`UPDATE audit_logs SET reason = 'tampered' WHERE id = ${row.id}`,
      ).rejects.toThrow();
      const [unchanged] = await db
        .select({ reason: auditLogsTable.reason })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.id, row.id as string));
      expect(unchanged?.reason).toBe('sanitization test');
    });
  });
}
