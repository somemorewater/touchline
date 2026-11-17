import type { FastifyInstance } from 'fastify';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import { ok } from '../../shared/response.js';
import {
  cancelFixture,
  createFixture,
  generateFixtures,
  getFixture,
  listFixtures,
  postponeFixture,
  previewGeneratedFixtures,
  publishFixture,
  rescheduleFixture,
  unpublishFixture,
  updateFixture,
} from './service.js';
import {
  fixtureCreateSchema,
  fixtureGenerationSchema,
  fixtureLifecycleSchema,
  fixtureListQuerySchema,
  fixtureRescheduleSchema,
  fixtureUpdateSchema,
} from './schemas.js';

const tags = ['Fixtures'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;

export async function fixtureRoutes(app: FastifyInstance) {
  app.post(
    '/fixtures',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Create a draft fixture and its match record',
        body: jsonSchema(fixtureCreateSchema),
        response: { ...successResponse([201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const result = await createFixture(req.auth!, fixtureCreateSchema.parse(req.body));
      return reply.code(201).send({ success: true, data: result });
    },
  );

  app.get(
    '/fixtures',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List fixtures visible to the caller',
        querystring: jsonSchema(fixtureListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const filters = fixtureListQuerySchema.parse(req.query);
      return ok(reply, await listFixtures(req.auth, filters));
    },
  );

  app.post(
    '/fixtures/generate/preview',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Preview a round-robin schedule without writing fixtures',
        body: jsonSchema(fixtureGenerationSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const input = fixtureGenerationSchema.parse(req.body);
      return ok(reply, await previewGeneratedFixtures(req.auth!, input));
    },
  );

  app.post(
    '/fixtures/generate',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Transactionally generate a round-robin schedule',
        body: jsonSchema(fixtureGenerationSchema),
        response: { ...successResponse([201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const input = fixtureGenerationSchema.parse(req.body);
      const result = await generateFixtures(req.auth!, input);
      return reply.code(201).send({ success: true, data: result });
    },
  );

  app.get(
    '/fixtures/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve a fixture',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getFixture(req.auth, id));
    },
  );

  app.patch(
    '/fixtures/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Update fixture details',
        params: idParamsSchema.params,
        body: jsonSchema(fixtureUpdateSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await updateFixture(req.auth!, id, fixtureUpdateSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/fixtures/:id/publish',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Publish a draft fixture',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await publishFixture(req.auth!, id));
    },
  );

  app.post(
    '/fixtures/:id/unpublish',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Return a published fixture to draft',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await unpublishFixture(req.auth!, id));
    },
  );

  app.post(
    '/fixtures/:id/postpone',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Postpone a scheduled fixture and its match',
        params: idParamsSchema.params,
        body: jsonSchema(fixtureLifecycleSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await postponeFixture(req.auth!, id, fixtureLifecycleSchema.parse(req.body ?? {})),
      );
    },
  );

  app.post(
    '/fixtures/:id/reschedule',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Reschedule a fixture to a new kickoff time',
        params: idParamsSchema.params,
        body: jsonSchema(fixtureRescheduleSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await rescheduleFixture(req.auth!, id, fixtureRescheduleSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/fixtures/:id/cancel',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Cancel a fixture and its match',
        params: idParamsSchema.params,
        body: jsonSchema(fixtureLifecycleSchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await cancelFixture(req.auth!, id, fixtureLifecycleSchema.parse(req.body ?? {})),
      );
    },
  );
}
