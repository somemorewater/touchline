import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

export const disputeStatuses = [
  'draft',
  'submitted',
  'under_review',
  'awaiting_information',
  'decided',
  'closed',
] as const;

export const disputeSubjectTypes = [
  'match_result',
  'match_event',
  'player_eligibility',
  'team_participation',
  'competition_decision',
  'other',
] as const;

export const disputeOutcomes = [
  'accepted',
  'rejected',
  'partially_accepted',
  'no_action',
] as const;

export const disputeCreateSchema = z
  .object({
    competitionId: uuidSchema,
    seasonId: uuidSchema.nullable().optional(),
    matchId: uuidSchema.nullable().optional(),
    teamRegistrationId: uuidSchema.nullable().optional(),
    subjectType: z.enum(disputeSubjectTypes),
    subjectRefId: uuidSchema.nullable().optional(),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(3).max(10_000),
    submit: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !['match_result', 'match_event'].includes(value.subjectType) || Boolean(value.matchId),
    'A match dispute requires matchId.',
  );

export const disputeListQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    status: z.enum(disputeStatuses).optional(),
    subjectType: z.enum(disputeSubjectTypes).optional(),
    assignedToMe: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const disputeAssignSchema = z
  .object({
    reviewerId: uuidSchema,
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const disputeResponseSchema = z
  .object({
    body: z.string().trim().min(3).max(10_000),
    isInternal: z.boolean().optional(),
  })
  .strict();

export const disputeInformationRequestSchema = z
  .object({
    body: z.string().trim().min(3).max(10_000),
  })
  .strict();

export const disputeDecisionSchema = z
  .object({
    outcome: z.enum(disputeOutcomes),
    decision: z.string().trim().min(3).max(10_000),
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const disputeCloseSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export const disputeSubmitSchema = z.object({}).strict();

export const disputeReviewSchema = z
  .object({
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
