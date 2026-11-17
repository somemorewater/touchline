import type { FastifyInstance } from 'fastify';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import { ok } from '../../shared/response.js';
import {
  getMatchStatistics,
  getPlayerRankings,
  getPlayerStatistics,
  getPlayerStatisticsDetail,
  getTeamStatistics,
} from './service.js';
import {
  playerRankingsQuerySchema,
  playerStatisticsQuerySchema,
  teamStatisticsQuerySchema,
} from './schemas.js';

const tags = ['Statistics'];

export async function statisticsRoutes(app: FastifyInstance) {
  app.get(
    '/statistics/players',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List player statistics derived from confirmed results and lineups',
        querystring: jsonSchema(playerStatisticsQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const filter = playerStatisticsQuerySchema.parse(req.query);
      return ok(reply, await getPlayerStatistics(req.auth, filter));
    },
  );

  app.get(
    '/statistics/players/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve a player’s career, season and per-team statistics',
        ...idParamsSchema,
        querystring: jsonSchema(playerStatisticsQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const filter = playerStatisticsQuerySchema.parse(req.query);
      const detailFilter = { ...filter, playerId: id };
      delete detailFilter.playerRegistrationId;
      return ok(
        reply,
        await getPlayerStatisticsDetail(req.auth, id, detailFilter),
      );
    },
  );

  app.get(
    '/statistics/teams',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List team statistics derived from confirmed results and events',
        querystring: jsonSchema(teamStatisticsQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const filter = teamStatisticsQuerySchema.parse(req.query);
      return ok(reply, await getTeamStatistics(req.auth, filter));
    },
  );

  app.get(
    '/statistics/matches/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve confirmed match statistics for both teams',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getMatchStatistics(req.auth, id));
    },
  );

  app.get(
    '/statistics/rankings/players',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Rank players by a supported confirmed-result metric',
        querystring: jsonSchema(playerRankingsQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const query = playerRankingsQuerySchema.parse(req.query);
      return ok(reply, await getPlayerRankings(req.auth, query));
    },
  );
}
