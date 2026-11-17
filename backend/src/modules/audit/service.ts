import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { db } from '../../database/client.js';
import { auditLogs } from '../../database/schema/index.js';
import { forbidden } from '../../shared/errors.js';
import {
  competitionScopesFor,
  hasPermission,
  type AuthContext,
} from '../../security/context.js';
import { PERMISSIONS } from '../../security/permissions.js';

export interface AuditQuery {
  competitionId?: string | undefined;
  seasonId?: string | undefined;
  actorUserId?: string | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
  offset: number;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'accesstoken',
  'refreshtoken',
  'secret',
  'authorization',
  'cookie',
]);

/** Recursively remove authentication material from audit snapshots. */
export function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      result[key] = sanitizeAuditValue(entry);
    }
    return result;
  }
  return value;
}

export async function listAuditLogs(auth: AuthContext, query: AuditQuery) {
  const globalReader = hasPermission(auth, PERMISSIONS.auditRead);
  const scopes = competitionScopesFor(auth, PERMISSIONS.auditRead);
  if (!globalReader && scopes.length === 0) {
    throw forbidden('Audit access requires an administrative scope.');
  }

  const conditions: SQL[] = [];
  if (!globalReader) {
    conditions.push(inArray(auditLogs.competitionId, scopes));
  }
  if (query.competitionId) conditions.push(eq(auditLogs.competitionId, query.competitionId));
  if (query.seasonId) conditions.push(eq(auditLogs.seasonId, query.seasonId));
  if (query.actorUserId) conditions.push(eq(auditLogs.actorUserId, query.actorUserId));
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.entityType) conditions.push(eq(auditLogs.entityType, query.entityType));
  if (query.entityId) conditions.push(eq(auditLogs.entityId, query.entityId));
  if (query.from) conditions.push(gte(auditLogs.createdAt, new Date(query.from)));
  if (query.to) conditions.push(lte(auditLogs.createdAt, new Date(query.to)));

  const rows = await db
    .select({
      id: auditLogs.id,
      actorUserId: auditLogs.actorUserId,
      competitionId: auditLogs.competitionId,
      seasonId: auditLogs.seasonId,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      before: auditLogs.before,
      after: auditLogs.after,
      reason: auditLogs.reason,
      requestId: auditLogs.requestId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return {
    items: rows.map((row) => ({
      ...row,
      before: sanitizeAuditValue(row.before),
      after: sanitizeAuditValue(row.after),
    })),
    pagination: { limit: query.limit, offset: query.offset, returned: rows.length },
  };
}
