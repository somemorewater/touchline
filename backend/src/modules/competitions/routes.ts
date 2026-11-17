import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../../database/client.js';
import { competitions, seasons, competitionGroups } from '../../database/schema/index.js';
import { conflict } from '../../shared/errors.js';
import { ok } from '../../shared/response.js';
import { notFound } from '../../shared/errors.js';
import { idParamsSchema } from '../../shared/validation.js';
import {
  errorResponse,
  jsonSchema,
  successResponse,
} from '../../shared/schema.js';
import { competitionScopesFor, hasPermission, type AuthContext } from '../../security/context.js';
import { PERMISSIONS } from '../../security/permissions.js';
import {
  canManageCompetition,
  canViewCompetition,
  canViewCompetitionById,
  getCompetitionVisibility,
  publicCompetitionCondition,
  resolveCompetitionForGroup,
  resolveCompetitionForSeason,
} from '../../security/access.js';
import {
  competitionCreateSchema,
  competitionUpdateSchema,
  groupCreateSchema,
  groupUpdateSchema,
  seasonCreateSchema,
  seasonUpdateSchema,
} from './schemas.js';
import {
  activateSeason,
  archiveCompetition,
  archiveGroup,
  archiveSeason,
  closeSeason,
  createCompetition,
  createGroup,
  createSeason,
  publishCompetition,
  unpublishCompetition,
  updateCompetition,
  updateGroup,
  updateSeason,
} from './service.js';

function readableCompetitionScope(auth: AuthContext): string[] {
  return [
    ...new Set([
      ...competitionScopesFor(auth, PERMISSIONS.competitionsRead),
      ...competitionScopesFor(auth, PERMISSIONS.competitionsUpdate),
      ...competitionScopesFor(auth, PERMISSIONS.competitionsPublish),
    ]),
  ];
}

const authError = { ...errorResponse } as const;
const competitionWriteSchema = {
  tags: ['Competitions'],
  security: [{ bearerAuth: [] }],
  response: { ...successResponse([200, 201]), ...authError },
} as const;

