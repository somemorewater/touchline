import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const ACCESS_COOKIE_NAME = 'access_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const ACCESS_COOKIE_PATH = '/ws';

const durationPattern = /^(\d+)([smhd])?$/;

export function parseDurationSeconds(value: string): number {
  const match = durationPattern.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid token duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = unit === 'd' ? 86_400 : unit === 'h' ? 3_600 : unit === 'm' ? 60 : 1;
  return amount * multiplier;
}

export const ACCESS_TOKEN_SECONDS = parseDurationSeconds(env.ACCESS_TOKEN_TTL);

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  email: string;
}

const accessTokenSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  email: z.string().max(320),
});

export function signAccessToken(
  app: FastifyInstance,
  user: { id: string; email: string },
  sessionId: string,
): string {
  return app.jwt.sign(
    { sub: user.id, sid: sessionId, email: user.email },
    { expiresIn: env.ACCESS_TOKEN_TTL },
  );
}

export function verifyAccessToken(app: FastifyInstance, token: string): AccessTokenClaims {
  let payload: unknown;
  try {
    payload = app.jwt.verify<Record<string, unknown>>(token);
  } catch {
    throw new Error('invalid access token');
  }
  const parsed = accessTokenSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error('invalid access token claims');
  }
  return parsed.data;
}

export function extractBearerToken(headers: {
  authorization?: string | string[] | undefined;
}): string | null {
  const header = headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
