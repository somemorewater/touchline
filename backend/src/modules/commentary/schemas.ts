import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

export const commentaryKinds = ['commentary', 'key_moment'] as const;

/** Reuses the official event vocabulary plus editorial-only moment labels. */
export const editorialEventTypes = [
  'goal', 'own-goal', 'yellow-card', 'second-yellow', 'red-card', 'substitution',
  'injury', 'penalty-awarded', 'penalty-scored', 'penalty-missed', 'kickoff',
  'half-time', 'full-time', 'chance', 'save', 'other',
] as const;

export const commentaryCreateSchema = z
  .object({
    kind: z.enum(commentaryKinds).default('commentary'),
    eventType: z.enum(editorialEventTypes).nullable().optional(),
    body: z.string().trim().min(1).max(4000),
    minute: z.number().int().min(0).max(150).nullable().optional(),
    addedMinutes: z.number().int().min(0).max(30).nullable().optional(),
    teamRegistrationId: uuidSchema.nullable().optional(),
    isImportant: z.boolean().optional(),
    status: z.enum(['draft', 'published']).default('published'),
  })
  .strict()
  .refine(
    (value) => value.kind !== 'key_moment' || Boolean(value.eventType),
    'A key moment needs an event type.',
  );

export const commentaryUpdateSchema = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    minute: z.number().int().min(0).max(150).nullable().optional(),
    addedMinutes: z.number().int().min(0).max(30).nullable().optional(),
    eventType: z.enum(editorialEventTypes).nullable().optional(),
    teamRegistrationId: uuidSchema.nullable().optional(),
    isImportant: z.boolean().optional(),
    status: z.enum(['draft', 'published']).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field must be supplied.',
  );

export const matchOverviewUpdateSchema = z
  .object({
    introduction: z.string().trim().max(8000).nullable(),
    preMatchNotes: z.string().trim().max(8000).nullable(),
    liveSummary: z.string().trim().max(8000).nullable(),
    narrative: z.string().trim().max(8000).nullable(),
  })
  .strict();
