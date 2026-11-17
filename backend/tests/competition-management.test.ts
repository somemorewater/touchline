import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (databaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = 'phase4-test-secret-with-at-least-32-chars';
  process.env.JWT_ISSUER = 'touchline-api';
  process.env.JWT_AUDIENCE = 'touchline-client';
  process.env.ACCESS_TOKEN_TTL = '15m';
  process.env.REFRESH_TOKEN_DAYS = '30';
  process.env.REFRESH_REUSE_GRACE_SECONDS = '2';
  process.env.COOKIE_SECURE = 'false';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.TRUST_PROXY = 'false';
}

const PASSWORD = 'phase4-test-password';

if (!databaseUrl) {
  describe.skip('competition management (requires TEST_DATABASE_URL)', () => {
    it('is skipped without an isolated database', () => {
      expect(true).toBe(true);
    });
  });
} else {
  type Db = (typeof import('../src/database/client.js'))['db'];
  type Sql = (typeof import('../src/database/client.js'))['sql'];

  let app: FastifyInstance;
  let db: Db;
  let sql: Sql;

  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${++counter}`;
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
      payload: { email, password: PASSWORD, displayName: 'Phase 4 User' },
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
    await db.insert(userRolesTable).values({
      userId,
      roleId: role.id,
      competitionId,
    });
  }

  let rolesTable: typeof import('../src/database/schema/index.js')['roles'];
  let userRolesTable: typeof import('../src/database/schema/index.js')['userRoles'];

  async function createSuperAdmin(): Promise<string> {
    const email = `${unique('super')}@example.test`;
    const id = await register(email);
    await grantRole(id, 'super_admin');
    return login(email);
  }

  interface Setup {
    competitionId: string;
    seasonId: string;
    teamRegistrationId: string;
    teamId: string;
    captainEmail: string;
    captainToken: string;
  }

  async function setupTeam(
    adminToken: string,
    seasonId: string,
    name: string,
    email: string,
  ): Promise<Setup> {
    const created = await http('POST', '/api/v1/teams', {
      token: adminToken,
      payload: { name, seasonId },
    });
    expect(created.statusCode).toBe(201);
    const team = created.json().data as {
      id: string;
      registration: { id: string };
    };
    const approved = await http(
      'PATCH',
      `/api/v1/team-entries/${team.registration.id}`,
      { token: adminToken, payload: { status: 'approved' } },
    );
    expect(approved.statusCode).toBe(200);

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

    const [competition] = await sql<{ competition_id: string }[]>`
      SELECT competition_id FROM seasons WHERE id = ${seasonId}
    `;
    return {
      competitionId: competition!.competition_id,
      seasonId,
      teamRegistrationId: team.registration.id,
      teamId: team.id,
      captainEmail: email,
      captainToken: await login(email),
    };
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
    return (response.json().data as { id: string }).id;
  }

  async function createSeason(token: string, competitionId: string): Promise<string> {
    const response = await http(
      'POST',
      `/api/v1/competitions/${competitionId}/seasons`,
      {
        token,
        payload: { label: unique('Season') },
      },
    );
    expect(response.statusCode).toBe(201);
    return (response.json().data as { id: string }).id;
  }

  beforeAll(async () => {
    const client = await import('../src/database/client.js');
    db = client.db;
    sql = client.sql;
    const schema = await import('../src/database/schema/index.js');
    rolesTable = schema.roles;
    userRolesTable = schema.userRoles;

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

  describe('competition and season administration', () => {
    it('lets only a super admin create competitions and keeps scoped admins inside their scope', async () => {
      const superToken = await createSuperAdmin();
      const competitionA = await createCompetition(superToken);
      const competitionB = await createCompetition(superToken);
      const adminEmail = `${unique('admin')}@example.test`;

      const account = await http('POST', '/api/v1/admin-accounts', {
        token: superToken,
        payload: {
          email: adminEmail,
          password: PASSWORD,
          displayName: 'Competition Admin',
          role: 'competition_admin',
          competitionIds: [competitionA],
        },
      });
      expect(account.statusCode).toBe(201);
      const accountData = account.json().data as Record<string, unknown>;
      expect(accountData).not.toHaveProperty('passwordHash');
      expect(accountData).not.toHaveProperty('password');

      const adminToken = await login(adminEmail);
      const createAsAdmin = await http('POST', '/api/v1/competitions', {
        token: adminToken,
        payload: { slug: unique('blocked').toLowerCase(), name: 'Blocked' },
      });
      expect(createAsAdmin.statusCode).toBe(403);

      const updateOwn = await http(
        'PATCH',
        `/api/v1/competitions/${competitionA}`,
        { token: adminToken, payload: { name: 'Scoped Update' } },
      );
      expect(updateOwn.statusCode).toBe(200);

      const updateOther = await http(
        'PATCH',
        `/api/v1/competitions/${competitionB}`,
        { token: adminToken, payload: { name: 'Cross Scope' } },
      );
      expect(updateOther.statusCode).toBe(404);

      const createAdminAsAdmin = await http('POST', '/api/v1/admin-accounts', {
        token: adminToken,
        payload: {
          email: `${unique('escalate')}@example.test`,
          password: PASSWORD,
          displayName: 'Escalation',
          role: 'competition_admin',
          competitionIds: [competitionA],
        },
      });
      expect(createAdminAsAdmin.statusCode).toBe(403);
    });

    it('enforces season lifecycle transitions', async () => {
      const superToken = await createSuperAdmin();
      const competitionId = await createCompetition(superToken);
      const seasonId = await createSeason(superToken, competitionId);

      const activate = await http('POST', `/api/v1/seasons/${seasonId}/activate`, {
        token: superToken,
      });
      expect(activate.statusCode).toBe(200);

      const archive = await http('POST', `/api/v1/seasons/${seasonId}/archive`, {
        token: superToken,
      });
      expect(archive.statusCode).toBe(200);

      const reopen = await http('POST', `/api/v1/seasons/${seasonId}/activate`, {
        token: superToken,
      });
      expect(reopen.statusCode).toBe(409);

      const publish = await http(
        'POST',
        `/api/v1/competitions/${competitionId}/publish`,
        { token: superToken },
      );
      expect(publish.statusCode).toBe(200);
      const archiveCompetition = await http(
        'POST',
        `/api/v1/competitions/${competitionId}/archive`,
        { token: superToken },
      );
      expect(archiveCompetition.statusCode).toBe(200);
      const updateArchived = await http(
        'PATCH',
        `/api/v1/competitions/${competitionId}`,
        { token: superToken, payload: { name: 'Too Late' } },
      );
      expect(updateArchived.statusCode).toBe(409);
    });
  });

  describe('teams and captain provisioning', () => {
    it('creates teams in scope, rejects captains, and rolls back failed captain provisioning', async () => {
      const superToken = await createSuperAdmin();
      const competitionId = await createCompetition(superToken);
      const adminEmail = `${unique('admin')}@example.test`;
      await http('POST', '/api/v1/admin-accounts', {
        token: superToken,
        payload: {
          email: adminEmail,
          password: PASSWORD,
          displayName: 'Team Admin',
          role: 'competition_admin',
          competitionIds: [competitionId],
        },
      });
      const adminToken = await login(adminEmail);
      const seasonId = await createSeason(adminToken, competitionId);
      const setup = await setupTeam(
        adminToken,
        seasonId,
        unique('Team'),
        `${unique('captain')}@example.test`,
      );

      const captainCreate = await http('POST', '/api/v1/teams', {
        token: setup.captainToken,
        payload: { name: unique('Captain Team'), seasonId },
      });
      expect(captainCreate.statusCode).toBe(404);

      const duplicateEmail = `${unique('rollback')}@example.test`;
      const second = await http('POST', '/api/v1/captains', {
        token: adminToken,
        payload: {
          email: duplicateEmail,
          password: PASSWORD,
          displayName: 'Rollback Captain',
          teamRegistrationId: setup.teamRegistrationId,
        },
      });
      expect(second.statusCode).toBe(409);
      const [orphan] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM users WHERE email = ${duplicateEmail}
      `;
      expect(orphan?.count).toBe(0);
    });

    it('prevents a captain from reading another team entry', async () => {
      const superToken = await createSuperAdmin();
      const competitionId = await createCompetition(superToken);
      const seasonId = await createSeason(superToken, competitionId);
      const first = await setupTeam(
        superToken,
        seasonId,
        unique('Team'),
        `${unique('captain')}@example.test`,
      );
      const second = await setupTeam(
        superToken,
        seasonId,
        unique('Team'),
        `${unique('captain')}@example.test`,
      );

      const own = await http(
        'GET',
        `/api/v1/team-entries/${first.teamRegistrationId}`,
        { token: first.captainToken },
      );
      expect(own.statusCode).toBe(200);

      const other = await http(
        'GET',
        `/api/v1/team-entries/${second.teamRegistrationId}`,
        { token: first.captainToken },
      );
      expect(other.statusCode).toBe(404);
    });
  });

  describe('player registration lifecycle', () => {
    it('lets only the assigned captain submit and only administrators review', async () => {
      const superToken = await createSuperAdmin();
      const competitionId = await createCompetition(superToken);
      const seasonId = await createSeason(superToken, competitionId);
      const first = await setupTeam(
        superToken,
        seasonId,
        unique('Team'),
        `${unique('captain')}@example.test`,
      );
      const second = await setupTeam(
        superToken,
        seasonId,
        unique('Team'),
        `${unique('captain')}@example.test`,
      );

      const submit = await http('POST', '/api/v1/player-registrations', {
        token: first.captainToken,
        payload: {
          teamRegistrationId: first.teamRegistrationId,
          player: { fullName: unique('Player'), position: 'MF' },
          matriculationNumber: 'MAT-001',
          shirtNumber: 7,
        },
      });
      expect(submit.statusCode).toBe(201);
      const registration = submit.json().data as {
        id: string;
        status: string;
        player: { id: string };
      };
      expect(registration.status).toBe('submitted');

      const crossTeam = await http('POST', '/api/v1/player-registrations', {
        token: first.captainToken,
        payload: {
          teamRegistrationId: second.teamRegistrationId,
          player: { fullName: unique('Player') },
        },
      });
      expect(crossTeam.statusCode).toBe(403);

      const captainApprove = await http(
        'POST',
        `/api/v1/player-registrations/${registration.id}/approve`,
        { token: first.captainToken, payload: {} },
      );
      expect(captainApprove.statusCode).toBe(403);

      const adminApprove = await http(
        'POST',
        `/api/v1/player-registrations/${registration.id}/approve`,
        { token: superToken, payload: { reviewNote: 'Eligible' } },
      );
      expect(adminApprove.statusCode).toBe(200);
      expect((adminApprove.json().data as { status: string }).status).toBe(
        'approved',
      );
    });

    it('rejects duplicate active players and matriculation numbers', async () => {
      const superToken = await createSuperAdmin();
      const competitionId = await createCompetition(superToken);
      const seasonId = await createSeason(superToken, competitionId);
      const first = await setupTeam(
        superToken,
        seasonId,
        unique('Team'),
        `${unique('captain')}@example.test`,
      );
      const second = await setupTeam(
        superToken,
        seasonId,
        unique('Team'),
        `${unique('captain')}@example.test`,
      );

      const submit = await http('POST', '/api/v1/player-registrations', {
        token: first.captainToken,
        payload: {
          teamRegistrationId: first.teamRegistrationId,
          player: { fullName: unique('Player') },
          matriculationNumber: 'MAT-DUPLICATE',
        },
      });
      expect(submit.statusCode).toBe(201);
      const playerId = (submit.json().data as { player: { id: string } }).player.id;

      const duplicatePlayer = await http('POST', '/api/v1/player-registrations', {
        token: second.captainToken,
        payload: {
          teamRegistrationId: second.teamRegistrationId,
          playerId,
        },
      });
      expect(duplicatePlayer.statusCode).toBe(409);

      const duplicateMatriculation = await http(
        'POST',
        '/api/v1/player-registrations',
        {
          token: second.captainToken,
          payload: {
            teamRegistrationId: second.teamRegistrationId,
            player: { fullName: unique('Player') },
            matriculationNumber: 'MAT-DUPLICATE',
          },
        },
      );
      expect(duplicateMatriculation.statusCode).toBe(409);
    });

    it('preserves rejected history, supports resubmission, revalidates on approval and serializes concurrent decisions', async () => {
      const superToken = await createSuperAdmin();
      const competitionId = await createCompetition(superToken);
      const seasonId = await createSeason(superToken, competitionId);
      const setup = await setupTeam(
        superToken,
        seasonId,
        unique('Team'),
        `${unique('captain')}@example.test`,
      );

      const submit = await http('POST', '/api/v1/player-registrations', {
        token: setup.captainToken,
        payload: {
          teamRegistrationId: setup.teamRegistrationId,
          player: { fullName: unique('Player') },
          matriculationNumber: 'MAT-HISTORY',
        },
      });
      expect(submit.statusCode).toBe(201);
      const registration = submit.json().data as {
        id: string;
        player: { id: string };
      };

      const reject = await http(
        'POST',
        `/api/v1/player-registrations/${registration.id}/reject`,
        {
          token: superToken,
          payload: { reason: 'Documentation incomplete' },
        },
      );
      expect(reject.statusCode).toBe(200);
      expect((reject.json().data as { status: string }).status).toBe('rejected');
      expect((reject.json().data as { reviewNote: string }).reviewNote).toBe(
        'Documentation incomplete',
      );

      const historyAfterReject = await http(
        'GET',
        `/api/v1/player-registrations/${registration.id}/history`,
        { token: setup.captainToken },
      );
      expect(historyAfterReject.statusCode).toBe(200);
      expect((historyAfterReject.json().data as unknown[]).length).toBe(2);

      const resubmit = await http('POST', '/api/v1/player-registrations', {
        token: setup.captainToken,
        payload: {
          teamRegistrationId: setup.teamRegistrationId,
          playerId: registration.player.id,
          matriculationNumber: 'MAT-HISTORY',
        },
      });
      expect(resubmit.statusCode).toBe(201);
      expect((resubmit.json().data as { id: string }).id).toBe(registration.id);
      expect((resubmit.json().data as { status: string }).status).toBe('submitted');

      await sql`UPDATE seasons SET status = 'completed' WHERE id = ${seasonId}`;
      const blocked = await http(
        'POST',
        `/api/v1/player-registrations/${registration.id}/approve`,
        { token: superToken, payload: {} },
      );
      expect(blocked.statusCode).toBe(409);

      await sql`UPDATE seasons SET status = 'active' WHERE id = ${seasonId}`;
      const [firstApproval, secondApproval] = await Promise.all([
        http('POST', `/api/v1/player-registrations/${registration.id}/approve`, {
          token: superToken,
          payload: {},
        }),
        http('POST', `/api/v1/player-registrations/${registration.id}/approve`, {
          token: superToken,
          payload: {},
        }),
      ]);
      expect(
        [firstApproval.statusCode, secondApproval.statusCode].sort(),
      ).toEqual([200, 409]);

      const history = await http(
        'GET',
        `/api/v1/player-registrations/${registration.id}/history`,
        { token: setup.captainToken },
      );
      expect(history.statusCode).toBe(200);
      expect((history.json().data as unknown[]).length).toBeGreaterThanOrEqual(4);
    });

    it('blocks cross-competition review while allowing a super admin to review globally', async () => {
      const superToken = await createSuperAdmin();
      const competitionA = await createCompetition(superToken);
      const competitionB = await createCompetition(superToken);
      const adminEmail = `${unique('admin')}@example.test`;
      await http('POST', '/api/v1/admin-accounts', {
        token: superToken,
        payload: {
          email: adminEmail,
          password: PASSWORD,
          displayName: 'Scoped Admin',
          role: 'competition_admin',
          competitionIds: [competitionA],
        },
      });
      const adminToken = await login(adminEmail);

      const seasonB = await createSeason(superToken, competitionB);
      const registration = await sql<{ id: string }[]>`
        WITH team AS (
          INSERT INTO teams (name) VALUES (${unique('External Team')}) RETURNING id
        ), entry AS (
          INSERT INTO team_registrations (team_id, season_id, status)
          SELECT id, ${seasonB}, 'approved' FROM team
          RETURNING id
        ), player AS (
          INSERT INTO players (full_name) VALUES (${unique('External Player')})
          RETURNING id
        )
        INSERT INTO player_registrations
          (player_id, team_registration_id, season_id, status, submitted_at)
        SELECT player.id, entry.id, ${seasonB}, 'submitted', now()
        FROM player, entry
        RETURNING id
      `;
      const registrationId = registration[0]!.id;

      const blocked = await http(
        'POST',
        `/api/v1/player-registrations/${registrationId}/approve`,
        { token: adminToken, payload: {} },
      );
      expect(blocked.statusCode).toBe(403);

      const approved = await http(
        'POST',
        `/api/v1/player-registrations/${registrationId}/approve`,
        { token: superToken, payload: {} },
      );
      expect(approved.statusCode).toBe(200);

      const list = await http(
        'GET',
        `/api/v1/player-registrations?competitionId=${competitionA}`,
        { token: adminToken },
      );
      expect(list.statusCode).toBe(200);
      expect(list.json().data).toEqual([]);
    });
  });
}
