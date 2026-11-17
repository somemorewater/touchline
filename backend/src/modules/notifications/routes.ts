import type { FastifyInstance } from 'fastify';
import { ok } from '../../shared/response.js';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from './service.js';
import { notificationListQuerySchema } from './schemas.js';

const tags = ['Notifications'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;
const withResponses = { ...secure, response: { ...successResponse([200]), ...errorResponse } };

export async function notificationRoutes(app: FastifyInstance) {
  app.get(
    '/notifications',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List the caller’s notifications with enforced pagination',
        querystring: jsonSchema(notificationListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      return ok(
        reply,
        await listNotifications(req.auth!, notificationListQuerySchema.parse(req.query)),
      );
    },
  );

  app.get(
    '/notifications/unread-count',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Return the caller’s unread notification count',
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      return ok(reply, { unread: await unreadNotificationCount(req.auth!) });
    },
  );

  app.post(
    '/notifications/:id/read',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Mark one of the caller’s notifications as read',
        ...idParamsSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await markNotificationRead(req.auth!, id));
    },
  );

  app.post(
    '/notifications/read-all',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Mark every unread notification for the caller as read',
      },
    },
    async (req, reply) => {
      return ok(reply, await markAllNotificationsRead(req.auth!));
    },
  );
}
