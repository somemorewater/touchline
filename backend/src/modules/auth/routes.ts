import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService, requireRefreshCookie } from './service.js';
import { env } from '../../config/env.js';
import {
  ACCESS_COOKIE_NAME,
  ACCESS_COOKIE_PATH,
  ACCESS_TOKEN_SECONDS,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from '../../security/tokens.js';

const registerSchema = z
  .object({
    email: z.email(),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(2).max(160),
  })
  .strict();
const loginSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1).max(128),
  })
  .strict();

function noStore(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store');
  reply.header('pragma', 'no-cache');
}

export async function authRoutes(app: FastifyInstance) {
  const service = new AuthService(app);
  const refreshCookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: REFRESH_COOKIE_PATH,
  };
  const accessCookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: ACCESS_COOKIE_PATH,
  };
  const refreshMaxAge = env.REFRESH_TOKEN_DAYS * 86_400;

  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = registerSchema.parse(req.body);
      const user = await service.register(input.email, input.password, input.displayName);
      noStore(reply);
      return reply.code(201).send({ success: true, data: user });
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = loginSchema.parse(req.body);
      const data = await service.login(input.email, input.password);
      reply.setCookie(REFRESH_COOKIE_NAME, data.refreshToken, {
        ...refreshCookieOptions,
        maxAge: refreshMaxAge,
      });
      reply.setCookie(ACCESS_COOKIE_NAME, data.accessToken, {
        ...accessCookieOptions,
        maxAge: ACCESS_TOKEN_SECONDS,
      });
      noStore(reply);
      return reply.send({
        success: true,
        data: {
          accessToken: data.accessToken,
          tokenType: 'Bearer',
          expiresIn: ACCESS_TOKEN_SECONDS,
          user: data.user,
        },
      });
    },
  );

  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const raw = requireRefreshCookie(
        (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE_NAME],
      );
      const data = await service.refresh(raw);
      reply.setCookie(REFRESH_COOKIE_NAME, data.refreshToken, {
        ...refreshCookieOptions,
        maxAge: refreshMaxAge,
      });
      reply.setCookie(ACCESS_COOKIE_NAME, data.accessToken, {
        ...accessCookieOptions,
        maxAge: ACCESS_TOKEN_SECONDS,
      });
      noStore(reply);
      return reply.send({
        success: true,
        data: {
          accessToken: data.accessToken,
          tokenType: 'Bearer',
          expiresIn: ACCESS_TOKEN_SECONDS,
        },
      });
    },
  );

  app.post(
    '/auth/logout',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: app.authenticateOptional,
    },
    async (req, reply) => {
      const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE_NAME];
      await service.logout(raw, req.auth?.sessionId);
      reply.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
      reply.clearCookie(ACCESS_COOKIE_NAME, accessCookieOptions);
      noStore(reply);
      return reply.send({ success: true, data: { loggedOut: true } });
    },
  );

  app.post(
    '/auth/logout-all',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: app.authenticate,
    },
    async (req, reply) => {
      await service.logoutAll(req.auth!.userId);
      reply.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
      reply.clearCookie(ACCESS_COOKIE_NAME, accessCookieOptions);
      noStore(reply);
      return reply.send({ success: true, data: { loggedOutAll: true } });
    },
  );

  app.get('/auth/me', { preHandler: app.authenticate }, async (req, reply) => {
    const auth = req.auth!;
    noStore(reply);
    return reply.send({
      success: true,
      data: {
        id: auth.userId,
        email: auth.email,
        displayName: auth.displayName,
        sessionId: auth.sessionId,
        roles: auth.assignments,
        permissions: [...auth.permissions].sort(),
        scopes: [...auth.scopedPermissions.entries()].map(([competitionId, permissions]) => ({
          competitionId,
          permissions: [...permissions].sort(),
        })),
      },
    });
  });
}
