import type { FastifyInstance } from 'fastify';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import { requireAuth } from '../../security/plugin.js';
import { competitionAccountCreateSchema } from './schemas.js';
import { createCompetitionAccount } from './service.js';

export async function competitionAccountRoutes(app: FastifyInstance) {
  app.post(
    '/competition-accounts',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['Competition accounts'],
        summary: 'Create a competition-scoped operational account',
        security: [{ bearerAuth: [] }],
        body: jsonSchema(competitionAccountCreateSchema),
        response: { ...successResponse([200, 201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const row = await createCompetitionAccount(
        requireAuth(req),
        competitionAccountCreateSchema.parse(req.body),
      );
      return reply.code(201).send({ success: true, data: row });
    },
  );
}
