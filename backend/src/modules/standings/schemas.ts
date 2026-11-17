import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

export const standingsQuerySchema = z
  .object({
    seasonId: uuidSchema,
    groupId: uuidSchema.optional(),
  })
  .strict();

export const standingsSnapshotCreateSchema = z
  .object({
    seasonId: uuidSchema,
    groupId: uuidSchema.nullable().optional(),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();

export const standingsRecalculateSchema = z
  .object({
    seasonId: uuidSchema,
    groupId: uuidSchema.nullable().optional(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export const standingsHistoryQuerySchema = z
  .object({
    seasonId: uuidSchema,
    groupId: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type StandingsQuery = z.infer<typeof standingsQuerySchema>;
export type StandingsSnapshotCreate = z.infer<typeof standingsSnapshotCreateSchema>;
export type StandingsRecalculate = z.infer<typeof standingsRecalculateSchema>;
export type StandingsHistoryQuery = z.infer<typeof standingsHistoryQuerySchema>;
