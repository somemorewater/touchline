import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  fixtures,
  matches,
  matchEvents,
  teamRegistrations,
  teams,
} from '../../database/schema/index.js';
import { ok } from '../../shared/response.js';
import { notFound } from '../../shared/errors.js';
import { idParamsSchema } from '../../shared/validation.js';
import {
  errorResponse,
  jsonSchema,
  successResponse,
} from '../../shared/schema.js';
import {
  canReadMatch,
  canReadPrivateMatch,
  isMatchOfficial,
  isPublicMatch,
  loadMatchScope,
  type MatchScope,
} from '../../security/access.js';
import type { AuthContext } from '../../security/context.js';
import { requireAuth } from '../../security/plugin.js';
import {
  matchClockSchema,
  matchDurationUpdateSchema,
  matchEventCorrectSchema,
  matchEventCreateSchema,
  matchEventVoidSchema,
  matchLifecycleSchema,
  matchOfficialAssignSchema,
  matchOfficialUpdateSchema,
  matchReinstateSchema,
  matchReportSchema,
  matchRescheduleSchema,
  matchResultCorrectSchema,
  matchVenueUpdateSchema,
} from './schemas.js';
import {
  assignMatchOfficial,
  correctMatchResult,
  getMatchResult,
  getMatchResultHistory,
  listMatchOfficials,
  listMatchesForOfficial,
  removeMatchOfficial,
  reinstateMatch,
  rescheduleMatch,
  submitMatchReport,
  transitionMatch,
  updateMatchClock,
  updateMatchDuration,
  updateMatchOfficial,
  updateMatchVenue,
} from './service.js';
import {
  correctMatchEvent,
  createMatchEvent,
  getMatchEvent,
  listMatchEvents,
  voidMatchEvent,
} from './events.js';
import { getLineupsForMatchDetail } from '../lineups/service.js';

const registrationColumns = {
  id: teamRegistrations.id,
  teamId: teamRegistrations.teamId,
  seasonId: teamRegistrations.seasonId,
  groupId: teamRegistrations.groupId,
  status: teamRegistrations.status,
  submittedAt: teamRegistrations.submittedAt,
};

const fixtureColumns = {
  id: fixtures.id,
  seasonId: fixtures.seasonId,
  groupId: fixtures.groupId,
  homeTeamRegistrationId: fixtures.homeTeamRegistrationId,
  awayTeamRegistrationId: fixtures.awayTeamRegistrationId,
  round: fixtures.round,
  scheduledAt: fixtures.scheduledAt,
  venue: fixtures.venue,
  status: fixtures.status,
  publishedAt: fixtures.publishedAt,
  createdAt: fixtures.createdAt,
  updatedAt: fixtures.updatedAt,
};

const matchColumns = {
  id: matches.id,
  fixtureId: matches.fixtureId,
  status: matches.status,
  homeScore: matches.homeScore,
  awayScore: matches.awayScore,
  resultConfirmedAt: matches.resultConfirmedAt,
  confirmedBy: matches.confirmedBy,
  startedAt: matches.startedAt,
  endedAt: matches.endedAt,
  currentMinute: matches.currentMinute,
  addedMinutes: matches.addedMinutes,
  durationMinutes: matches.durationMinutes,
  createdAt: matches.createdAt,
  updatedAt: matches.updatedAt,
};

const eventColumns = {
  id: matchEvents.id,
  matchId: matchEvents.matchId,
  clientEventId: matchEvents.clientEventId,
  eventType: matchEvents.eventType,
  teamRegistrationId: matchEvents.teamRegistrationId,
  playerRegistrationId: matchEvents.playerRegistrationId,
  secondaryPlayerRegistrationId: matchEvents.secondaryPlayerRegistrationId,
  minute: matchEvents.minute,
  addedMinutes: matchEvents.addedMinutes,
  description: matchEvents.description,
  clientTimestamp: matchEvents.clientTimestamp,
  receivedAt: matchEvents.receivedAt,
  voidedAt: matchEvents.voidedAt,
  createdAt: matchEvents.createdAt,
  updatedAt: matchEvents.updatedAt,
};

const uuidPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const eventParamsSchema = {
  params: {
    type: 'object',
    required: ['id', 'eventId'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', pattern: uuidPattern },
      eventId: { type: 'string', pattern: uuidPattern },
    },
  },
} as const;

const officialParamsSchema = {
  params: {
    type: 'object',
    required: ['id', 'userId'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', pattern: uuidPattern },
      userId: { type: 'string', pattern: uuidPattern },
    },
  },
} as const;

