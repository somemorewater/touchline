import type { FastifyInstance } from 'fastify';
import { ok } from '../../shared/response.js';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import {
  archiveAnnouncement,
  createAnnouncement,
  listManagedAnnouncements,
  listPublishedAnnouncements,
  publishAnnouncement,
  unpublishAnnouncement,
  updateAnnouncement,
} from './service.js';
import {
  announcementCreateSchema,
  announcementListQuerySchema,
  announcementManageQuerySchema,
  announcementUpdateSchema,
} from './schemas.js';

const tags = ['Announcements'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;
const withResponses = { ...secure, response: { ...successResponse([200, 201]), ...errorResponse } };

export async function announcementRoutes(app: FastifyInstance) {
  app.get(
    '/announcements',
    {
      preHandler: app.authenticateOptional,
      schema: {
        tags,
        summary: 'List published announcements visible to the caller',
        querystring: jsonSchema(announcementListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const query = announcementListQuerySchema.parse(req.query);
      const result = await listPublishedAnnouncements(req.auth, query);
      return ok(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/announcements/manage',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List draft, published and archived announcements in scope',
        querystring: jsonSchema(announcementManageQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      return ok(
        reply,
        await listManagedAnnouncements(
          req.auth!,
          announcementManageQuerySchema.parse(req.query),
        ),
      );
    },
  );

  app.post(
    '/announcements',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Create a draft announcement',
        body: jsonSchema(announcementCreateSchema),
      },
    },
    async (req, reply) => {
      const row = await createAnnouncement(req.auth!, announcementCreateSchema.parse(req.body));
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.patch(
    '/announcements/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Edit a draft announcement',
        ...idParamsSchema,
        body: jsonSchema(announcementUpdateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await updateAnnouncement(req.auth!, id, announcementUpdateSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/announcements/:id/publish',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Publish a draft announcement and notify resolved audiences',
        ...idParamsSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await publishAnnouncement(req.auth!, id));
    },
  );

  app.post(
    '/announcements/:id/unpublish',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Return a published announcement to draft',
        ...idParamsSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await unpublishAnnouncement(req.auth!, id));
    },
  );

  app.post(
    '/announcements/:id/archive',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Archive an announcement permanently',
        ...idParamsSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await archiveAnnouncement(req.auth!, id));
    },
  );
}
