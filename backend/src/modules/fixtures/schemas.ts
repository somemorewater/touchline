import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

export const fixtureStatuses = [
  'draft',
  'scheduled',
  'postponed',
  'cancelled',
  'completed',
  'abandoned',
] as const;

const isoDateTime = z.iso.datetime({ offset: true });

const participantFields = {
  homeTeamRegistrationId: uuidSchema,
  awayTeamRegistrationId: uuidSchema,
};

export const fixtureCreateSchema = z
  .object({
    seasonId: uuidSchema,
    groupId: uuidSchema.nullable().optional(),
    ...participantFields,
    round: z.number().int().min(1).max(500).nullable().optional(),
    scheduledAt: isoDateTime.nullable().optional(),
    venue: z.string().trim().max(200).nullable().optional(),
    officialUserId: uuidSchema.nullable().optional(),
    commentaryUserId: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.homeTeamRegistrationId !== value.awayTeamRegistrationId,
    'A team cannot play itself.',
  );

export const fixtureUpdateSchema = z
  .object({
    groupId: uuidSchema.nullable().optional(),
    homeTeamRegistrationId: uuidSchema.optional(),
    awayTeamRegistrationId: uuidSchema.optional(),
    round: z.number().int().min(1).max(500).nullable().optional(),
    scheduledAt: isoDateTime.nullable().optional(),
    venue: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const fixtureListQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    groupId: uuidSchema.optional(),
    teamId: uuidSchema.optional(),
    teamRegistrationId: uuidSchema.optional(),
    status: z.enum(fixtureStatuses).optional(),
  })
  .strict();

export const fixtureRescheduleSchema = z
  .object({
    scheduledAt: isoDateTime,
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const fixtureLifecycleSchema = z
  .object({
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const fixtureGenerationSchema = z
  .object({
    seasonId: uuidSchema,
    groupId: uuidSchema.nullable().optional(),
    legs: z.union([z.literal(1), z.literal(2)]).optional(),
  })
  .strict();
