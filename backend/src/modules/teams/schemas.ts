import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

const optionalNullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const teamCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    shortName: optionalNullableText(50),
    department: optionalNullableText(120),
    seasonId: uuidSchema.optional(),
    groupId: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => !value.groupId || Boolean(value.seasonId), 'seasonId is required with groupId.');

export const teamUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    shortName: optionalNullableText(50),
    department: optionalNullableText(120),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const teamEntryCreateSchema = z
  .object({
    teamId: uuidSchema,
    groupId: uuidSchema.nullable().optional(),
  })
  .strict();

export const registrationStatuses = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'withdrawn',
] as const;

export const teamEntryUpdateSchema = z
  .object({
    groupId: uuidSchema.nullable().optional(),
    status: z.enum(registrationStatuses).optional(),
    reviewNote: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const teamListQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
  })
  .strict();

export const captainAccountCreateSchema = z
  .object({
    email: z.email(),
    password: z.string().min(12).max(128),
    displayName: z.string().trim().min(2).max(160),
    teamRegistrationId: uuidSchema,
  })
  .strict();

export const captainAssignSchema = z
  .object({
    userId: uuidSchema,
  })
  .strict();
