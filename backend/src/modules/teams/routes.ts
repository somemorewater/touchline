import type { FastifyInstance } from 'fastify';
import { idParamsSchema } from '../../shared/validation.js';
import {
  errorResponse,
  jsonSchema,
  successResponse,
} from '../../shared/schema.js';
import { ok } from '../../shared/response.js';
import {
  assignCaptain,
  createTeam,
  createTeamEntry,
  getCaptainAssignment,
  getTeam,
  getTeamEntry,
  listCaptainTeams,
  listTeamEntries,
  listTeams,
  provisionCaptain,
  restoreTeam,
  archiveTeam,
  revokeCaptain,
  updateTeam,
  updateTeamEntry,
} from './service.js';
import {
  captainAccountCreateSchema,
  captainAssignSchema,
  teamCreateSchema,
  teamEntryCreateSchema,
  teamEntryUpdateSchema,
  teamListQuerySchema,
  teamUpdateSchema,
} from './schemas.js';

const tags = ['Teams'];
const writeSchema = {
  tags,
  security: [{ bearerAuth: [] }],
  response: { ...successResponse([200, 201]), ...errorResponse },
} as const;

export async function teamRoutes(app: FastifyInstance) {
  app.get(
    '/teams',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List visible teams',
        querystring: jsonSchema(teamListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const filters = teamListQuerySchema.parse(req.query);
      return ok(reply, await listTeams(req.auth, filters));
    },
  );

  app.post(
    '/teams',
    {
      preHandler: app.authenticate,
      schema: {
        ...writeSchema,
        summary: 'Create a team and optionally enter it in a season',
        body: jsonSchema(teamCreateSchema),
      },
    },
    async (req, reply) => {
      const row = await createTeam(req.auth!, teamCreateSchema.parse(req.body));
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/teams/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve a visible team and its visible entries',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getTeam(req.auth, id));
    },
  );

  app.patch(
    '/teams/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...writeSchema,
        summary: 'Update a team within administrative scope',
        params: idParamsSchema.params,
        body: jsonSchema(teamUpdateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await updateTeam(req.auth!, id, teamUpdateSchema.parse(req.body));
      return ok(reply, row);
    },
  );

  app.post(
    '/teams/:id/archive',
    {
      preHandler: app.authenticate,
      schema: {
        ...writeSchema,
        summary: 'Archive a team that has no active participation',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await archiveTeam(req.auth!, id));
    },
  );

  app.post(
    '/teams/:id/restore',
    {
      preHandler: app.authenticate,
      schema: {
        ...writeSchema,
        summary: 'Restore an archived team',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await restoreTeam(req.auth!, id));
    },
  );

  app.get(
    '/seasons/:id/team-entries',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags: tags,
        summary: 'List team entries in a season',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await listTeamEntries(req.auth, id));
    },
  );

  app.post(
    '/seasons/:id/team-entries',
    {
      preHandler: app.authenticate,
      schema: {
        ...writeSchema,
        summary: 'Enter an existing team in a season',
        params: idParamsSchema.params,
        body: jsonSchema(teamEntryCreateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await createTeamEntry(
        req.auth!,
        id,
        teamEntryCreateSchema.parse(req.body),
      );
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/team-entries/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'Retrieve a team entry',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getTeamEntry(req.auth, id));
    },
  );

  app.patch(
    '/team-entries/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...writeSchema,
        summary: 'Update a team entry status or group',
        params: idParamsSchema.params,
        body: jsonSchema(teamEntryUpdateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await updateTeamEntry(
        req.auth!,
        id,
        teamEntryUpdateSchema.parse(req.body),
      );
      return ok(reply, row);
    },
  );

  app.get(
    '/team-entries/:id/captain',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        summary: 'Retrieve the captain assignment for a team entry',
        params: idParamsSchema.params,
        security: [{ bearerAuth: [] }],
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getCaptainAssignment(req.auth!, id));
    },
  );

  app.post(
    '/team-entries/:id/captain',
    {
      preHandler: app.authenticate,
      schema: {
        ...writeSchema,
        summary: 'Assign an existing captain account to a team entry',
        params: idParamsSchema.params,
        body: jsonSchema(captainAssignSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { userId } = captainAssignSchema.parse(req.body);
      return ok(reply, await assignCaptain(req.auth!, id, userId));
    },
  );

  app.post(
    '/team-entries/:id/captain/revoke',
    {
      preHandler: app.authenticate,
      schema: {
        ...writeSchema,
        summary: 'Revoke the captain assignment from a team entry',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await revokeCaptain(req.auth!, id));
    },
  );

  app.post(
    '/captains',
    {
      preHandler: app.authenticate,
      schema: {
        ...writeSchema,
        summary: 'Provision a captain account and assign it atomically',
        body: jsonSchema(captainAccountCreateSchema),
      },
    },
    async (req, reply) => {
      const row = await provisionCaptain(
        req.auth!,
        captainAccountCreateSchema.parse(req.body),
      );
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/captains/me/teams',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        summary: 'List team entries where the authenticated user is captain',
        security: [{ bearerAuth: [] }],
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      return ok(reply, await listCaptainTeams(req.auth!));
    },
  );
}
