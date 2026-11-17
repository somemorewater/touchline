import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { sql } from './database/client.js';
import { competitionRoutes } from './modules/competitions/routes.js';
import { teamRoutes } from './modules/teams/routes.js';
import { registrationRoutes } from './modules/registrations/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { matchRoutes } from './modules/matches/routes.js';
import { lineupRoutes } from './modules/lineups/routes.js';
import { statisticsRoutes } from './modules/statistics/routes.js';
import { standingsRoutes } from './modules/standings/routes.js';
import { fixtureRoutes } from './modules/fixtures/routes.js';
import { announcementRoutes } from './modules/announcements/routes.js';
import { administrationRoutes } from './modules/administration/routes.js';
import { disciplinaryRoutes } from './modules/disciplinary/routes.js';
import { disputeRoutes } from './modules/disputes/routes.js';
import { fileRoutes } from './modules/files/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { matchWebSocketRoutes } from './modules/matches/websocket.js';
import { securityPlugin } from './security/plugin.js';
import { AppError, sendError, type ErrorDetail } from './shared/errors.js';

interface ValidationIssue {
  instancePath?: string;
  message?: string;
}

const fallbackErrors: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'The request could not be processed.' },
  401: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
  403: { code: 'FORBIDDEN', message: 'Permission denied.' },
  404: { code: 'RESOURCE_NOT_FOUND', message: 'Resource not found.' },
  409: { code: 'RESOURCE_CONFLICT', message: 'The request conflicts with an existing resource.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported request media type.' },
  429: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again later.' },
};

function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    if ('code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    if (!('cause' in current)) return undefined;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function validationOf(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('validation' in error)) return undefined;
  return (error as { validation?: unknown }).validation;
}

function validationContextOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('validationContext' in error)) {
    return undefined;
  }
  const context = (error as { validationContext?: unknown }).validationContext;
  return typeof context === 'string' ? context : undefined;
}

