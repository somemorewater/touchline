import type { FastifySchema } from 'fastify';

const uuidPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: uuidPattern },
  },
};

const uuidQueryProperty = { type: 'string', pattern: uuidPattern };

export const idParamsSchema = { params: idParams } satisfies FastifySchema;

export const seasonIdQuerySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { seasonId: uuidQueryProperty },
  },
} satisfies FastifySchema;

export const competitionIdQuerySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { competitionId: uuidQueryProperty },
  },
} satisfies FastifySchema;
