import { randomBytes, createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../database/client.js';
import { users, refreshTokens, userRoles, roles, sessions } from '../../database/schema/index.js';
import { env } from '../../config/env.js';
import { AppError, conflict, unauthenticated } from '../../shared/errors.js';
import { closeSession, closeUser } from '../../security/connections.js';
import { ROLES } from '../../security/permissions.js';
import { signAccessToken } from '../../security/tokens.js';
import { hashPassword, verifyPassword } from '../../security/passwords.js';

const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const refreshLifetimeMs = () => env.REFRESH_TOKEN_DAYS * 86_400_000;
const newRefreshToken = () => randomBytes(48).toString('base64url');

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function revokeSessionRow(tx: Transaction, sessionId: string, reason: string, now: Date) {
  await tx
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  await tx
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.familyId, sessionId), isNull(refreshTokens.revokedAt)));
}

type RefreshOutcome =
  | { kind: 'ok'; userId: string; email: string; sessionId: string; refreshToken: string }
  | { kind: 'invalid' }
  | { kind: 'race' }
  | { kind: 'reuse' }
  | { kind: 'revoked' }
  | { kind: 'expired' }
  | { kind: 'inactive' };

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; displayName: string };
}

export class AuthService {
  constructor(private app: FastifyInstance) {}

