import { z } from 'zod';
import { dateOnlySchema } from '../../shared/schema.js';

export const competitionFormats = [
  'single-league',
  'multiple-leagues',
  'group-stage',
  'knockout',
  'league-then-knockout',
] as const;

export const competitionStatuses = [
  'draft',
  'published',
  'registration',
  'active',
  'completed',
  'archived',
] as const;

export const competitionCreateSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.'),
    name: z.string().trim().min(2).max(200),
    description: z.string().trim().max(5000).nullable().optional(),
    format: z.enum(competitionFormats).optional(),
    visibility: z.enum(['public', 'private']).optional(),
  })
  .strict();

export const competitionUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    format: z.enum(competitionFormats).optional(),
    visibility: z.enum(['public', 'private']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const seasonCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    startsOn: dateOnlySchema.nullable().optional(),
    endsOn: dateOnlySchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn,
    'endsOn must not precede startsOn.',
  );

export const seasonUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    startsOn: dateOnlySchema.nullable().optional(),
    endsOn: dateOnlySchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const groupCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['league', 'group']).optional(),
  })
  .strict();

export const groupUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    kind: z.enum(['league', 'group']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
