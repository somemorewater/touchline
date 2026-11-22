import type { FastifyInstance } from 'fastify';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import { ok } from '../../shared/response.js';
import { notFound } from '../../shared/errors.js';
import { loadMatchScope } from '../../security/access.js';
import { listFormations } from './formations.js';
import {
  confirmLineup,
  createLineup,
  getLineup,
  getMatchLineups,
  listLineupHistory,
  returnLineup,
  submitLineup,
  updateLineup,
  withdrawLineup,
} from './service.js';
import {
  lineupCreateSchema,
  lineupHistoryQuerySchema,
  lineupListQuerySchema,
  lineupReturnSchema,
  lineupReviewSchema,
  lineupUpdateSchema,
} from './schemas.js';

const tags = ['Lineups'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;

export async function lineupRoutes(app: FastifyInstance) {
  app.get(
    '/lineups/formations',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List supported tactical formations and their pitch slots',
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (_req, reply) =>
      ok(
        reply,
        listFormations().map((formation) => ({
          id: formation.id,
          segments: formation.segments,
          goalkeeper: formation.goalkeeperSlot,
          outfieldSlots: formation.slots,
        })),
      ),
  );

  app.get(
    '/lineups',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List lineup history visible to the caller',
        querystring: jsonSchema(lineupListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const query = lineupListQuerySchema.parse(req.query);
      return ok(reply, await listLineupHistory(req.auth!, query));
    },
  );

  app.post(
    '/matches/:id/lineups',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Create a draft lineup for a participating team',
        ...idParamsSchema,
        body: jsonSchema(lineupCreateSchema),
        response: { ...successResponse([201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const input = lineupCreateSchema.parse(req.body);
      const lineup = await createLineup(
        req.auth!,
        id,
        input.teamRegistrationId,
        input.formation ?? null,
        input.players,
      );
      return reply.code(201).send({ success: true, data: lineup });
    },
  );

  app.get(
    '/matches/:id/lineups',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List both teams’ lineups visible to the caller',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!(await loadMatchScope(id))) throw notFound('Match not found.');
      return ok(reply, await getMatchLineups(req.auth, id));
    },
  );

  app.get(
    '/lineups/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve a lineup',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getLineup(req.auth, id));
    },
  );

  app.patch(
    '/lineups/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Update a lineup, with audited administrative corrections',
        ...idParamsSchema,
        body: jsonSchema(lineupUpdateSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const input = lineupUpdateSchema.parse(req.body);
      return ok(
        reply,
        await updateLineup(req.auth!, id, {
          ...(input.formation !== undefined ? { formation: input.formation } : {}),
          ...(input.players !== undefined ? { players: input.players } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        }),
      );
    },
  );

  app.post(
    '/lineups/:id/submit',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Submit a complete lineup for review',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      // Submission has no required request body. Keep runtime validation for
      // an optional reason here; Fastify's body schema rejects an absent body
      // before this intentional empty-object default can be applied.
      const input = lineupReviewSchema.parse(req.body ?? {});
      return ok(reply, await submitLineup(req.auth!, id, input.reason));
    },
  );

  app.post(
    '/lineups/:id/confirm',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Confirm a submitted lineup after eligibility revalidation',
        ...idParamsSchema,
        body: jsonSchema(lineupReviewSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const input = lineupReviewSchema.parse(req.body ?? {});
      return ok(reply, await confirmLineup(req.auth!, id, input.reason));
    },
  );

  app.post(
    '/lineups/:id/return',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Return a lineup to the team for correction',
        ...idParamsSchema,
        body: jsonSchema(lineupReturnSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const input = lineupReturnSchema.parse(req.body);
      return ok(reply, await returnLineup(req.auth!, id, input.reason));
    },
  );

  app.post(
    '/lineups/:id/withdraw',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Withdraw a lineup and return it to draft',
        ...idParamsSchema,
        body: jsonSchema(lineupReviewSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const input = lineupReviewSchema.parse(req.body ?? {});
      return ok(reply, await withdrawLineup(req.auth!, id, input.reason));
    },
  );

  app.get(
    '/team-entries/:id/lineups',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Retrieve a team entry’s lineup history',
        ...idParamsSchema,
        querystring: jsonSchema(lineupHistoryQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const query = lineupHistoryQuerySchema.parse(req.query);
      return ok(reply, await listLineupHistory(req.auth!, { ...query, teamRegistrationId: id }));
    },
  );
}
