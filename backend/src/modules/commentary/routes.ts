import type { FastifyInstance } from 'fastify';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import { ok } from '../../shared/response.js';
import { requireAuth } from '../../security/plugin.js';
import { idParamsSchema } from '../../shared/validation.js';
import {
  commentaryCreateSchema,
  commentaryUpdateSchema,
  matchOverviewUpdateSchema,
} from './schemas.js';
import {
  createCommentary,
  getMatchOverview,
  listCommentary,
  retractCommentary,
  updateCommentary,
  upsertMatchOverview,
} from './service.js';

const uuidPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const entryParamsSchema = {
  type: 'object',
  required: ['id', 'entryId'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: uuidPattern }, entryId: { type: 'string', pattern: uuidPattern } },
} as const;

export async function commentaryRoutes(app: FastifyInstance) {
  const secure = {
    tags: ['Match commentary'],
    security: [{ bearerAuth: [] }],
    response: { ...successResponse(), ...errorResponse },
  } as const;

  app.get(
    '/matches/:id/commentary',
    {
      preHandler: app.authenticateOptional,
      schema: { ...secure, security: [{ bearerAuth: [] }, {}], summary: 'List match commentary' },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await listCommentary(req.auth ?? null, id));
    },
  );

  app.post(
    '/matches/:id/commentary',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Publish a commentary or key-moment entry',
        ...idParamsSchema,
        body: jsonSchema(commentaryCreateSchema),
        response: { ...successResponse([200, 201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const entry = await createCommentary(requireAuth(req), id, commentaryCreateSchema.parse(req.body));
      return reply.code(201).send({ success: true, data: entry });
    },
  );

  app.patch(
    '/matches/:id/commentary/:entryId',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Correct a commentary entry',
        params: entryParamsSchema,
        body: jsonSchema(commentaryUpdateSchema),
      },
    },
    async (req, reply) => {
      const { id, entryId } = req.params as { id: string; entryId: string };
      return ok(reply, await updateCommentary(
        requireAuth(req),
        id,
        entryId,
        commentaryUpdateSchema.parse(req.body),
      ));
    },
  );

  app.post(
    '/matches/:id/commentary/:entryId/retract',
    {
      preHandler: app.authenticate,
      schema: { ...secure, summary: 'Retract a commentary entry', params: entryParamsSchema },
    },
    async (req, reply) => {
      const { id, entryId } = req.params as { id: string; entryId: string };
      return ok(reply, await retractCommentary(requireAuth(req), id, entryId));
    },
  );

  app.get(
    '/matches/:id/overview',
    {
      preHandler: app.authenticateOptional,
      schema: { ...secure, security: [{ bearerAuth: [] }, {}], summary: 'Read the editorial match overview' },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getMatchOverview(req.auth ?? null, id));
    },
  );

  app.put(
    '/matches/:id/overview',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Update the editorial match overview',
        ...idParamsSchema,
        body: jsonSchema(matchOverviewUpdateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await upsertMatchOverview(
        requireAuth(req),
        id,
        matchOverviewUpdateSchema.parse(req.body),
      ));
    },
  );
}
