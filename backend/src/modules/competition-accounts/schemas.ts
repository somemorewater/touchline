import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

/** Operational roles a competition administrator may provision. */
export const competitionAccountRoles = ['match_official', 'commentary_operator'] as const;

export const competitionAccountCreateSchema = z
  .object({
    email: z.email().max(320),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(2).max(160),
    role: z.enum(competitionAccountRoles),
    competitionId: uuidSchema,
  })
  .strict();