const tags = ['Matches'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;

async function canSeePrivateEvents(auth: AuthContext | null, scope: MatchScope): Promise<boolean> {
  if (!auth) return false;
  if (canReadPrivateMatch(auth, scope)) return true;
  return isMatchOfficial(auth.userId, scope.matchId);
}

// Match detail reads use the resource helper imported at the top.

export async function matchRoutes(app: FastifyInstance) {
  app.get(
    '/matches/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve a match with visible events and lineups',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const scope = await loadMatchScope(id);
      if (!scope || !(await canReadMatch(req.auth, scope))) {
        throw notFound('Match not found.');
      }

      const [match] = await db.select(matchColumns).from(matches).where(eq(matches.id, id));
      if (!match) throw notFound('Match not found.');
      const [fixture] = await db
        .select(fixtureColumns)
        .from(fixtures)
        .where(eq(fixtures.id, scope.fixtureId));
      if (!fixture) throw notFound('Match not found.');

      const [homeRegistration] = await db
        .select(registrationColumns)
        .from(teamRegistrations)
        .where(eq(teamRegistrations.id, scope.homeTeamRegistrationId));
      const [awayRegistration] = await db
        .select(registrationColumns)
        .from(teamRegistrations)
        .where(eq(teamRegistrations.id, scope.awayTeamRegistrationId));
      const [homeTeam] = homeRegistration
        ? await db.select().from(teams).where(eq(teams.id, homeRegistration.teamId))
        : [];
      const [awayTeam] = awayRegistration
        ? await db.select().from(teams).where(eq(teams.id, awayRegistration.teamId))
        : [];

      const publicMatch = isPublicMatch(scope);
      const privateEvents = await canSeePrivateEvents(req.auth, scope);
      const events =
        publicMatch || privateEvents
          ? await db
              .select(eventColumns)
              .from(matchEvents)
              .where(
                privateEvents
                  ? eq(matchEvents.matchId, id)
                  : and(eq(matchEvents.matchId, id), isNull(matchEvents.voidedAt)),
              )
              .orderBy(asc(matchEvents.minute), asc(matchEvents.createdAt))
          : [];

      return ok(reply, {
        match: {
          ...match,
          fixture,
          homeTeam: homeTeam ?? null,
          awayTeam: awayTeam ?? null,
          homeRegistration: homeRegistration ?? null,
          awayRegistration: awayRegistration ?? null,
        },
        events,
        lineups: await getLineupsForMatchDetail(req.auth, scope.matchId),
      });
    },
  );

  app.get(
    '/matches/:id/events',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List events visible to the caller',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await listMatchEvents(req.auth, id));
    },
  );

  app.get(
    '/matches/:id/events/:eventId',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve one event',
        ...eventParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id, eventId } = req.params as { id: string; eventId: string };
      return ok(reply, await getMatchEvent(req.auth, id, eventId));
    },
  );

  app.post(
    '/matches/:id/events',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Record a match event idempotently',
        params: idParamsSchema.params,
        body: jsonSchema(matchEventCreateSchema),
        response: { ...successResponse([200, 201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await createMatchEvent(
        requireAuth(req),
        id,
        matchEventCreateSchema.parse(req.body),
      );
      return reply
        .code(result.created ? 201 : 200)
        .send({ success: true, data: result });
    },
  );

  app.patch(
    '/matches/:id/events/:eventId',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Correct a recorded event with an audit reason',
        params: eventParamsSchema.params,
        body: jsonSchema(matchEventCorrectSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id, eventId } = req.params as { id: string; eventId: string };
      return ok(
        reply,
        await correctMatchEvent(
          requireAuth(req),
          id,
          eventId,
          matchEventCorrectSchema.parse(req.body),
        ),
      );
    },
  );

  app.post(
    '/matches/:id/events/:eventId/void',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Void an event while preserving its history',
        params: eventParamsSchema.params,
        body: jsonSchema(matchEventVoidSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id, eventId } = req.params as { id: string; eventId: string };
      return ok(
        reply,
        await voidMatchEvent(requireAuth(req), id, eventId, matchEventVoidSchema.parse(req.body)),
      );
    },
  );

  app.get(
    '/matches/:id/officials',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List assigned match officials',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await listMatchOfficials(req.auth, id));
    },
  );

  app.post(
    '/matches/:id/officials',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Assign an eligible match official',
        params: idParamsSchema.params,
        body: jsonSchema(matchOfficialAssignSchema),
        response: { ...successResponse([201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await assignMatchOfficial(
        requireAuth(req),
        id,
        matchOfficialAssignSchema.parse(req.body),
      );
      return reply.code(201).send({ success: true, data: result });
    },
  );

  app.patch(
    '/matches/:id/officials/:userId',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Update an official assignment',
        params: officialParamsSchema.params,
        body: jsonSchema(matchOfficialUpdateSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      return ok(
        reply,
        await updateMatchOfficial(
          requireAuth(req),
          id,
          userId,
          matchOfficialUpdateSchema.parse(req.body),
        ),
      );
    },
  );

  app.delete(
    '/matches/:id/officials/:userId',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Remove an official assignment before kickoff',
        params: officialParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      return ok(reply, await removeMatchOfficial(requireAuth(req), id, userId));
    },
  );

  app.get(
    '/officials/me/matches',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List matches assigned to the authenticated official',
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const auth = requireAuth(req);
      return ok(reply, await listMatchesForOfficial(auth.userId));
    },
  );

  const transitions: Array<{
    path: string;
    action: Parameters<typeof transitionMatch>[2];
    summary: string;
  }> = [
    { path: 'start', action: 'start', summary: 'Start the match (first half)' },
    { path: 'half-time', action: 'half_time', summary: 'Advance to half time' },
    { path: 'second-half', action: 'second_half', summary: 'Resume for the second half' },
    { path: 'end', action: 'end', summary: 'End the match at full time' },
    { path: 'postpone', action: 'postpone', summary: 'Postpone a scheduled match' },
    { path: 'cancel', action: 'cancel', summary: 'Cancel a scheduled match' },
    { path: 'abandon', action: 'abandon', summary: 'Abandon a match in progress' },
  ];

  for (const transition of transitions) {
    app.post(
      `/matches/:id/${transition.path}`,
      {
        preHandler: app.authenticate,
        schema: {
          ...secure,
          summary: transition.summary,
          params: idParamsSchema.params,
          body: jsonSchema(matchLifecycleSchema),
          response: { ...successResponse(), ...errorResponse },
        },
      },
      async (req, reply) => {
        const { id } = req.params as { id: string };
        return ok(
          reply,
          await transitionMatch(
            requireAuth(req),
            id,
            transition.action,
            matchLifecycleSchema.parse(req.body ?? {}),
          ),
        );
      },
    );
  }

  app.post(
    '/matches/:id/reschedule',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Reschedule a scheduled or postponed match',
        params: idParamsSchema.params,
        body: jsonSchema(matchRescheduleSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await rescheduleMatch(requireAuth(req), id, matchRescheduleSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/matches/:id/reinstate',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Reinstate a cancelled match',
        params: idParamsSchema.params,
        body: jsonSchema(matchReinstateSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await reinstateMatch(requireAuth(req), id),
      );
    },
  );

  app.patch(
    '/matches/:id/venue',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Change the venue of a scheduled match',
        params: idParamsSchema.params,
        body: jsonSchema(matchVenueUpdateSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await updateMatchVenue(requireAuth(req), id, matchVenueUpdateSchema.parse(req.body)),
      );
    },
  );

  app.patch(
    '/matches/:id/duration',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Change the scheduled duration of a match',
        params: idParamsSchema.params,
        body: jsonSchema(matchDurationUpdateSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await updateMatchDuration(requireAuth(req), id, matchDurationUpdateSchema.parse(req.body)),
      );
    },
  );

  app.patch(
    '/matches/:id/clock',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Explicitly update the match clock',
        params: idParamsSchema.params,
        body: jsonSchema(matchClockSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await updateMatchClock(requireAuth(req), id, matchClockSchema.parse(req.body)),
      );
    },
  );

  app.get(
    '/matches/:id/result',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve the result with persisted and derived scores',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getMatchResult(req.auth, id));
    },
  );

  app.get(
    '/matches/:id/result/history',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Read the audited result history',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getMatchResultHistory(requireAuth(req), id));
    },
  );

  app.post(
    '/matches/:id/report',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Submit the full-time match report',
        params: idParamsSchema.params,
        body: jsonSchema(matchReportSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await submitMatchReport(
          requireAuth(req),
          id,
          matchReportSchema.parse(req.body ?? {}),
        ),
      );
    },
  );

  app.post(
    '/matches/:id/result/correct',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Correct and re-confirm a full-time result (administrative)',
        params: idParamsSchema.params,
        body: jsonSchema(matchResultCorrectSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await correctMatchResult(
          requireAuth(req),
          id,
          matchResultCorrectSchema.parse(req.body),
        ),
      );
    },
  );

}