function validationDetails(validation: unknown, context?: string): ErrorDetail[] {
  if (!Array.isArray(validation)) return [];
  return validation.slice(0, 20).map((entry) => {
    const issue = (typeof entry === 'object' && entry !== null ? entry : {}) as ValidationIssue;
    const path = issue.instancePath
      ? issue.instancePath.replace(/^\//, '').replace(/\//g, '.')
      : 'request';
    return {
      field: context ? `${context}.${path}` : path,
      message: typeof issue.message === 'string' ? issue.message : 'Invalid value.',
    };
  });
}

function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.slice(0, 20).map((issue) => ({
    field: issue.path.map(String).join('.') || 'request',
    message: issue.message,
  }));
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: env.TRUST_PROXY,
    requestIdHeader: 'x-request-id',
    bodyLimit: 1_048_576,
  });

  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: {
      iss: env.JWT_ISSUER,
      aud: env.JWT_AUDIENCE,
      expiresIn: env.ACCESS_TOKEN_TTL,
    },
    verify: {
      allowedIss: env.JWT_ISSUER,
      allowedAud: env.JWT_AUDIENCE,
    },
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(websocket);
  securityPlugin(app);
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'TOUCHLINE API',
        version: '1.0.0',
        description: 'Football competition management API',
      },
      servers: [{ url: `http://localhost:${env.PORT}/api/v1` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });
  await app.register(swaggerUI, { routePrefix: '/docs' });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn(
        { code: error.code, statusCode: error.statusCode, requestId: request.id },
        'request rejected',
      );
      return sendError(
        reply,
        request.id,
        error.statusCode,
        error.code,
        error.message,
        error.details,
      );
    }

    if (error instanceof ZodError) {
      request.log.warn(
        { code: 'VALIDATION_ERROR', statusCode: 400, requestId: request.id },
        'request validation failed',
      );
      return sendError(
        reply,
        request.id,
        400,
        'VALIDATION_ERROR',
        'Request validation failed.',
        zodDetails(error),
      );
    }

    const databaseCode = errorCode(error);
    if (databaseCode === '23505') {
      request.log.warn({ requestId: request.id }, 'unique constraint conflict');
      return sendError(
        reply,
        request.id,
        409,
        'RESOURCE_CONFLICT',
        'A resource with these values already exists.',
      );
    }
    if (databaseCode === '23503') {
      request.log.warn({ requestId: request.id }, 'foreign key conflict');
      return sendError(
        reply,
        request.id,
        409,
        'RESOURCE_CONFLICT',
        'The request conflicts with a related resource.',
      );
    }
    if (databaseCode === '23514' || databaseCode === '23502' || databaseCode === '22003') {
      request.log.warn({ requestId: request.id }, 'database integrity rule rejected input');
      return sendError(
        reply,
        request.id,
        400,
        'INVALID_INPUT',
        'A value violates a data integrity rule.',
      );
    }
    if (databaseCode === '22P02') {
      request.log.warn({ requestId: request.id }, 'invalid database input');
      return sendError(reply, request.id, 400, 'INVALID_INPUT', 'Invalid input value.');
    }

    const validation = validationOf(error);
    if (Array.isArray(validation)) {
      request.log.warn(
        { code: 'VALIDATION_ERROR', statusCode: 400, requestId: request.id },
        'request validation failed',
      );
      return sendError(
        reply,
        request.id,
        400,
        'VALIDATION_ERROR',
        'Request validation failed.',
        validationDetails(validation, validationContextOf(error)),
      );
    }

    if (errorCode(error)?.startsWith('FST_JWT_')) {
      request.log.warn({ requestId: request.id }, 'authentication rejected');
      return sendError(
        reply,
        request.id,
        401,
        'UNAUTHENTICATED',
        'Authentication is required or the credential is invalid.',
      );
    }

    if (statusCodeOf(error) === 413 || errorCode(error) === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      request.log.warn({ requestId: request.id }, 'request body too large');
      return sendError(reply, request.id, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }

    if (statusCodeOf(error) === 415 || errorCode(error) === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      request.log.warn({ requestId: request.id }, 'unsupported media type');
      return sendError(
        reply,
        request.id,
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Unsupported request media type.',
      );
    }

    if (
      errorCode(error) === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      errorCode(error) === 'FST_ERR_CTP_EMPTY_JSON_BODY'
    ) {
      request.log.warn({ requestId: request.id }, 'malformed JSON body');
      return sendError(reply, request.id, 400, 'INVALID_JSON', 'Request body is not valid JSON.');
    }

    if (statusCodeOf(error) === 429) {
      request.log.warn({ requestId: request.id }, 'rate limit exceeded');
      return sendError(
        reply,
        request.id,
        429,
        'RATE_LIMIT_EXCEEDED',
        'Too many requests. Try again later.',
      );
    }

    const statusCode = statusCodeOf(error) ?? 500;
    const fallback = fallbackErrors[statusCode];
    if (fallback) {
      request.log.warn({ statusCode, requestId: request.id }, 'request rejected');
      return sendError(reply, request.id, statusCode, fallback.code, fallback.message);
    }

    request.log.error({ err: error, requestId: request.id }, 'unhandled request error');
    return sendError(
      reply,
      request.id,
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred.',
    );
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, request.id, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.'),
  );

  const readiness = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await sql`select 1`;
      return reply.send({ success: true, data: { status: 'ok', database: 'ok' } });
    } catch (error) {
      request.log.error({ err: error, requestId: request.id }, 'database readiness check failed');
      return sendError(
        reply,
        request.id,
        503,
        'DATABASE_UNAVAILABLE',
        'Database is unavailable.',
      );
    }
  };

  app.get('/health', readiness);
  app.get('/ready', readiness);
  app.get('/health/live', async (_request, reply) =>
    reply.send({ success: true, data: { status: 'ok' } }),
  );

  await matchWebSocketRoutes(app);

  await app.register(
    async (api) => {
      await authRoutes(api);
      await competitionRoutes(api);
      await teamRoutes(api);
      await registrationRoutes(api);
      await adminRoutes(api);
      await fixtureRoutes(api);
      await matchRoutes(api);
      await lineupRoutes(api);
      await statisticsRoutes(api);
      await standingsRoutes(api);
      await announcementRoutes(api);
      await administrationRoutes(api);
      await disciplinaryRoutes(api);
      await disputeRoutes(api);
      await fileRoutes(api);
      await userRoutes(api);
      await auditRoutes(api);
      await notificationRoutes(api);
    },
    { prefix: '/api/v1' },
  );

  app.addHook('onClose', async () => {
    await sql.end();
  });

  return app;
}