export async function competitionRoutes(app: FastifyInstance) {
  app.get(
    '/competitions',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags: ['Competitions'],
        summary: 'List visible competitions',
        response: { ...successResponse(), ...authError },
      },
    },
    async (req, reply) => {
      const auth = req.auth;
      const base = db.select().from(competitions);
      if (auth && hasPermission(auth, PERMISSIONS.competitionsRead)) {
        return ok(reply, await base.orderBy(asc(competitions.name)));
      }
      const scopes = auth ? readableCompetitionScope(auth) : [];
      const rows = scopes.length
        ? await base
            .where(or(publicCompetitionCondition(), inArray(competitions.id, scopes)))
            .orderBy(asc(competitions.name))
        : await base.where(publicCompetitionCondition()).orderBy(asc(competitions.name));
      return ok(reply, rows);
    },
  );

  app.post(
    '/competitions',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Create a competition (super admin)',
        body: jsonSchema(competitionCreateSchema),
      },
    },
    async (req, reply) => {
      const row = await createCompetition(req.auth!, competitionCreateSchema.parse(req.body));
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/competitions/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags: ['Competitions'],
        summary: 'Retrieve a visible competition',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...authError },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const visibility = await getCompetitionVisibility(id);
      if (!visibility || !canViewCompetition(req.auth, visibility)) {
        throw notFound('Competition not found.');
      }
      const [row] = await db.select().from(competitions).where(eq(competitions.id, id));
      if (!row) throw notFound('Competition not found.');
      return ok(reply, row);
    },
  );

  app.patch(
    '/competitions/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Update competition details',
        params: idParamsSchema.params,
        body: jsonSchema(competitionUpdateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await updateCompetition(
        req.auth!,
        id,
        competitionUpdateSchema.parse(req.body),
      );
      return ok(reply, row);
    },
  );

  app.post(
    '/competitions/:id/publish',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Publish a draft competition',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await publishCompetition(req.auth!, id));
    },
  );

  app.post(
    '/competitions/:id/unpublish',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Return a published competition to draft',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await unpublishCompetition(req.auth!, id));
    },
  );

  app.post(
    '/competitions/:id/archive',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Archive a competition (terminal, read-only)',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await archiveCompetition(req.auth!, id));
    },
  );

  app.get(
    '/competitions/:id/seasons',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags: ['Seasons'],
        summary: 'List seasons belonging to a competition',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...authError },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!(await canViewCompetitionById(req.auth, id))) {
        throw notFound('Competition not found.');
      }
      return ok(
        reply,
        await db
          .select()
          .from(seasons)
          .where(eq(seasons.competitionId, id))
          .orderBy(asc(seasons.startsOn)),
      );
    },
  );

  app.post(
    '/competitions/:id/seasons',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Create a season under a competition',
        params: idParamsSchema.params,
        body: jsonSchema(seasonCreateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await createSeason(req.auth!, id, seasonCreateSchema.parse(req.body));
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/seasons/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags: ['Seasons'],
        summary: 'Retrieve a season and its groups',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...authError },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const competitionId = await resolveCompetitionForSeason(id);
      if (!competitionId || !(await canViewCompetitionById(req.auth, competitionId))) {
        throw notFound('Season not found.');
      }
      const [season] = await db.select().from(seasons).where(eq(seasons.id, id));
      if (!season) throw notFound('Season not found.');
      return ok(reply, {
        ...season,
        groups: await db
          .select()
          .from(competitionGroups)
          .where(eq(competitionGroups.seasonId, id)),
      });
    },
  );

  app.patch(
    '/seasons/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Update season information',
        params: idParamsSchema.params,
        body: jsonSchema(seasonUpdateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await updateSeason(req.auth!, id, seasonUpdateSchema.parse(req.body)));
    },
  );

  app.post(
    '/seasons/:id/activate',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Activate a planned season',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await activateSeason(req.auth!, id));
    },
  );

  app.post(
    '/seasons/:id/close',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Close a planned or active season',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await closeSeason(req.auth!, id));
    },
  );

  app.post(
    '/seasons/:id/archive',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Archive a season (terminal, read-only)',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await archiveSeason(req.auth!, id));
    },
  );

  app.get(
    '/seasons/:id/groups',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags: ['Groups'],
        summary: 'List groups in a season',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...authError },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const competitionId = await resolveCompetitionForSeason(id);
      if (!competitionId || !(await canViewCompetitionById(req.auth, competitionId))) {
        throw notFound('Season not found.');
      }
      const manager = req.auth
        ? canManageCompetition(req.auth, PERMISSIONS.competitionsUpdate, competitionId)
        : false;
      const where = manager
        ? eq(competitionGroups.seasonId, id)
        : and(eq(competitionGroups.seasonId, id), isNull(competitionGroups.archivedAt));
      return ok(
        reply,
        await db.select().from(competitionGroups).where(where).orderBy(asc(competitionGroups.name)),
      );
    },
  );

  app.post(
    '/seasons/:id/groups',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Create a group in a season',
        params: idParamsSchema.params,
        body: jsonSchema(groupCreateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await createGroup(req.auth!, id, groupCreateSchema.parse(req.body));
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/groups/:id',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags: ['Groups'],
        summary: 'Retrieve a group',
        params: idParamsSchema.params,
        response: { ...successResponse(), ...authError },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const competitionId = await resolveCompetitionForGroup(id);
      if (!competitionId || !(await canViewCompetitionById(req.auth, competitionId))) {
        throw notFound('Group not found.');
      }
      const [group] = await db
        .select()
        .from(competitionGroups)
        .where(eq(competitionGroups.id, id));
      if (!group) throw notFound('Group not found.');
      if (group.archivedAt && !canManageCompetition(req.auth, PERMISSIONS.competitionsUpdate, competitionId)) {
        throw notFound('Group not found.');
      }
      return ok(reply, group);
    },
  );

  app.patch(
    '/groups/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Update a group',
        params: idParamsSchema.params,
        body: jsonSchema(groupUpdateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await updateGroup(req.auth!, id, groupUpdateSchema.parse(req.body)));
    },
  );

  app.post(
    '/groups/:id/archive',
    {
      preHandler: app.authenticate,
      schema: {
        ...competitionWriteSchema,
        summary: 'Archive an empty group',
        params: idParamsSchema.params,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await archiveGroup(req.auth!, id));
    },
  );
}
