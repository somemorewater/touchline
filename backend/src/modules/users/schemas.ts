import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

export const assignableRoleNames = [
  'team_captain',
  'match_official',
  'competition_admin',
  'super_admin',
  'registered_user',
  'visitor',
] as const;

export const userListQuerySchema = z
  .object({
    q: z.string().trim().max(160).optional(),
    status: z.enum(['active', 'inactive', 'suspended']).optional(),
    role: z.enum(assignableRoleNames).optional(),
    competitionId: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const userRoleGrantSchema = z
  .object({
    role: z.enum(assignableRoleNames),
    competitionId: uuidSchema.nullable().optional(),
  })
  .strict();

export const userRoleQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
  })
  .strict();

export const userSuspendSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export const userRevokeSessionsSchema = z
  .object({
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
