import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { forbidden, unauthenticated } from '../shared/errors.js';
import {
  hasPermission,
  hasPermissionInCompetition,
  type AuthContext,
} from './context.js';
import type { RoleName } from './permissions.js';
import { loadAuthContext } from './service.js';
import {
  ACCESS_COOKIE_NAME,
  extractBearerToken,
  verifyAccessToken,
} from './tokens.js';

export type SecurityGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyRequest {
    /** Trusted authentication context. Populated only by the security hooks. */
    auth: AuthContext | null;
  }

  interface FastifyInstance {
    authenticate: SecurityGuard;
    authenticateOptional: SecurityGuard;
    authenticateWebSocket: SecurityGuard;
    requirePermission(permission: string): SecurityGuard;
    requireAnyPermission(...permissions: string[]): SecurityGuard;
    requireRole(role: RoleName): SecurityGuard;
  }
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthenticated();
  return request.auth;
}

export function assertPermission(auth: AuthContext, permission: string): void {
  if (!hasPermission(auth, permission)) throw forbidden();
}

export function assertPermissionInCompetition(
  auth: AuthContext,
  permission: string,
  competitionId: string,
): void {
  if (!hasPermissionInCompetition(auth, permission, competitionId)) throw forbidden();
}

function cookieToken(request: FastifyRequest, name: string): string | null {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[name] ?? null;
}

async function authenticateRequest(
  request: FastifyRequest,
  token: string | null,
  throwOnFailure: boolean,
  allowCookie: boolean,
): Promise<void> {
  let credential = token;
  let usedCookie = false;
  if (!credential && allowCookie) {
    credential = cookieToken(request, ACCESS_COOKIE_NAME);
    usedCookie = credential !== null;
  }
  if (!credential) {
    if (throwOnFailure) throw unauthenticated();
    return;
  }

  // Cookie-based WebSocket authentication is only accepted from an explicit
  // allowlisted browser origin; this prevents cross-site WebSocket hijacking.
  if (usedCookie) {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !env.CORS_ORIGINS.includes(origin)) {
      if (throwOnFailure) throw unauthenticated('WebSocket origin is not allowed.');
      return;
    }
  }

  let claims: ReturnType<typeof verifyAccessToken>;
  try {
    claims = verifyAccessToken(request.server, credential);
  } catch {
    if (throwOnFailure) throw unauthenticated('Authentication credential is invalid or expired.');
    return;
  }

  // Database failures must surface as server errors, not as a misleading 401.
  const auth = await loadAuthContext(claims.sub, claims.sid);
  if (!auth) {
    if (throwOnFailure) throw unauthenticated('Session is no longer valid.');
    return;
  }
  request.auth = auth;
}

/**
 * Install the central authentication decorators and guards. Must run on the
 * root Fastify instance before routes are registered.
 */
export function securityPlugin(app: FastifyInstance): void {
  app.decorateRequest('auth', null);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    await authenticateRequest(request, extractBearerToken(request.headers), true, false);
  });

  app.decorate('authenticateOptional', async (request: FastifyRequest) => {
    await authenticateRequest(request, extractBearerToken(request.headers), false, false);
  });

  app.decorate('authenticateWebSocket', async (request: FastifyRequest) => {
    await authenticateRequest(request, extractBearerToken(request.headers), true, true);
  });

  app.decorate('requirePermission', (permission: string): SecurityGuard => {
    return async (request: FastifyRequest) => {
      assertPermission(requireAuth(request), permission);
    };
  });

  app.decorate('requireAnyPermission', (...permissions: string[]): SecurityGuard => {
    return async (request: FastifyRequest) => {
      const auth = requireAuth(request);
      if (!permissions.some((permission) => hasPermission(auth, permission))) {
        throw forbidden();
      }
    };
  });

  app.decorate('requireRole', (role: RoleName): SecurityGuard => {
    return async (request: FastifyRequest) => {
      const auth = requireAuth(request);
      if (!auth.globalRoles.has(role)) throw forbidden();
    };
  });
}
