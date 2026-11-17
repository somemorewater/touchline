import type { FastifyInstance } from 'fastify';
import { idParamsSchema } from '../../shared/validation.js';
import {
  errorResponse,
  jsonSchema,
  successResponse,
} from '../../shared/schema.js';
import { ok } from '../../shared/response.js';
import {
  approvePlayerRegistration,
  getPlayerRegistration,
  getPlayerRegistrationHistory,
  listPlayerRegistrations,
  rejectPlayerRegistration,
  reviewPlayerRegistration,
  submitPlayerRegistration,
  withdrawPlayerRegistration,
} from './service.js';
import {
  playerRegistrationListQuerySchema,
  playerRegistrationRejectSchema,
  playerRegistrationReviewSchema,
  playerRegistrationSubmitSchema,
} from './schemas.js';

const tags = ['Player registrations'];
const secureSchema = {
  tags,
  security: [{ bearerAuth: [] }],
  response: { ...successResponse([200, 201]), ...errorResponse },
} as const;

export async function registrationRoutes(app: FastifyInstance) {
  app.post(
    '/player-registrations',
    {
      preHandler: app.authenticate,
      schema: {
        ...secureSchema,
        summary: 'Submit a player registration for the captain’s own team',
        body: jsonSchema(playerRegistrationSubmitSchema),
      },
    },
    async (req, reply) => {
      const row = await submitPlayerRegistration(
        req.auth!,
        playerRegistrationSubmitSchema.parse(req.body),
      );
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/player-registrations',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        summary: 'List player registrations visible to the caller',
        security: [{ bearerAuth: [] }],
        querystring: jsonSchema(playerRegistrationListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const filters = playerRegistrationListQuerySchema.parse(req.query);
      return ok(reply, await listPlayerRegistrations(req.auth!, filters));
    },
  );

  app.get(
    '/player-registrations/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        summary: 'Retrieve a player registration',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getPlayerRegistration(req.auth!, id));
    },
  );

  app.get(
    '/player-registrations/:id/history',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        summary: 'Retrieve the registration audit history',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getPlayerRegistrationHistory(req.auth!, id));
    },
  );

  app.post(
    '/player-registrations/:id/review',
    {
      preHandler: app.authenticate,
      schema: {
        ...secureSchema,
        summary: 'Move a submitted registration into administrative review',
        params: idParamsSchema.params,
        body: jsonSchema(playerRegistrationReviewSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await reviewPlayerRegistration(
          req.auth!,
          id,
          playerRegistrationReviewSchema.parse(req.body),
        ),
      );
    },
  );

  app.post(
    '/player-registrations/:id/approve',
    {
      preHandler: app.authenticate,
      schema: {
        ...secureSchema,
        summary: 'Approve a player registration after transactional revalidation',
        params: idParamsSchema.params,
        body: jsonSchema(playerRegistrationReviewSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await approvePlayerRegistration(
          req.auth!,
          id,
          playerRegistrationReviewSchema.parse(req.body),
        ),
      );
    },
  );

  app.post(
    '/player-registrations/:id/reject',
    {
      preHandler: app.authenticate,
      schema: {
        ...secureSchema,
        summary: 'Reject a player registration with a reason',
        params: idParamsSchema.params,
        body: jsonSchema(playerRegistrationRejectSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await rejectPlayerRegistration(
          req.auth!,
          id,
          playerRegistrationRejectSchema.parse(req.body),
        ),
      );
    },
  );

  app.post(
    '/player-registrations/:id/withdraw',
    {
      preHandler: app.authenticate,
      schema: {
        ...secureSchema,
        summary: 'Withdraw a pending registration as its team captain',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await withdrawPlayerRegistration(req.auth!, id));
    },
  );
}
