import { z } from 'zod';
import { dateOnlySchema, uuidSchema } from '../../shared/schema.js';
import { registrationStatuses } from '../teams/schemas.js';

export const playerInputSchema = z
  .object({
    fullName: z.string().trim().min(2).max(180),
    department: z.string().trim().max(120).nullable().optional(),
    dateOfBirth: dateOnlySchema.nullable().optional(),
    position: z.enum(['GK', 'DF', 'MF', 'FW']).nullable().optional(),
    preferredFoot: z.enum(['left', 'right', 'both']).nullable().optional(),
    contactEmail: z.email().max(320).nullable().optional(),
  })
  .strict();

export const playerRegistrationSubmitSchema = z
  .object({
    teamRegistrationId: uuidSchema,
    playerId: uuidSchema.optional(),
    player: playerInputSchema.optional(),
    matriculationNumber: z.string().trim().max(80).nullable().optional(),
    shirtNumber: z.number().int().min(1).max(99).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.playerId) !== Boolean(value.player),
    'Provide exactly one of playerId or player.',
  );

export const playerRegistrationListQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    teamId: uuidSchema.optional(),
    teamRegistrationId: uuidSchema.optional(),
    status: z.enum(registrationStatuses).optional(),
  })
  .strict();

export const playerRegistrationReviewSchema = z
  .object({
    reviewNote: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const playerRegistrationRejectSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();
