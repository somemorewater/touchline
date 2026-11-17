import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

const isoDateTime = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(3).max(2000);

export const disciplinaryCaseStatuses = [
  'open',
  'under_review',
  'awaiting_response',
  'decided',
  'appealed',
  'closed',
] as const;

export const disciplinarySubjectTypes = ['player', 'team', 'official', 'match', 'other'] as const;

export const disciplinaryOriginTypes = [
  'match_event',
  'referee_report',
  'competition_administration',
  'other',
] as const;

export const disciplinarySanctionTypes = [
  'warning',
  'match_suspension',
  'competition_suspension',
  'other',
] as const;

export const disciplinaryCaseCreateSchema = z
  .object({
    competitionId: uuidSchema,
    seasonId: uuidSchema.nullable().optional(),
    subjectType: z.enum(disciplinarySubjectTypes),
    subjectPlayerRegistrationId: uuidSchema.nullable().optional(),
    subjectUserId: uuidSchema.nullable().optional(),
    subjectTeamRegistrationId: uuidSchema.nullable().optional(),
    originType: z.enum(disciplinaryOriginTypes),
    originMatchId: uuidSchema.nullable().optional(),
    originEventId: uuidSchema.nullable().optional(),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(3).max(10_000),
  })
  .strict()
  .refine(
    (value) =>
      value.subjectPlayerRegistrationId ||
      value.subjectUserId ||
      value.subjectTeamRegistrationId ||
      value.originMatchId,
    'A case requires a player, user, team or match subject.',
  )
  .refine(
    (value) => value.originEventId === undefined || Boolean(value.originMatchId),
    'originEventId requires originMatchId.',
  );

export const disciplinaryListQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    status: z.enum(disciplinaryCaseStatuses).optional(),
    subjectType: z.enum(disciplinarySubjectTypes).optional(),
    assignedToMe: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const disciplinaryAssignSchema = z
  .object({
    reviewerId: uuidSchema,
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const disciplinaryReviewSchema = z
  .object({
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const disciplinaryAwaitingResponseSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export const disciplinaryFindingSchema = z
  .object({
    body: z.string().trim().min(3).max(10_000),
  })
  .strict();

export const disciplinaryDecisionSchema = z
  .object({
    decision: z.string().trim().min(3).max(10_000),
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const disciplinaryAppealSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export const disciplinaryCloseSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export const disciplinaryNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(10_000),
    isInternal: z.boolean().optional(),
  })
  .strict();

export const disciplinarySanctionCreateSchema = z
  .object({
    subjectType: z.enum(['player', 'team', 'official', 'other']),
    subjectPlayerRegistrationId: uuidSchema.nullable().optional(),
    subjectUserId: uuidSchema.nullable().optional(),
    subjectTeamRegistrationId: uuidSchema.nullable().optional(),
    sanctionType: z.enum(disciplinarySanctionTypes),
    reason: z.string().trim().min(3).max(5000),
    matchesCount: z.number().int().min(1).max(200).nullable().optional(),
    startsAt: isoDateTime.nullable().optional(),
    endsAt: isoDateTime.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.subjectPlayerRegistrationId ||
      value.subjectUserId ||
      value.subjectTeamRegistrationId,
    'A sanction requires a player, user or team subject.',
  )
  .refine(
    (value) =>
      !['match_suspension', 'competition_suspension'].includes(value.sanctionType) ||
      value.matchesCount !== undefined ||
      value.endsAt !== undefined,
    'A suspension requires a match count or an end date.',
  )
  .refine(
    (value) =>
      !value.startsAt || !value.endsAt || new Date(value.endsAt) >= new Date(value.startsAt),
    'endsAt must not precede startsAt.',
  );

export const eligibilityQuerySchema = z
  .object({
    matchId: uuidSchema.optional(),
    at: isoDateTime.optional(),
  })
  .strict();
