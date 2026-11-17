import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ok } from '../../shared/response.js';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import {
  activateUser,
  deactivateUser,
  getUser,
  getUserAssociations,
  getUserHistory,
  getUserRoles,
  grantUserRole,
  listUsers,
  restoreUser,
  revokeUserRole,
  revokeUserSessions,
  suspendUser,
} from './service.js';
import {
  assignableRoleNames,
  userListQuerySchema,
  userRevokeSessionsSchema,
  userRoleGrantSchema,
  userRoleQuerySchema,
  userSuspendSchema,
} from './schemas.js';

const tags = ['User administration'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;
const withResponses = { ...secure, response: { ...successResponse([200, 201]), ...errorResponse } };

const roleParamsSchema = z
  .object({
    id: z.uuid(),
    role: z.enum(assignableRoleNames),
  })
  .strict();

export async function userRoutes(app: FastifyInstance) {
  app.get(
    '/users',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List users visible to the caller with enforced pagination',
        querystring: jsonSchema(userListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      return ok(reply, await listUsers(req.auth!, userListQuerySchema.parse(req.query)));
    },
  );

  app.get(
    '/users/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Retrieve a safe user profile',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getUser(req.auth!, id));
    },
  );

  app.get(
    '/users/:id/roles',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List a user’s role assignments visible in the caller scope',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getUserRoles(req.auth!, id));
    },
  );

  app.get(
    '/users/:id/associations',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List a user’s captaincies and match official assignments',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getUserAssociations(req.auth!, id));
    },
  );

  app.get(
    '/users/:id/history',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Retrieve a user’s administrative and role-assignment history',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getUserHistory(req.auth!, id));
    },
  );

  app.post(
    '/users/:id/deactivate',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Deactivate an account and revoke every session',
        ...idParamsSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await deactivateUser(req.auth!, id));
    },
  );

  app.post(
    '/users/:id/activate',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Reactivate a deactivated account',
        ...idParamsSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await activateUser(req.auth!, id));
    },
  );

  app.post(
    '/users/:id/suspend',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Suspend an account with a reason and revoke every session',
        ...idParamsSchema,
        body: jsonSchema(userSuspendSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await suspendUser(req.auth!, id, userSuspendSchema.parse(req.body)));
    },
  );

  app.post(
    '/users/:id/restore',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Restore a suspended account',
        ...idParamsSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await restoreUser(req.auth!, id));
    },
  );

  app.post(
    '/users/:id/sessions/revoke',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Revoke every active session for an account',
        ...idParamsSchema,
        body: jsonSchema(userRevokeSessionsSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const input = userRevokeSessionsSchema.parse(req.body);
      return ok(reply, await revokeUserSessions(req.auth!, id, input.reason));
    },
  );

  app.post(
    '/users/:id/roles',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Grant a global or competition-scoped role',
        ...idParamsSchema,
        body: jsonSchema(userRoleGrantSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await grantUserRole(req.auth!, id, userRoleGrantSchema.parse(req.body));
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.delete(
    '/users/:id/roles/:role',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Revoke a global or competition-scoped role',
        params: jsonSchema(roleParamsSchema),
        querystring: jsonSchema(userRoleQuerySchema),
      },
    },
    async (req, reply) => {
      const { id, role } = req.params as { id: string; role: (typeof assignableRoleNames)[number] };
      const { competitionId } = userRoleQuerySchema.parse(req.query);
      return ok(reply, await revokeUserRole(req.auth!, id, role, competitionId));
    },
  );
}
