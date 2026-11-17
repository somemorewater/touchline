import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { badRequest } from '../../shared/errors.js';
import { ok } from '../../shared/response.js';
import { errorResponse, successResponse } from '../../shared/schema.js';
import {
  allowedContentTypes,
  getFileForDownload,
  getFileMetadata,
  listCaseEvidence,
  listDisputeEvidence,
  removeEvidence,
  uploadEvidence,
} from './service.js';

const tags = ['Evidence files'];
const secure = { tags, security: [{ bearerAuth: [] }] } as const;

const uuidPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const caseParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: uuidPattern } },
} as const;

const caseEvidenceParams = {
  type: 'object',
  required: ['id', 'evidenceId'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: uuidPattern },
    evidenceId: { type: 'string', pattern: uuidPattern },
  },
} as const;

const disputeEvidenceParams = caseEvidenceParams;

const fileParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: uuidPattern } },
} as const;

const removeQuerySchema = z
  .object({ reason: z.string().trim().max(2000).optional() })
  .strict();

function uploadPayload(request: FastifyRequest) {
  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw badRequest('A binary request body is required.');
  }
  const rawName = request.headers['x-file-name'];
  if (typeof rawName !== 'string' || rawName.length === 0) {
    throw badRequest('The x-file-name header is required.');
  }
  const rawType = request.headers['content-type'];
  if (typeof rawType !== 'string' || rawType.length === 0) {
    throw badRequest('A Content-Type header is required.');
  }
  return { body, fileName: rawName, contentType: rawType };
}

export async function fileRoutes(app: FastifyInstance) {
  // Raw binary uploads avoid a multipart dependency. Only allowlisted media
  // types are parsed as buffers; every byte is still content-sniffed.
  try {
    app.removeContentTypeParser('text/plain');
  } catch {
    // The parser may be registered by a different encapsulation context.
  }
  app.addContentTypeParser(
    allowedContentTypes(),
    { parseAs: 'buffer', bodyLimit: env.FILE_MAX_BYTES },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.post(
    '/disciplinary-cases/:id/evidence',
    {
      preHandler: app.authenticate,
      bodyLimit: env.FILE_MAX_BYTES,
      schema: {
        ...secure,
        summary: 'Upload private evidence to a disciplinary case',
        params: caseParams,
        response: { ...successResponse([201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const payload = uploadPayload(req);
      const row = await uploadEvidence(
        req.auth!,
        { kind: 'case', id },
        payload.fileName,
        payload.contentType,
        payload.body,
      );
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/disciplinary-cases/:id/evidence',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List active evidence attached to a disciplinary case',
        params: caseParams,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await listCaseEvidence(req.auth!, id));
    },
  );

  app.delete(
    '/disciplinary-cases/:id/evidence/:evidenceId',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Remove evidence from a disciplinary case',
        params: caseEvidenceParams,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id, evidenceId } = req.params as { id: string; evidenceId: string };
      const { reason } = removeQuerySchema.parse(req.query);
      return ok(
        reply,
        await removeEvidence(req.auth!, evidenceId, reason ?? null, { kind: 'case', id }),
      );
    },
  );

  app.post(
    '/disputes/:id/evidence',
    {
      preHandler: app.authenticate,
      bodyLimit: env.FILE_MAX_BYTES,
      schema: {
        ...secure,
        summary: 'Upload private evidence to a dispute',
        params: caseParams,
        response: { ...successResponse([201]), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const payload = uploadPayload(req);
      const row = await uploadEvidence(
        req.auth!,
        { kind: 'dispute', id },
        payload.fileName,
        payload.contentType,
        payload.body,
      );
      return reply.code(201).send({ success: true, data: row });
    },
  );

  app.get(
    '/disputes/:id/evidence',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'List active evidence attached to a dispute',
        params: caseParams,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await listDisputeEvidence(req.auth!, id));
    },
  );

  app.delete(
    '/disputes/:id/evidence/:evidenceId',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Remove evidence from a dispute',
        params: disputeEvidenceParams,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id, evidenceId } = req.params as { id: string; evidenceId: string };
      const { reason } = removeQuerySchema.parse(req.query);
      return ok(
        reply,
        await removeEvidence(req.auth!, evidenceId, reason ?? null, { kind: 'dispute', id }),
      );
    },
  );

  app.get(
    '/files/:id',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Retrieve authorized private file metadata',
        params: fileParams,
        response: { ...successResponse(), ...errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return ok(reply, await getFileMetadata(req.auth!, id));
    },
  );

  app.get(
    '/files/:id/content',
    {
      preHandler: app.authenticate,
      schema: {
        ...secure,
        summary: 'Download authorized private file content',
        params: fileParams,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { file, data } = await getFileForDownload(req.auth!, id);
      const safeName = file.originalName.replace(/[^A-Za-z0-9._-]/g, '_');
      return reply
        .type(file.contentType)
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', `attachment; filename="${safeName}"`)
        .send(data);
    },
  );
}
