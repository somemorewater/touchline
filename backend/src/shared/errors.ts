import type { FastifyReply } from 'fastify';

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    requestId: string;
    details?: ErrorDetail[];
  };
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message = 'Invalid request', details?: ErrorDetail[]) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);

export const unauthenticated = (message = 'Authentication required.') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'Permission denied.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found.') =>
  new AppError(404, 'RESOURCE_NOT_FOUND', message);

export const conflict = (message = 'The request conflicts with an existing resource.') =>
  new AppError(409, 'RESOURCE_CONFLICT', message);

export function errorBody(
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  details?: ErrorDetail[],
): ErrorBody {
  return {
    success: false,
    error: {
      code,
      message,
      statusCode,
      requestId,
      ...(details && details.length > 0 ? { details } : {}),
    },
  };
}

export function sendError(
  reply: FastifyReply,
  requestId: string,
  statusCode: number,
  code: string,
  message: string,
  details?: ErrorDetail[],
) {
  return reply
    .code(statusCode)
    .send(errorBody(statusCode, code, message, requestId, details));
}