  async register(email: string, password: string, displayName: string) {
    const passwordHash = await hashPassword(password);
    const normalizedEmail = email.toLowerCase();

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail));
      if (existing) throw conflict('An account with this email already exists.');

      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, ROLES.registeredUser));
      if (!role) {
        throw new AppError(
          500,
          'ROLE_CONFIGURATION_ERROR',
          'The security roles have not been seeded.',
        );
      }

      const [user] = await tx
        .insert(users)
        .values({ email: normalizedEmail, passwordHash, displayName })
        .returning({ id: users.id, email: users.email, displayName: users.displayName });
      if (!user) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to create the account.');

      await tx.insert(userRoles).values({ userId: user.id, roleId: role.id });
      return user;
    });
  }

  async login(email: string, password: string): Promise<SessionTokens> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email.toLowerCase()), eq(users.isActive, true)));
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    const expiresAt = new Date(Date.now() + refreshLifetimeMs());
    const created = await db.transaction(async (tx) => {
      const [session] = await tx
        .insert(sessions)
        .values({ userId: user.id, expiresAt, lastSeenAt: new Date() })
        .returning({ id: sessions.id });
      if (!session) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to create a session.');

      const raw = newRefreshToken();
      await tx.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: hashToken(raw),
        familyId: session.id,
        expiresAt,
      });
      return { sessionId: session.id, refreshToken: raw };
    });

    return {
      accessToken: signAccessToken(this.app, { id: user.id, email: user.email }, created.sessionId),
      refreshToken: created.refreshToken,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }

  async refresh(raw: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = hashToken(raw);
    const now = new Date();
    const graceMs = env.REFRESH_REUSE_GRACE_SECONDS * 1_000;

    const outcome = await db.transaction(async (tx): Promise<RefreshOutcome> => {
      const [record] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .for('update');
      if (!record) return { kind: 'invalid' };

      const [session] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, record.familyId))
        .for('update');
      if (!session) return { kind: 'invalid' };
      if (session.userId !== record.userId) {
        await revokeSessionRow(tx, session.id, 'session_mismatch', now);
        return { kind: 'revoked' };
      }
      if (session.revokedAt) return { kind: 'revoked' };
      if (session.expiresAt.getTime() <= now.getTime()) {
        await revokeSessionRow(tx, session.id, 'expired', now);
        return { kind: 'expired' };
      }

      if (record.revokedAt) {
        const elapsed = now.getTime() - record.revokedAt.getTime();
        if (elapsed <= graceMs) {
          // A concurrent rotation won the row lock. Do not revoke a healthy
          // family just because the loser retried inside the grace window.
          return { kind: 'race' };
        }
        await revokeSessionRow(tx, session.id, 'refresh_reuse', now);
        return { kind: 'reuse' };
      }

      if (record.expiresAt.getTime() <= now.getTime()) {
        await revokeSessionRow(tx, session.id, 'expired', now);
        return { kind: 'expired' };
      }

      const [user] = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(eq(users.id, record.userId), eq(users.isActive, true)));
      if (!user) {
        await revokeSessionRow(tx, session.id, 'account_inactive', now);
        return { kind: 'inactive' };
      }

      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(eq(refreshTokens.id, record.id));
      await tx.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));

      const next = newRefreshToken();
      await tx.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: hashToken(next),
        familyId: session.id,
        expiresAt: session.expiresAt,
      });

      return {
        kind: 'ok',
        userId: user.id,
        email: user.email,
        sessionId: session.id,
        refreshToken: next,
      };
    });

    switch (outcome.kind) {
      case 'ok':
        return {
          accessToken: signAccessToken(
            this.app,
            { id: outcome.userId, email: outcome.email },
            outcome.sessionId,
          ),
          refreshToken: outcome.refreshToken,
        };
      case 'invalid':
        throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid.');
      case 'race':
        throw new AppError(
          401,
          'REFRESH_TOKEN_ROTATED',
          'This refresh token was already rotated. Retry with the new token.',
        );
      case 'reuse':
        throw new AppError(401, 'REFRESH_REUSE_DETECTED', 'Session has expired. Sign in again.');
      case 'expired':
        throw new AppError(401, 'SESSION_EXPIRED', 'Session has expired. Sign in again.');
      case 'inactive':
        throw new AppError(401, 'ACCOUNT_INACTIVE', 'This account is not active.');
      case 'revoked':
        throw new AppError(401, 'SESSION_REVOKED', 'Session has been revoked. Sign in again.');
    }
  }

  async logout(rawRefreshToken?: string, sessionId?: string): Promise<void> {
    const resolved = await db.transaction(async (tx) => {
      const targets = new Set<string>();
      if (sessionId) targets.add(sessionId);
      if (rawRefreshToken) {
        const [record] = await tx
          .select({ familyId: refreshTokens.familyId })
          .from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, hashToken(rawRefreshToken)))
          .for('update');
        if (record) targets.add(record.familyId);
      }

      const revoked: string[] = [];
      for (const targetSessionId of targets) {
        const [session] = await tx
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, targetSessionId))
          .for('update');
        if (!session) continue;
        await revokeSessionRow(tx, session.id, 'logout', new Date());
        revoked.push(session.id);
      }
      return revoked;
    });

    for (const target of resolved) closeSession(target);
  }

  async logoutAll(userId: string): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ revokedAt: now, revokedReason: 'logout_all' })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    });
    closeUser(userId);
  }

  /**
   * Change the authenticated user's password.
   *
   * The caller always passes the user ID from the verified access token, never
   * a client-supplied ID. The password update is conditional on the old hash
   * so two concurrent changes cannot silently overwrite each other. Every
   * session and refresh token for this user is revoked in the same transaction.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isActive, true)));
    if (!user) throw unauthenticated();

    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
    }
    if (newPassword === currentPassword) {
      throw new AppError(400, 'PASSWORD_UNCHANGED', 'New password must be different from the current password.');
    }

    const passwordHash = await hashPassword(newPassword);
    const now = new Date();

    const changed = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(
          and(
            eq(users.id, userId),
            eq(users.isActive, true),
            eq(users.passwordHash, user.passwordHash),
          ),
        )
        .returning({ id: users.id });
      if (!updated) return false;

      await tx
        .update(sessions)
        .set({ revokedAt: now, revokedReason: 'password_change' })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      return true;
    });

    if (!changed) {
      throw conflict('The password was changed by another request. Try again.');
    }
    closeUser(userId);
  }

  /**
   * Account activation primitive for future administrative routes.
   * Deactivation revokes every session immediately; reactivation never
   * restores a revoked session.
   */
  async setUserActive(userId: string, isActive: boolean): Promise<boolean> {
    const now = new Date();
    const changed = await db.transaction(async (tx) => {
      const [user] = await tx
        .update(users)
        .set({ isActive, updatedAt: now })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (!user) return false;
      if (!isActive) {
        await tx
          .update(sessions)
          .set({ revokedAt: now, revokedReason: 'account_deactivated' })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
        await tx
          .update(refreshTokens)
          .set({ revokedAt: now })
          .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      }
      return true;
    });
    if (changed && !isActive) closeUser(userId);
    return changed;
  }
}

export function requireRefreshCookie(value: string | undefined): string {
  if (!value) throw unauthenticated('Sign in required.');
  return value;
}
