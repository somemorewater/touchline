import type { FastifyInstance } from 'fastify';
import { ok } from '../../shared/response.js';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import {
  addDisciplinaryFinding,
  addDisciplinaryNote,
  addDisciplinaryResponse,
  addDisciplinarySanction,
  appealDisciplinaryCase,
  assignDisciplinaryReviewer,
  checkPlayerEligibility,
  checkTeamEligibility,
  closeDisciplinaryCase,
  createDisciplinaryCase,
  decideDisciplinaryCase,
  getDisciplinaryCase,
  getDisciplinaryCaseHistory,
  listCaseSanctions,
  listDisciplinaryCases,
  requestDisciplinaryResponse,
  reviewDisciplinaryCase,
} from './service.js';
import {
  disciplinaryAppealSchema,
  disciplinaryAssignSchema,
  disciplinaryAwaitingResponseSchema,
  disciplinaryCaseCreateSchema,
  disciplinaryCloseSchema,
  disciplinaryDecisionSchema,
  disciplinaryFindingSchema,
  disciplinaryListQuerySchema,
  disciplinaryNoteSchema,
  disciplinaryReviewSchema,
  disciplinarySanctionCreateSchema,
  eligibilityQuerySchema,
} from './schemas.js';

const tags = ['Disciplinary cases'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;
const withResponses = { ...secure, response: { ...successResponse([200, 201]), ...errorResponse } };

const playerEligibilityParams = {
  type: 'object',
  required: ['playerRegistrationId'],
  additionalProperties: false,
  properties: {
    playerRegistrationId: {
      type: 'string',
      pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    },
  },
} as const;

const teamEligibilityParams = {
  type: 'object',
  required: ['teamRegistrationId'],
  additionalProperties: false,
  properties: {
    teamRegistrationId: {
      type: 'string',
      pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    },
  },
} as const;

export async function disciplinaryRoutes(app: FastifyInstance) {
  app.post(
    '/disciplinary-cases',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Open a disciplinary case',
        body: jsonSchema(disciplinaryCaseCreateSchema),
      },
    },
    async (req, reply) => {
      const row = await createDisciplinaryCase(
        req.auth!,
        disciplinaryCaseCreateSchema.parse(req.body),
      );
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/disciplinary-cases',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List disciplinary cases visible in the caller scope',
        querystring: jsonSchema(disciplinaryListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      return ok(
        reply,
        await listDisciplinaryCases(req.auth!, disciplinaryListQuerySchema.parse(req.query)),
      );
    },
  );

  app.get(
    '/disciplinary-cases/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Retrieve a disciplinary case with entries and sanctions',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getDisciplinaryCase(req.auth!, id));
    },
  );

  app.get(
    '/disciplinary-cases/:id/history',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Retrieve the disciplinary case audit history',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getDisciplinaryCaseHistory(req.auth!, id));
    },
  );

  app.get(
    '/disciplinary-cases/:id/sanctions',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List sanctions attached to a disciplinary case',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await listCaseSanctions(req.auth!, id));
    },
  );

  app.post(
    '/disciplinary-cases/:id/reviewer',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Assign an authorized reviewer to a disciplinary case',
        ...idParamsSchema,
        body: jsonSchema(disciplinaryAssignSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await assignDisciplinaryReviewer(
          req.auth!,
          id,
          disciplinaryAssignSchema.parse(req.body),
        ),
      );
    },
  );

  app.post(
    '/disciplinary-cases/:id/review',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Start or resume review of a disciplinary case',
        ...idParamsSchema,
        body: jsonSchema(disciplinaryReviewSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await reviewDisciplinaryCase(req.auth!, id, disciplinaryReviewSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disciplinary-cases/:id/request-response',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Move an under-review case to awaiting_response',
        ...idParamsSchema,
        body: jsonSchema(disciplinaryAwaitingResponseSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await requestDisciplinaryResponse(
          req.auth!,
          id,
          disciplinaryAwaitingResponseSchema.parse(req.body),
        ),
      );
    },
  );

  app.post(
    '/disciplinary-cases/:id/findings',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Record a case finding',
        ...idParamsSchema,
        body: jsonSchema(disciplinaryFindingSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await addDisciplinaryFinding(req.auth!, id, disciplinaryFindingSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disciplinary-cases/:id/decision',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Record the case decision and move it to decided',
        ...idParamsSchema,
        body: jsonSchema(disciplinaryDecisionSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await decideDisciplinaryCase(req.auth!, id, disciplinaryDecisionSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disciplinary-cases/:id/appeal',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Appeal a decided case',
        ...idParamsSchema,
        body: jsonSchema(disciplinaryAppealSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await appealDisciplinaryCase(req.auth!, id, disciplinaryAppealSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disciplinary-cases/:id/close',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Close a disciplinary case with a reason',
        ...idParamsSchema,
        body: jsonSchema(disciplinaryCloseSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await closeDisciplinaryCase(req.auth!, id, disciplinaryCloseSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disciplinary-cases/:id/notes',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Add an internal administrative note',
        ...idParamsSchema,
        body: jsonSchema(disciplinaryNoteSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await addDisciplinaryNote(req.auth!, id, disciplinaryNoteSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disciplinary-cases/:id/responses',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Record a subject response',
        ...idParamsSchema,
        body: jsonSchema(disciplinaryNoteSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = disciplinaryNoteSchema.parse(req.body);
      return ok(reply, await addDisciplinaryResponse(req.auth!, id, body.body));
    },
  );

  app.post(
    '/disciplinary-cases/:id/sanctions',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Record a structured disciplinary sanction',
        ...idParamsSchema,
        body: jsonSchema(disciplinarySanctionCreateSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sanction = await addDisciplinarySanction(
        req.auth!,
        id,
        disciplinarySanctionCreateSchema.parse(req.body),
      );
      return reply.code(201).send({ success: true, data: sanction });
    },
  );

  app.get(
    '/disciplinary/eligibility/players/:playerRegistrationId',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Explicitly check whether a player is eligible for a match',
        params: playerEligibilityParams,
        querystring: jsonSchema(eligibilityQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { playerRegistrationId } = req.params as { playerRegistrationId: string };
      const query = eligibilityQuerySchema.parse(req.query);
      return ok(
        reply,
        await checkPlayerEligibility(req.auth!, playerRegistrationId, query),
      );
    },
  );

  app.get(
    '/disciplinary/eligibility/teams/:teamRegistrationId',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Explicitly check whether a team entry is eligible',
        params: teamEligibilityParams,
        querystring: jsonSchema(eligibilityQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { teamRegistrationId } = req.params as { teamRegistrationId: string };
      const query = eligibilityQuerySchema.parse(req.query);
      return ok(
        reply,
        await checkTeamEligibility(req.auth!, teamRegistrationId, query),
      );
    },
  );
}
