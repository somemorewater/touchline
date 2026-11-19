import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

export const adminAccountCreateSchema = z
  .object({
    email: z.email(),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(2).max(160),
    role: z.enum(['competition_admin', 'super_admin']),
    competitionIds: z.array(uuidSchema).max(100).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.role === 'super_admin' ||
      (value.competitionIds !== undefined && value.competitionIds.length > 0),
    'competitionIds is required for a competition administrator.',
  )
  .refine(
    (value) =>
      value.role !== 'super_admin' ||
      value.competitionIds === undefined ||
      value.competitionIds.length === 0,
    'A super administrator cannot have competition-scoped assignments.',
  )
  .refine(
    (value) =>
      !value.competitionIds ||
      new Set(value.competitionIds).size === value.competitionIds.length,
    'competitionIds must not contain duplicates.',
  );

export const adminCompetitionAssignmentSchema = z
  .object({
    competitionId: uuidSchema,
  })
  .strict();

export const adminListQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
  })
  .strict();
