import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (databaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = 'phase6-test-secret-with-at-least-32-chars';
  process.env.JWT_ISSUER = 'touchline-api';
  process.env.JWT_AUDIENCE = 'touchline-client';
  process.env.ACCESS_TOKEN_TTL = '15m';
  process.env.REFRESH_TOKEN_DAYS = '30';
  process.env.REFRESH_REUSE_GRACE_SECONDS = '2';
  process.env.COOKIE_SECURE = 'false';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.TRUST_PROXY = 'false';
}

const PASSWORD = 'phase6-test-password';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

if (!databaseUrl) {
  describe.skip('phase 6 (requires TEST_DATABASE_URL)', () => {
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
  let getFormation: typeof import('../src/modules/lineups/formations.js')['getFormation'];

  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${++counter}-${randomUUID().slice(0, 6)}`;
  const nextIp = () =>
    `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;

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
      payload: { email, password: PASSWORD, displayName: 'Phase 6 User' },
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

  async function createGroup(token: string, seasonId: string, name: string): Promise<string> {
    const response = await http('POST', `/api/v1/seasons/${seasonId}/groups`, {
      token,
      payload: { name, kind: 'group' },
    });
    expect(response.statusCode).toBe(201);
    return (response.json().data as { id: string }).id;
  }

  interface SquadPlayer {
    playerId: string;
    playerRegistrationId: string;
    shirtNumber: number;
  }

  interface TeamSetup {
    teamId: string;
    registrationId: string;
    captainToken: string;
    squad: SquadPlayer[];
  }

  async function setupTeam(
    adminToken: string,
    seasonId: string,
    name: string,
    options: { groupId?: string; squadSize?: number } = {},
  ): Promise<TeamSetup> {
    const created = await http('POST', '/api/v1/teams', {
      token: adminToken,
      payload: {
        name,
        seasonId,
        ...(options.groupId ? { groupId: options.groupId } : {}),
      },
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

    const squad: SquadPlayer[] = [];
    const squadSize = options.squadSize ?? 15;
    for (let index = 1; index <= squadSize; index += 1) {
      const [player] = await db
        .insert(playersTable)
        .values({
          fullName: `${name} Player ${index}`,
          contactEmail: `${unique('player')}@example.test`,
          dateOfBirth: '2002-01-01',
        })
        .returning({ id: playersTable.id });
      const [registration] = await db
        .insert(playerRegistrationsTable)
        .values({
          playerId: player!.id,
          teamRegistrationId: team.registration.id,
          seasonId,
          status: 'approved',
          eligibilityApproved: true,
          shirtNumber: index,
          matriculationNumber: unique('mat'),
        })
        .returning({ id: playerRegistrationsTable.id });
      squad.push({
        playerId: player!.id,
        playerRegistrationId: registration!.id,
        shirtNumber: index,
      });
    }

    return {
      teamId: team.id,
      registrationId: team.registration.id,
      captainToken: await login(email),
      squad,
    };
  }

  interface World {
    adminToken: string;
    competitionId: string;
    seasonId: string;
    teams: TeamSetup[];
  }

  async function buildWorld(
    teamCount: number,
    visibility: 'public' | 'private' = 'public',
  ): Promise<World> {
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
        scheduledAt: new Date().toISOString(),
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

  async function startMatch(token: string, matchId: string): Promise<void> {
    const response = await http('POST', `/api/v1/matches/${matchId}/start`, {
      token,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
  }

  async function endMatch(token: string, matchId: string): Promise<void> {
    const halfTime = await http('POST', `/api/v1/matches/${matchId}/half-time`, {
      token,
      payload: {},
    });
    expect(halfTime.statusCode).toBe(200);
    const secondHalf = await http('POST', `/api/v1/matches/${matchId}/second-half`, {
      token,
      payload: {},
    });
    expect(secondHalf.statusCode).toBe(200);
    const response = await http('POST', `/api/v1/matches/${matchId}/end`, {
      token,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
  }

  async function submitReport(token: string, matchId: string): Promise<void> {
    const response = await http('POST', `/api/v1/matches/${matchId}/report`, {
      token,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
  }

  interface EventSpec {
    eventType: string;
    teamRegistrationId: string;
    playerRegistrationId?: string;
    secondaryPlayerRegistrationId?: string;
    minute: number;
  }

  async function recordEvent(
    token: string,
    matchId: string,
    spec: EventSpec,
  ): Promise<string> {
    const response = await http('POST', `/api/v1/matches/${matchId}/events`, {
      token,
      payload: { clientEventId: randomUUID(), ...spec },
    });
    expect(response.statusCode).toBe(201);
    return (response.json().data as { event: { id: string } }).event.id;
  }

  interface LineupPlayerPayload {
    playerRegistrationId: string;
    role: 'starter' | 'substitute';
    position: 'GK' | 'DF' | 'MF' | 'FW';
    shirtNumber: number;
    x?: number | null;
    y?: number | null;
    isCaptain?: boolean;
  }

  function buildLineupPlayers(
    team: TeamSetup,
    formationId: string,
    substitutes = 2,
  ): LineupPlayerPayload[] {
    const formation = getFormation(formationId);
    if (!formation) throw new Error(`Unknown formation ${formationId}`);
    const squad = [...team.squad];
    let index = 0;
    const players: LineupPlayerPayload[] = [];
    const goalkeeper = squad[index++]!;
    players.push({
      playerRegistrationId: goalkeeper.playerRegistrationId,
      role: 'starter',
      position: 'GK',
      shirtNumber: goalkeeper.shirtNumber,
      x: formation.goalkeeperSlot.x,
      y: formation.goalkeeperSlot.y,
      isCaptain: true,
    });
    for (const slot of formation.slots) {
      const player = squad[index++]!;
      players.push({
        playerRegistrationId: player.playerRegistrationId,
        role: 'starter',
        position: slot.position,
        shirtNumber: player.shirtNumber,
        x: slot.x,
        y: slot.y,
      });
    }
    for (let taken = 0; taken < substitutes; taken += 1) {
      const player = squad[index++]!;
      players.push({
        playerRegistrationId: player.playerRegistrationId,
        role: 'substitute',
        position: taken === 0 ? 'MF' : 'DF',
        shirtNumber: player.shirtNumber,
      });
    }
    return players;
  }

  async function createLineup(
    token: string,
    matchId: string,
    team: TeamSetup,
    formation: string | null,
    players: LineupPlayerPayload[],
  ) {
    return http('POST', `/api/v1/matches/${matchId}/lineups`, {
      token,
      payload: { teamRegistrationId: team.registrationId, formation, players },
    });
  }

  async function submitLineup(token: string, lineupId: string) {
    return http('POST', `/api/v1/lineups/${lineupId}/submit`, { token, payload: {} });
  }

  async function confirmLineup(token: string, lineupId: string) {
    return http('POST', `/api/v1/lineups/${lineupId}/confirm`, { token, payload: {} });
  }

  async function prepareLineup(
    adminToken: string,
    matchId: string,
    team: TeamSetup,
    formation = '4-3-3',
  ): Promise<string> {
    const created = await createLineup(
      team.captainToken,
      matchId,
      team,
      formation,
      buildLineupPlayers(team, formation),
    );
    expect(created.statusCode).toBe(201);
    const lineupId = (created.json().data as { id: string }).id;
    const submitted = await submitLineup(team.captainToken, lineupId);
    expect(submitted.statusCode).toBe(200);
    const confirmed = await confirmLineup(adminToken, lineupId);
    expect(confirmed.statusCode).toBe(200);
    return lineupId;
  }

  async function playMatch(
    world: World,
    home: TeamSetup,
    away: TeamSetup,
    events: Array<{
      eventType: string;
      side: 'home' | 'away';
      scorerIndex?: number;
      minute: number;
      secondaryIndex?: number;
    }> = [],
    groupId?: string,
  ): Promise<{ match: MatchSetup; eventIds: string[] }> {
    const match = await createFixture(
      world.adminToken,
      world.seasonId,
      home.registrationId,
      away.registrationId,
      groupId ? { groupId } : {},
    );
    await publishFixture(world.adminToken, match.fixtureId);
    await startMatch(world.adminToken, match.matchId);
    const eventIds: string[] = [];
    for (const event of events) {
      const team = event.side === 'home' ? home : away;
      const player = event.scorerIndex === undefined ? undefined : team.squad[event.scorerIndex];
      const secondary =
        event.secondaryIndex === undefined ? undefined : team.squad[event.secondaryIndex];
      eventIds.push(
        await recordEvent(world.adminToken, match.matchId, {
          eventType: event.eventType,
          teamRegistrationId: team.registrationId,
          ...(player ? { playerRegistrationId: player.playerRegistrationId } : {}),
          ...(secondary ? { secondaryPlayerRegistrationId: secondary.playerRegistrationId } : {}),
          minute: event.minute,
        }),
      );
    }
    await endMatch(world.adminToken, match.matchId);
    await submitReport(world.adminToken, match.matchId);
    return { match, eventIds };
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
    ({ getFormation } = await import('../src/modules/lineups/formations.js'));

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

  describe('lineup management', () => {
    it('enforces captain ownership, administrative scope and the full lineup lifecycle', async () => {
      const world = await buildWorld(2);
      const [home, away] = world.teams;
      const match = await createFixture(
        world.adminToken,
        world.seasonId,
        home!.registrationId,
        away!.registrationId,
      );
      await publishFixture(world.adminToken, match.fixtureId);

      const unauthenticated = await createLineup('', match.matchId, home!, null, []);
      expect(unauthenticated.statusCode).toBe(401);

      const draft = await createLineup(home!.captainToken, match.matchId, home!, null, []);
      expect(draft.statusCode).toBe(201);
      const draftId = (draft.json().data as { id: string }).id;
      expect(draft.json().data.status).toBe('draft');

      const crossTeam = await createLineup(
        home!.captainToken,
        match.matchId,
        away!,
        '4-3-3',
        buildLineupPlayers(away!, '4-3-3'),
      );
      expect(crossTeam.statusCode).toBe(403);

      const adminAway = await createLineup(
        world.adminToken,
        match.matchId,
        away!,
        '4-3-3',
        buildLineupPlayers(away!, '4-3-3'),
      );
      expect(adminAway.statusCode).toBe(201);
      const awayLineupId = (adminAway.json().data as { id: string }).id;
      expect((await submitLineup(world.adminToken, awayLineupId)).statusCode).toBe(200);
      expect((await confirmLineup(world.adminToken, awayLineupId)).statusCode).toBe(200);

      const incompleteSubmit = await submitLineup(home!.captainToken, draftId);
      expect(incompleteSubmit.statusCode).toBe(400);

      const valid = buildLineupPlayers(home!, '4-3-3');
      const updated = await http('PATCH', `/api/v1/lineups/${draftId}`, {
        token: home!.captainToken,
        payload: { formation: '4-3-3', players: valid },
      });
      expect(updated.statusCode).toBe(200);

      const submitted = await submitLineup(home!.captainToken, draftId);
      expect(submitted.statusCode).toBe(200);
      expect(submitted.json().data.status).toBe('submitted');

      const captainConfirm = await confirmLineup(home!.captainToken, draftId);
      expect(captainConfirm.statusCode).toBe(403);

      const eligiblePlayer = valid[1]!;
      await db
        .update(playerRegistrationsTable)
        .set({ eligibilityApproved: false })
        .where(eq(playerRegistrationsTable.id, eligiblePlayer.playerRegistrationId));
      const staleConfirm = await confirmLineup(world.adminToken, draftId);
      expect(staleConfirm.statusCode).toBe(409);
      await db
        .update(playerRegistrationsTable)
        .set({ eligibilityApproved: true })
        .where(eq(playerRegistrationsTable.id, eligiblePlayer.playerRegistrationId));

      const confirmed = await confirmLineup(world.adminToken, draftId);
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().data.status).toBe('confirmed');

      const captainCorrection = await http('PATCH', `/api/v1/lineups/${draftId}`, {
        token: home!.captainToken,
        payload: { players: valid },
      });
      expect(captainCorrection.statusCode).toBe(409);

      const anonymousReason = await http('PATCH', `/api/v1/lineups/${draftId}`, {
        token: world.adminToken,
        payload: { players: valid },
      });
      expect(anonymousReason.statusCode).toBe(400);

      const corrected = await http('PATCH', `/api/v1/lineups/${draftId}`, {
        token: world.adminToken,
        payload: {
          players: valid.map((player, index) =>
            index === 0 ? { ...player, isCaptain: true } : player,
          ),
          reason: 'Administrative correction before kickoff',
        },
      });
      expect(corrected.statusCode).toBe(200);

      const [correctionAudit] = await db
        .select({ action: auditLogsTable.action })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, 'lineup.corrected'));
      expect(correctionAudit?.action).toBe('lineup.corrected');

      const bothTeams = await http('GET', `/api/v1/matches/${match.matchId}/lineups`);
      expect(bothTeams.statusCode).toBe(200);
      const publicLineups = bothTeams.json().data as Array<{
        teamRegistrationId: string;
        status: string;
        players: unknown[];
      }>;
      expect(publicLineups.map((row) => row.status)).toEqual(['confirmed', 'confirmed']);
      expect(publicLineups[0]!.players.length).toBe(13);
    });

    it('rejects invalid formations, ineligible or foreign players, duplicate players and incomplete XIs', async () => {
      const world = await buildWorld(2);
      const [home, away] = world.teams;
      const match = await createFixture(
        world.adminToken,
        world.seasonId,
        home!.registrationId,
        away!.registrationId,
      );
      await publishFixture(world.adminToken, match.fixtureId);

      const created = await createLineup(home!.captainToken, match.matchId, home!, null, []);
      const lineupId = (created.json().data as { id: string }).id;

      const invalidFormation = await http('PATCH', `/api/v1/lineups/${lineupId}`, {
        token: home!.captainToken,
        payload: { formation: '9-9' },
      });
      expect(invalidFormation.statusCode).toBe(400);

      const valid = buildLineupPlayers(home!, '4-3-3');
      const foreign = await http('PATCH', `/api/v1/lineups/${lineupId}`, {
        token: home!.captainToken,
        payload: {
          formation: '4-3-3',
          players: valid.map((player, index) =>
            index === 5
              ? {
                  ...player,
                  playerRegistrationId: away!.squad[0]!.playerRegistrationId,
                  shirtNumber: away!.squad[0]!.shirtNumber,
                }
              : player,
          ),
        },
      });
      expect(foreign.statusCode).toBe(400);

      const duplicate = await http('PATCH', `/api/v1/lineups/${lineupId}`, {
        token: home!.captainToken,
        payload: {
          formation: '4-3-3',
          players: valid.map((player, index) =>
            index === 5 ? { ...player, playerRegistrationId: valid[4]!.playerRegistrationId } : player,
          ),
        },
      });
      expect(duplicate.statusCode).toBe(400);

      await db
        .update(playerRegistrationsTable)
        .set({ eligibilityApproved: false })
        .where(
          eq(
            playerRegistrationsTable.id,
            home!.squad[14]!.playerRegistrationId,
          ),
        );

      const unapproved = await http('PATCH', `/api/v1/lineups/${lineupId}`, {
        token: home!.captainToken,
        payload: {
          formation: '4-3-3',
          players: valid.map((player, index) =>
            index === 6
              ? {
                  ...player,
                  playerRegistrationId: home!.squad[14]!.playerRegistrationId,
                  shirtNumber: home!.squad[14]!.shirtNumber,
                }
              : player,
          ),
        },
      });
      expect(unapproved.statusCode).toBe(409);

      const noCaptain = valid.map((player) => ({ ...player, isCaptain: false }));
      const noCaptainDraft = await http('PATCH', `/api/v1/lineups/${lineupId}`, {
        token: home!.captainToken,
        payload: { players: noCaptain },
      });
      expect(noCaptainDraft.statusCode).toBe(200);
      expect((await submitLineup(home!.captainToken, lineupId)).statusCode).toBe(400);

      const twoCaptains = valid.map((player, index) =>
        index === 0 || index === 5 ? { ...player, isCaptain: true } : player,
      );
      const twoCaptainDraft = await http('PATCH', `/api/v1/lineups/${lineupId}`, {
        token: home!.captainToken,
        payload: { players: twoCaptains },
      });
      expect(twoCaptainDraft.statusCode).toBe(409);

      const missingGoalkeeper = valid.map((player) =>
        player.position === 'GK' ? { ...player, position: 'DF' as const } : player,
      );
      const noKeeperDraft = await http('PATCH', `/api/v1/lineups/${lineupId}`, {
        token: home!.captainToken,
        payload: { players: missingGoalkeeper },
      });
      expect(noKeeperDraft.statusCode).toBe(200);
      expect((await submitLineup(home!.captainToken, lineupId)).statusCode).toBe(400);

      const restored = await http('PATCH', `/api/v1/lineups/${lineupId}`, {
        token: home!.captainToken,
        payload: { formation: '4-3-3', players: valid },
      });
      expect(restored.statusCode).toBe(200);
      expect((await submitLineup(home!.captainToken, lineupId)).statusCode).toBe(200);

    });

    it('serialises concurrent lineup creation for the same team and match', async () => {
      const world = await buildWorld(2);
      const [home, away] = world.teams;
      const match = await createFixture(
        world.adminToken,
        world.seasonId,
        home!.registrationId,
        away!.registrationId,
      );
      await publishFixture(world.adminToken, match.fixtureId);
      const payload = {
        teamRegistrationId: home!.registrationId,
        formation: '4-3-3',
        players: buildLineupPlayers(home!, '4-3-3'),
      };
      const [first, second] = await Promise.all([
        http('POST', `/api/v1/matches/${match.matchId}/lineups`, {
          token: home!.captainToken,
          payload,
        }),
        http('POST', `/api/v1/matches/${match.matchId}/lineups`, {
          token: home!.captainToken,
          payload,
        }),
      ]);
      expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
      const [count] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM lineups
        WHERE match_id = ${match.matchId} AND team_registration_id = ${home!.registrationId}
      `;
      expect(count?.count).toBe(1);
    });
  });

  describe('statistics', () => {
    it('derives confirmed player and team statistics, respects own goals, cards and substitutions, and excludes unconfirmed data', async () => {
      const world = await buildWorld(2);
      const [home, away] = world.teams;
      const match = await createFixture(
        world.adminToken,
        world.seasonId,
        home!.registrationId,
        away!.registrationId,
      );
      await publishFixture(world.adminToken, match.fixtureId);
      const homeLineup = await prepareLineup(world.adminToken, match.matchId, home!);
      await prepareLineup(world.adminToken, match.matchId, away!);

      const homePlayers = buildLineupPlayers(home!, '4-3-3');
      const awayPlayers = buildLineupPlayers(away!, '4-3-3');
      const homeGoal = homePlayers[1]!;
      const homePenalty = homePlayers[2]!;
      const homeSentOff = homePlayers[3]!;
      const homeSubOut = homePlayers[4]!;
      const homeSubIn = homePlayers[11]!;
      const homeUnused = homePlayers[12]!;
      const awayOwnGoal = awayPlayers[1]!;
      const awayBooked = awayPlayers[2]!;

      await startMatch(world.adminToken, match.matchId);
      const goalId = await recordEvent(world.adminToken, match.matchId, {
        eventType: 'goal',
        teamRegistrationId: home!.registrationId,
        playerRegistrationId: homeGoal.playerRegistrationId,
        minute: 10,
      });
      await recordEvent(world.adminToken, match.matchId, {
        eventType: 'penalty-scored',
        teamRegistrationId: home!.registrationId,
        playerRegistrationId: homePenalty.playerRegistrationId,
        minute: 20,
      });
      await recordEvent(world.adminToken, match.matchId, {
        eventType: 'own-goal',
        teamRegistrationId: away!.registrationId,
        playerRegistrationId: awayOwnGoal.playerRegistrationId,
        minute: 30,
      });
      await recordEvent(world.adminToken, match.matchId, {
        eventType: 'yellow-card',
        teamRegistrationId: away!.registrationId,
        playerRegistrationId: awayBooked.playerRegistrationId,
        minute: 40,
      });
      await recordEvent(world.adminToken, match.matchId, {
        eventType: 'second-yellow',
        teamRegistrationId: home!.registrationId,
        playerRegistrationId: homeSentOff.playerRegistrationId,
        minute: 50,
      });
      await recordEvent(world.adminToken, match.matchId, {
        eventType: 'substitution',
        teamRegistrationId: home!.registrationId,
        playerRegistrationId: homeSubOut.playerRegistrationId,
        secondaryPlayerRegistrationId: homeSubIn.playerRegistrationId,
        minute: 60,
      });
      const voidedGoalId = await recordEvent(world.adminToken, match.matchId, {
        eventType: 'goal',
        teamRegistrationId: home!.registrationId,
        playerRegistrationId: homePlayers[5]!.playerRegistrationId,
        minute: 70,
      });
      const voidResponse = await http(
        'POST',
        `/api/v1/matches/${match.matchId}/events/${voidedGoalId}/void`,
        { token: world.adminToken, payload: { reason: 'Offside on review' } },
      );
      expect(voidResponse.statusCode).toBe(200);

      await endMatch(world.adminToken, match.matchId);
      await submitReport(world.adminToken, match.matchId);

      const stats = await http('GET', `/api/v1/statistics/players?seasonId=${world.seasonId}`);
      expect(stats.statusCode).toBe(200);
      const rows = stats.json().data as Array<Record<string, unknown>>;
      const byRegistration = new Map(
        rows.map((row) => [row.playerRegistrationId as string, row]),
      );
      expect(byRegistration.get(homeGoal.playerRegistrationId)).toMatchObject({
        goals: 1,
        appearances: 1,
        starts: 1,
      });
      expect(byRegistration.get(homePenalty.playerRegistrationId)).toMatchObject({
        goals: 1,
        penaltyGoals: 1,
      });
      expect(byRegistration.get(awayOwnGoal.playerRegistrationId)).toMatchObject({
        goals: 0,
        ownGoals: 1,
      });
      expect(byRegistration.get(awayBooked.playerRegistrationId)).toMatchObject({
        yellowCards: 1,
        redCards: 0,
      });
      expect(byRegistration.get(homeSentOff.playerRegistrationId)).toMatchObject({
        yellowCards: 0,
        redCards: 1,
      });
      expect(byRegistration.get(homeSubIn.playerRegistrationId)).toMatchObject({
        appearances: 1,
        starts: 0,
        substituteAppearances: 1,
      });
      expect(byRegistration.get(homeUnused.playerRegistrationId)).toBeUndefined();
      expect(byRegistration.get(homeSubOut.playerRegistrationId)).toMatchObject({
        substitutionsMade: 1,
      });
      expect(byRegistration.get(homePlayers[0]!.playerRegistrationId)).toMatchObject({
        cleanSheets: 1,
      });
      expect(byRegistration.get(homePlayers[5]!.playerRegistrationId)).toMatchObject({
        goals: 0,
      });
      expect(JSON.stringify(stats.json())).not.toContain('@example.test');
      expect(JSON.stringify(stats.json())).not.toContain('matriculation');

      const teamStats = await http('GET', `/api/v1/statistics/teams?seasonId=${world.seasonId}`);
      expect(teamStats.statusCode).toBe(200);
      const teamRows = teamStats.json().data as Array<Record<string, unknown>>;
      const homeTeam = teamRows.find(
        (row) => row.teamRegistrationId === home!.registrationId,
      );
      expect(homeTeam).toMatchObject({
        played: 1,
        won: 1,
        drawn: 0,
        lost: 0,
        goalsFor: 3,
        goalsAgainst: 0,
        goalDifference: 3,
        cleanSheets: 1,
        yellowCards: 0,
        redCards: 1,
      });
      const awayTeam = teamRows.find(
        (row) => row.teamRegistrationId === away!.registrationId,
      );
      expect(awayTeam).toMatchObject({
        played: 1,
        lost: 1,
        goalsFor: 0,
        goalsAgainst: 3,
        yellowCards: 1,
        redCards: 0,
      });

      const matchStats = await http(
        'GET',
        `/api/v1/statistics/matches/${match.matchId}`,
      );
      expect(matchStats.statusCode).toBe(200);
      expect(matchStats.json().data).toMatchObject({
        confirmed: true,
        score: { homeScore: 3, awayScore: 0 },
      });

      const unconfirmed = await createFixture(
        world.adminToken,
        world.seasonId,
        away!.registrationId,
        home!.registrationId,
        { round: 300 },
      );
      await publishFixture(world.adminToken, unconfirmed.fixtureId);
      await startMatch(world.adminToken, unconfirmed.matchId);
      const unconfirmedGoal = await recordEvent(world.adminToken, unconfirmed.matchId, {
        eventType: 'goal',
        teamRegistrationId: away!.registrationId,
        playerRegistrationId: away!.squad[14]!.playerRegistrationId,
        minute: 5,
      });
      await endMatch(world.adminToken, unconfirmed.matchId);
      const withDraft = await http(
        'GET',
        `/api/v1/statistics/players?seasonId=${world.seasonId}`,
      );
      const draftRows = withDraft.json().data as Array<Record<string, unknown>>;
      const draftScorer = draftRows.find(
        (row) =>
          row.playerRegistrationId === away!.squad[14]!.playerRegistrationId,
      );
      expect(draftScorer).toBeUndefined();
      void unconfirmedGoal;

      const corrected = await http(
        'PATCH',
        `/api/v1/matches/${match.matchId}/events/${goalId}`,
        {
          token: world.adminToken,
          payload: {
            eventType: 'own-goal',
            reason: 'Scorer correction after review',
          },
        },
      );
      expect(corrected.statusCode).toBe(200);
      expect(corrected.json().data.resultConfirmedAt).toBeNull();
      const reopened = await http(
        'GET',
        `/api/v1/statistics/players?seasonId=${world.seasonId}&matchId=${match.matchId}`,
      );
      expect((reopened.json().data as unknown[]).length).toBe(0);

      await submitReport(world.adminToken, match.matchId);
      const recalculated = await http(
        'GET',
        `/api/v1/statistics/players?seasonId=${world.seasonId}&matchId=${match.matchId}`,
      );
      const recalculatedRows = recalculated.json().data as Array<Record<string, unknown>>;
      const correctedScorer = recalculatedRows.find(
        (row) => row.playerRegistrationId === homeGoal.playerRegistrationId,
      );
      expect(correctedScorer).toMatchObject({ goals: 0, ownGoals: 1 });

      const playerDetail = await http(
        'GET',
        `/api/v1/statistics/players/${home!.squad[1]!.playerId}?seasonId=${world.seasonId}`,
      );
      expect(playerDetail.statusCode).toBe(200);
      const detail = playerDetail.json().data as {
        totals: { ownGoals: number };
        bySeason: Array<{ seasonId: string }>;
      };
      expect(detail.totals.ownGoals).toBeGreaterThanOrEqual(1);
      expect(detail.bySeason[0]?.seasonId).toBe(world.seasonId);

      const rankings = await http(
        'GET',
        `/api/v1/statistics/rankings/players?seasonId=${world.seasonId}&metric=goals`,
      );
      expect(rankings.statusCode).toBe(200);
    });
  });

  describe('standings and snapshots', () => {
    it('calculates confirmed league standings, isolates excluded fixtures, versions snapshots and invalidates on reopening', async () => {
      const world = await buildWorld(4);
      const [alpha, bravo, charlie, delta] = world.teams;

      const ab = await playMatch(world, alpha!, bravo!, [
        { eventType: 'goal', side: 'home', scorerIndex: 0, minute: 10 },
        { eventType: 'goal', side: 'home', scorerIndex: 1, minute: 20 },
      ]);
      await playMatch(world, charlie!, delta!, [
        { eventType: 'goal', side: 'home', scorerIndex: 0, minute: 10 },
        { eventType: 'goal', side: 'away', scorerIndex: 0, minute: 20 },
      ]);
      await playMatch(world, bravo!, charlie!, []);
      await playMatch(world, delta!, alpha!, [
        { eventType: 'goal', side: 'away', scorerIndex: 2, minute: 10 },
        { eventType: 'goal', side: 'away', scorerIndex: 3, minute: 20 },
        { eventType: 'goal', side: 'away', scorerIndex: 4, minute: 30 },
        { eventType: 'goal', side: 'home', scorerIndex: 1, minute: 40 },
      ]);

      const unplayed = await createFixture(
        world.adminToken,
        world.seasonId,
        alpha!.registrationId,
        charlie!.registrationId,
        { round: 50 },
      );
      await publishFixture(world.adminToken, unplayed.fixtureId);

      const postponed = await createFixture(
        world.adminToken,
        world.seasonId,
        bravo!.registrationId,
        delta!.registrationId,
        { round: 51 },
      );
      await publishFixture(world.adminToken, postponed.fixtureId);
      const postpone = await http(
        'POST',
        `/api/v1/fixtures/${postponed.fixtureId}/postpone`,
        { token: world.adminToken, payload: { reason: 'Weather' } },
      );
      expect(postpone.statusCode).toBe(200);

      const cancelled = await createFixture(
        world.adminToken,
        world.seasonId,
        charlie!.registrationId,
        alpha!.registrationId,
        { round: 52 },
      );
      await publishFixture(world.adminToken, cancelled.fixtureId);
      const cancel = await http(
        'POST',
        `/api/v1/fixtures/${cancelled.fixtureId}/cancel`,
        { token: world.adminToken, payload: { reason: 'Withdrawn' } },
      );
      expect(cancel.statusCode).toBe(200);

      const abandonedMatch = await createFixture(
        world.adminToken,
        world.seasonId,
        alpha!.registrationId,
        charlie!.registrationId,
        { round: 53 },
      );
      await publishFixture(world.adminToken, abandonedMatch.fixtureId);
      await startMatch(world.adminToken, abandonedMatch.matchId);
      const abandon = await http(
        'POST',
        `/api/v1/matches/${abandonedMatch.matchId}/abandon`,
        { token: world.adminToken, payload: { reason: 'Floodlight failure' } },
      );
      expect(abandon.statusCode).toBe(200);

      const standings = await http(
        'GET',
        `/api/v1/standings?seasonId=${world.seasonId}`,
      );
      expect(standings.statusCode).toBe(200);
      const rows = standings.json().data.rows as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(4);
      expect(rows[0]).toMatchObject({
        teamRegistrationId: alpha!.registrationId,
        position: 1,
        played: 2,
        won: 2,
        drawn: 0,
        lost: 0,
        goalsFor: 5,
        goalsAgainst: 1,
        goalDifference: 4,
        points: 6,
      });
      expect(rows[1]).toMatchObject({
        teamRegistrationId: charlie!.registrationId,
        played: 2,
        drawn: 2,
        points: 2,
      });
      expect(rows[2]).toMatchObject({
        teamRegistrationId: delta!.registrationId,
        played: 2,
        points: 1,
        goalDifference: -2,
        goalsFor: 2,
      });
      expect(rows[3]).toMatchObject({
        teamRegistrationId: bravo!.registrationId,
        played: 2,
        points: 1,
        goalDifference: -2,
        goalsFor: 0,
      });
      expect((standings.json().data.snapshot as unknown)).toBeNull();

      const snapshot = await http('POST', '/api/v1/standings/snapshots', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, reason: 'Initial publication' },
      });
      expect(snapshot.statusCode).toBe(201);
      const versionOne = snapshot.json().data as { id: string; version: number };
      expect(versionOne.version).toBe(1);

      const current = await http(
        'GET',
        `/api/v1/standings?seasonId=${world.seasonId}`,
      );
      expect(
        (current.json().data.snapshot as { version: number; stale: boolean }).version,
      ).toBe(1);
      expect((current.json().data.snapshot as { stale: boolean }).stale).toBe(false);

      const voidGoal = await http(
        'POST',
        `/api/v1/matches/${ab.match.matchId}/events/${ab.eventIds[0]}/void`,
        { token: world.adminToken, payload: { reason: 'Goal disallowed' } },
      );
      expect(voidGoal.statusCode).toBe(200);

      const reopened = await http(
        'GET',
        `/api/v1/standings?seasonId=${world.seasonId}`,
      );
      expect((reopened.json().data.snapshot as unknown)).toBeNull();
      const reopenedRows = reopened.json().data.rows as Array<Record<string, unknown>>;
      expect(reopenedRows[0]).toMatchObject({
        teamRegistrationId: alpha!.registrationId,
        played: 1,
        points: 3,
      });

      await submitReport(world.adminToken, ab.match.matchId);
      const recalculated = await http('POST', '/api/v1/standings/recalculate', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, reason: 'Goal correction' },
      });
      expect(recalculated.statusCode).toBe(201);
      const versionTwo = recalculated.json().data as { version: number; rows: Array<Record<string, unknown>> };
      expect(versionTwo.version).toBe(2);
      expect(versionTwo.rows[0]).toMatchObject({
        teamRegistrationId: alpha!.registrationId,
        goalsFor: 4,
        goalDifference: 3,
        points: 6,
      });

      const history = await http(
        'GET',
        `/api/v1/standings/snapshots?seasonId=${world.seasonId}`,
      );
      expect(history.statusCode).toBe(200);
      const versions = history.json().data.items as Array<{
        version: number;
        isCurrent: boolean;
        rows: Array<Record<string, unknown>>;
      }>;
      expect(versions.map((row) => row.version)).toEqual([2, 1]);
      expect(versions.filter((row) => row.isCurrent)).toHaveLength(1);
      expect(versions[1]!.rows[0]).toMatchObject({
        teamRegistrationId: alpha!.registrationId,
        goalsFor: 5,
      });

      const [concurrentA, concurrentB] = await Promise.all([
        http('POST', '/api/v1/standings/recalculate', {
          token: world.adminToken,
          payload: { seasonId: world.seasonId, reason: 'Concurrent recalculation A' },
        }),
        http('POST', '/api/v1/standings/recalculate', {
          token: world.adminToken,
          payload: { seasonId: world.seasonId, reason: 'Concurrent recalculation B' },
        }),
      ]);
      expect([concurrentA.statusCode, concurrentB.statusCode].sort()).toEqual([201, 201]);
      const [currentCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM standings_snapshots
        WHERE season_id = ${world.seasonId} AND is_current
      `;
      expect(currentCount?.count).toBe(1);

      const beforeFailure = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM standings_snapshots WHERE season_id = ${world.seasonId}
      `;
      const failed = await http('POST', '/api/v1/standings/snapshots', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, groupId: randomUUID() },
      });
      expect(failed.statusCode).toBe(400);
      const afterFailure = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM standings_snapshots WHERE season_id = ${world.seasonId}
      `;
      expect(afterFailure?.count).toBe(beforeFailure?.count);
    });

    it('uses deterministic name ordering for fully tied teams and isolates groups', async () => {
      const world = await buildWorld(0);
      const groups = await Promise.all([
        createGroup(world.adminToken, world.seasonId, 'Group A'),
        createGroup(world.adminToken, world.seasonId, 'Group B'),
      ]);
      const [groupA, groupB] = groups;
      const alpha = await setupTeam(world.adminToken, world.seasonId, 'Alpha', {
        groupId: groupA,
      });
      const zeta = await setupTeam(world.adminToken, world.seasonId, 'Zeta', {
        groupId: groupA,
      });
      const bravo = await setupTeam(world.adminToken, world.seasonId, 'Bravo', {
        groupId: groupB,
      });
      const delta = await setupTeam(world.adminToken, world.seasonId, 'Delta', {
        groupId: groupB,
      });

      await playMatch(world, zeta, alpha, [], groupA);
      await playMatch(world, bravo, delta, [], groupB);

      const seasonLevel = await http(
        'GET',
        `/api/v1/standings?seasonId=${world.seasonId}`,
      );
      expect(seasonLevel.statusCode).toBe(400);

      const groupAStandings = await http(
        'GET',
        `/api/v1/standings?seasonId=${world.seasonId}&groupId=${groupA}`,
      );
      expect(groupAStandings.statusCode).toBe(200);
      const groupARows = groupAStandings.json().data.rows as Array<Record<string, unknown>>;
      expect(groupARows).toHaveLength(2);
      expect(new Set(groupARows.map((row) => row.teamRegistrationId))).toEqual(
        new Set([alpha.registrationId, zeta.registrationId]),
      );
      expect(groupARows[0]!.teamRegistrationId).toBe(alpha.registrationId);
      expect(groupARows[0]!.points).toBe(1);
      expect(groupARows[1]!.teamRegistrationId).toBe(zeta.registrationId);

      const groupBStandings = await http(
        'GET',
        `/api/v1/standings?seasonId=${world.seasonId}&groupId=${groupB}`,
      );
      const groupBRows = groupBStandings.json().data.rows as Array<Record<string, unknown>>;
      expect(new Set(groupBRows.map((row) => row.teamRegistrationId))).toEqual(
        new Set([bravo.registrationId, delta.registrationId]),
      );

      const snapshotA = await http('POST', '/api/v1/standings/snapshots', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, groupId: groupA },
      });
      const snapshotB = await http('POST', '/api/v1/standings/snapshots', {
        token: world.adminToken,
        payload: { seasonId: world.seasonId, groupId: groupB },
      });
      expect(snapshotA.statusCode).toBe(201);
      expect(snapshotB.statusCode).toBe(201);
      expect((snapshotA.json().data as { version: number }).version).toBe(1);
      expect((snapshotB.json().data as { version: number }).version).toBe(1);
    });
  });
}
