import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

export const announcementAudiences = [
  'public',
  'participants',
  'captains',
  'officials',
  'administrators',
] as const;

export const announcementCreateSchema = z
  .object({
    competitionId: uuidSchema.nullable().optional(),
    seasonId: uuidSchema.nullable().optional(),
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(1).max(20_000),
    audience: z.enum(announcementAudiences).default('public'),
  })
  .strict()
  .refine(
    (value) =>
      value.seasonId === undefined ||
      value.seasonId === null ||
      Boolean(value.competitionId),
    'seasonId requires competitionId.',
  )
  .refine(
    (value) =>
      value.audience === 'public' ||
      value.audience === 'participants' ||
      Boolean(value.competitionId),
    'This audience requires a competition.',
  );

export const announcementUpdateSchema = z
  .object({
    seasonId: uuidSchema.nullable().optional(),
    title: z.string().trim().min(3).max(200).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
    audience: z.enum(announcementAudiences).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).length > 0,
    'At least one field must be provided.',
  );

export const announcementListQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    audience: z.enum(announcementAudiences).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const announcementManageQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    audience: z.enum(announcementAudiences).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
