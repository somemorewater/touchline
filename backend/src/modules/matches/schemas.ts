import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

const isoDateTime = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(1).max(2000);

export const MATCH_DURATION_MIN = 10;
export const MATCH_DURATION_MAX = 120;

export const matchEventTypes = [
  'goal',
  'own-goal',
  'yellow-card',
  'second-yellow',
  'red-card',
  'substitution',
  'injury',
  'penalty-awarded',
  'penalty-scored',
  'penalty-missed',
  'kickoff',
  'half-time',
  'full-time',
] as const;

export type MatchEventType = (typeof matchEventTypes)[number];

export const matchLifecycleSchema = z
  .object({
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const matchRescheduleSchema = z
  .object({
    scheduledAt: isoDateTime,
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const matchClockSchema = z
  .object({
    minute: z.number().int().min(0).max(150),
    addedMinutes: z.number().int().min(0).max(30).nullable().optional(),
  })
  .strict();

export const matchVenueUpdateSchema = z
  .object({
    venue: z.string().trim().max(200).nullable(),
  })
  .strict();

export const matchDurationUpdateSchema = z
  .object({
    durationMinutes: z.number().int().min(MATCH_DURATION_MIN).max(MATCH_DURATION_MAX),
  })
  .strict();

const eventFields = {
  eventType: z.enum(matchEventTypes),
  teamRegistrationId: uuidSchema.nullable().optional(),
  playerRegistrationId: uuidSchema.nullable().optional(),
  secondaryPlayerRegistrationId: uuidSchema.nullable().optional(),
  minute: z.number().int().min(0).max(150),
  addedMinutes: z.number().int().min(0).max(30).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  clientTimestamp: isoDateTime.nullable().optional(),
};

export const matchEventCreateSchema = z
  .object({
    clientEventId: uuidSchema,
    ...eventFields,
  })
  .strict();

export const matchEventCorrectSchema = z
  .object({
    eventType: z.enum(matchEventTypes).optional(),
    teamRegistrationId: uuidSchema.nullable().optional(),
    playerRegistrationId: uuidSchema.nullable().optional(),
    secondaryPlayerRegistrationId: uuidSchema.nullable().optional(),
    minute: z.number().int().min(0).max(150).optional(),
    addedMinutes: z.number().int().min(0).max(30).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    clientTimestamp: isoDateTime.nullable().optional(),
    reason,
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).some(
        (key) => key !== 'reason' && value[key as keyof typeof value] !== undefined,
      ),
    'At least one corrected field is required.',
  );

export const matchEventVoidSchema = z.object({ reason }).strict();

export const matchReportSchema = z
  .object({
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const matchResultCorrectSchema = z.object({ reason }).strict();

export const matchReinstateSchema = z.object({}).strict();

export const matchOfficialAssignSchema = z
  .object({
    userId: uuidSchema,
    role: z.enum(['official']).optional(),
  })
  .strict();

export const matchOfficialUpdateSchema = z
  .object({
    role: z.enum(['official']).optional(),
  })
  .strict();

export type MatchEventCreate = z.infer<typeof matchEventCreateSchema>;
export type MatchEventCorrect = z.infer<typeof matchEventCorrectSchema>;
