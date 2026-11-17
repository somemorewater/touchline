import type { FastifyInstance } from 'fastify';
import { ok } from '../../shared/response.js';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import { competitionOverview } from './service.js';
import { administrationOverviewQuerySchema } from './schemas.js';

const tags = ['Competition administration'];

export async function administrationRoutes(app: FastifyInstance) {
  app.get(
    '/competitions/:id/administration',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        security: [{ bearerAuth: [] }],
        summary: 'Administrative overview and operational warnings for a competition',
        ...idParamsSchema,
        querystring: jsonSchema(administrationOverviewQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { seasonId } = administrationOverviewQuerySchema.parse(req.query);
      return ok(reply, await competitionOverview(req.auth!, id, seasonId));
    },
  );
}
