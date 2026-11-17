import type { FastifyInstance } from 'fastify';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import { ok } from '../../shared/response.js';
import {
  createStandingsSnapshot,
  getStandings,
  getStandingsSnapshot,
  listStandingsSnapshots,
  previewStandings,
  recalculateStandings,
} from './service.js';
import {
  standingsHistoryQuerySchema,
  standingsQuerySchema,
  standingsRecalculateSchema,
  standingsSnapshotCreateSchema,
} from './schemas.js';

const tags = ['Standings'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;

export async function standingsRoutes(app: FastifyInstance) {
  app.get(
    '/standings',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve live standings with current snapshot metadata',
        querystring: jsonSchema(standingsQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const query = standingsQuerySchema.parse(req.query);
      return ok(reply, await getStandings(req.auth, query));
    },
  );

  app.post(
    '/standings/calculate',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Preview standings without publishing a snapshot',
        body: jsonSchema(standingsQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const input = standingsQuerySchema.parse(req.body);
      return ok(reply, await previewStandings(req.auth!, input));
    },
  );

  app.post(
    '/standings/snapshots',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Publish a new immutable standings snapshot version',
        body: jsonSchema(standingsSnapshotCreateSchema),
        response: { ...successResponse([201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const input = standingsSnapshotCreateSchema.parse(req.body);
      const snapshot = await createStandingsSnapshot(req.auth!, input);
      return reply.code(201).send({ success: true, data: snapshot });
    },
  );

  app.post(
    '/standings/recalculate',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Recalculate standings and advance the snapshot version',
        body: jsonSchema(standingsRecalculateSchema),
        response: { ...successResponse([201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const input = standingsRecalculateSchema.parse(req.body);
      const snapshot = await recalculateStandings(req.auth!, input);
      return reply.code(201).send({ success: true, data: snapshot });
    },
  );

  app.get(
    '/standings/snapshots',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List historical standings snapshot versions',
        querystring: jsonSchema(standingsHistoryQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const query = standingsHistoryQuerySchema.parse(req.query);
      return ok(reply, await listStandingsSnapshots(req.auth, query));
    },
  );

  app.get(
    '/standings/snapshots/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve one standings snapshot version',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getStandingsSnapshot(req.auth, id));
    },
  );
}
