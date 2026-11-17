import type { FastifyInstance } from 'fastify';
import { ok } from '../../shared/response.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import { auditListQuerySchema } from './schemas.js';
import { listAuditLogs } from './service.js';

const tags = ['Audit log'];

export async function auditRoutes(app: FastifyInstance) {
  app.get(
    '/audit-logs',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        security: [{ bearerAuth: [] }],
        summary: 'Retrieve append-only audit history within the caller scope',
        querystring: jsonSchema(auditListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      return ok(reply, await listAuditLogs(req.auth!, auditListQuerySchema.parse(req.query)));
    },
  );
}
