import type { FastifyInstance } from 'fastify';
import { ok } from '../../shared/response.js';
import { idParamsSchema } from '../../shared/validation.js';
import { errorResponse, jsonSchema, successResponse } from '../../shared/schema.js';
import {
  addDisputeResponse,
  assignDisputeReviewer,
  closeDispute,
  createDispute,
  decideDispute,
  getDispute,
  getDisputeHistory,
  listDisputes,
  provideDisputeInformation,
  requestDisputeInformation,
  startDisputeReview,
  submitDispute,
} from './service.js';
import {
  disputeAssignSchema,
  disputeCloseSchema,
  disputeCreateSchema,
  disputeDecisionSchema,
  disputeInformationRequestSchema,
  disputeListQuerySchema,
  disputeResponseSchema,
  disputeReviewSchema,
  disputeSubmitSchema,
} from './schemas.js';

const tags = ['Disputes'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;
const withResponses = { ...secure, response: { ...successResponse([200, 201]), ...errorResponse } };

export async function disputeRoutes(app: FastifyInstance) {
  app.post(
    '/disputes',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Create a draft or submitted dispute',
        body: jsonSchema(disputeCreateSchema),
      },
    },
    async (req, reply) => {
      const row = await createDispute(req.auth!, disputeCreateSchema.parse(req.body));
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/disputes',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List disputes visible to the caller',
        querystring: jsonSchema(disputeListQuerySchema),
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      return ok(reply, await listDisputes(req.auth!, disputeListQuerySchema.parse(req.query)));
    },
  );

  app.get(
    '/disputes/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Retrieve a dispute and its visible history entries',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getDispute(req.auth!, id));
    },
  );

  app.get(
    '/disputes/:id/history',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Retrieve the dispute audit history',
        ...idParamsSchema,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getDisputeHistory(req.auth!, id));
    },
  );

  app.post(
    '/disputes/:id/submit',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Submit a draft dispute',
        ...idParamsSchema,
        body: jsonSchema(disputeSubmitSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await submitDispute(req.auth!, id));
    },
  );

  app.post(
    '/disputes/:id/reviewer',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Assign an authorized reviewer to a dispute',
        ...idParamsSchema,
        body: jsonSchema(disputeAssignSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await assignDisputeReviewer(req.auth!, id, disputeAssignSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disputes/:id/review',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Start review of a submitted dispute',
        ...idParamsSchema,
        body: jsonSchema(disputeReviewSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await startDisputeReview(req.auth!, id, disputeReviewSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disputes/:id/responses',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Record a dispute response',
        ...idParamsSchema,
        body: jsonSchema(disputeResponseSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await addDisputeResponse(req.auth!, id, disputeResponseSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disputes/:id/request-information',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Request additional information from the submitter',
        ...idParamsSchema,
        body: jsonSchema(disputeInformationRequestSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await requestDisputeInformation(
          req.auth!,
          id,
          disputeInformationRequestSchema.parse(req.body),
        ),
      );
    },
  );

  app.post(
    '/disputes/:id/information',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Provide requested additional information',
        ...idParamsSchema,
        body: jsonSchema(disputeInformationRequestSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await provideDisputeInformation(
          req.auth!,
          id,
          disputeInformationRequestSchema.parse(req.body),
        ),
      );
    },
  );

  app.post(
    '/disputes/:id/decision',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Record a dispute decision without changing match results',
        ...idParamsSchema,
        body: jsonSchema(disputeDecisionSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(
        reply,
        await decideDispute(req.auth!, id, disputeDecisionSchema.parse(req.body)),
      );
    },
  );

  app.post(
    '/disputes/:id/close',
    {
      preHandler: app.authenticate,
      schema: {
        ...withResponses,
        summary: 'Close a decided dispute',
        ...idParamsSchema,
        body: jsonSchema(disputeCloseSchema),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await closeDispute(req.auth!, id, disputeCloseSchema.parse(req.body)));
    },
  );
}
