import type { FastifyInstance } from 'fastify';
import { idParamsSchema } from '../../shared/validation.js';
import {
  errorResponse,
  jsonSchema,
  successResponse,
} from '../../shared/schema.js';
import { ok } from '../../shared/response.js';
import {
  assignCompetitionAdmin,
  createAdminAccount,
  listAdminAccounts,
  revokeCompetitionAdmin,
} from './service.js';
import {
  adminAccountCreateSchema,
  adminCompetitionAssignmentSchema,
  adminListQuerySchema,
} from './schemas.js';

const tags = ['Administrator accounts'];
const schema = {
  tags,
  security: [{ bearerAuth: [] }],
  response: { ...successResponse([200, 201]), ...errorResponse },
} as const;

const competitionParams = {
  type: 'object',
  required: ['id', 'competitionId'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    },
    competitionId: {
      type: 'string',
      pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    },
  },
} as const;

export async function adminRoutes(app: FastifyInstance) {
  app.post(
    '/admin-accounts',
    {
      preHandler: app.authenticate,
      schema: {
        ...schema,
        summary: 'Create an administrator account (super administrator only)',
        body: jsonSchema(adminAccountCreateSchema),
      },
    },
    async (req, reply) => {
      const row = await createAdminAccount(
        req.auth!,
        adminAccountCreateSchema.parse(req.body),
      );
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/admin-accounts',
    {
      preHandler: app.authenticate,
      schema: {
        ...schema,
        summary: 'List administrator accounts and assignments',
        querystring: jsonSchema(adminListQuerySchema),
      },
    },
    async (req, reply) => {
      const filters = adminListQuerySchema.parse(req.query);
      return ok(reply, await listAdminAccounts(req.auth!, filters));
    },
  );

  app.post(
    '/admin-accounts/:id/competitions',
    {
      preHandler: app.authenticate,
      schema: {
        ...schema,
        summary: 'Assign a competition administrator to a competition',
        params: idParamsSchema.params,
        body: jsonSchema(adminCompetitionAssignmentSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { competitionId } = adminCompetitionAssignmentSchema.parse(req.body);
      return ok(
        reply,
        await assignCompetitionAdmin(req.auth!, id, competitionId),
      );
    },
  );

  app.delete(
    '/admin-accounts/:id/competitions/:competitionId',
    {
      preHandler: app.authenticate,
      schema: {
        ...schema,
        summary: 'Revoke a competition administrator assignment',
        params: competitionParams,
      },
    },
    async (req, reply) => {
      const { id, competitionId } = req.params as {
        id: string;
        competitionId: string;
      };
      return ok(
        reply,
        await revokeCompetitionAdmin(req.auth!, id, competitionId),
      );
    },
  );
}
