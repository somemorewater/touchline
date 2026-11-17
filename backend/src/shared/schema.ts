import { z } from 'zod';

export const uuidSchema = z.uuid();
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.');

/** JSON Schema for OpenAPI/Fastify documentation of a Zod input schema. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete generated.$schema;
  return generated;
}

export const successEnvelope = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {},
    meta: {},
  },
  required: ['success', 'data'],
} as const;

export const errorEnvelope = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    error: {
      type: 'object',
      additionalProperties: true,
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        statusCode: { type: 'integer' },
        requestId: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['field', 'message'],
          },
        },
      },
      required: ['code', 'message', 'statusCode', 'requestId'],
    },
  },
  required: ['success', 'error'],
} as const;

export function successResponse<const Codes extends readonly number[] = [200]>(
  codes: Codes = [200] as unknown as Codes,
): { [K in Codes[number]]: typeof successEnvelope } {
  return Object.fromEntries(
    codes.map((code) => [code, successEnvelope]),
  ) as { [K in Codes[number]]: typeof successEnvelope };
}

export const errorResponse = {
  400: errorEnvelope,
  401: errorEnvelope,
  403: errorEnvelope,
  404: errorEnvelope,
  409: errorEnvelope,
} as const;
