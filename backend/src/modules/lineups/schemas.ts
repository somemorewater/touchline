import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';
import { acceptedPlayerPositionCodes, playerPositionCodes } from '../../shared/positions.js';

export const lineupRoles = ['starter', 'substitute'] as const;
export const lineupPositions = acceptedPlayerPositionCodes;
export const lineupStatuses = [
  'draft',
  'submitted',
  'confirmed',
  'returned',
  'published',
] as const;

export const MAX_LINEUP_SUBSTITUTES = 11;

const coordinate = z.number().min(0).max(100);

export const lineupPlayerInputSchema = z
  .object({
    playerRegistrationId: uuidSchema,
    role: z.enum(lineupRoles),
    position: z.enum(lineupPositions),
    shirtNumber: z.number().int().min(1).max(99),
    x: coordinate.nullable().optional(),
    y: coordinate.nullable().optional(),
    isCaptain: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.x === undefined || value.x === null) ===
      (value.y === undefined || value.y === null),
    { message: 'Pitch coordinates must be provided as a pair.', path: ['x'] },
  );

const lineupPlayersSchema = z.array(lineupPlayerInputSchema).max(40).superRefine((players, ctx) => {
  const substitutes = players.filter((player) => player.role === 'substitute');
  if (substitutes.length > MAX_LINEUP_SUBSTITUTES) {
    ctx.addIssue({ code: 'custom', message: `A lineup can contain at most ${MAX_LINEUP_SUBSTITUTES} substitutes.`, path: [] });
  }
  players.forEach((player, index) => {
    if (player.role === 'substitute' && !playerPositionCodes.includes(player.position as (typeof playerPositionCodes)[number])) {
      ctx.addIssue({
        code: 'custom',
        message: 'Each substitute needs one of the supported tactical positions.',
        path: [index, 'position'],
      });
    }
  });
});

const formation = z
  .string()
  .trim()
  .max(32)
  .regex(/^[1-9][0-9]*(-[1-9][0-9]*)+$/, 'Expected a dash-separated formation such as 4-3-3.');

export const lineupCreateSchema = z
  .object({
    teamRegistrationId: uuidSchema,
    formation: formation.nullable().optional(),
    players: lineupPlayersSchema.default([]),
  })
  .strict();

export const lineupUpdateSchema = z
  .object({
    formation: formation.nullable().optional(),
    players: lineupPlayersSchema.optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.formation !== undefined || value.players !== undefined,
    { message: 'Provide a formation, players, or both.' },
  );

export const lineupReviewSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export const lineupHistoryQuerySchema = z
  .object({
    seasonId: uuidSchema.optional(),
    competitionId: uuidSchema.optional(),
    status: z.enum(lineupStatuses).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const lineupReturnSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export const lineupListQuerySchema = z
  .object({
    matchId: uuidSchema.optional(),
    teamRegistrationId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    competitionId: uuidSchema.optional(),
    status: z.enum(lineupStatuses).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()
  .refine((value) => !(value.matchId && value.teamRegistrationId), {
    message: 'Filter by matchId or teamRegistrationId, not both.',
  });

export type LineupPlayerInput = z.infer<typeof lineupPlayerInputSchema>;
export type LineupCreate = z.infer<typeof lineupCreateSchema>;
export type LineupUpdate = z.infer<typeof lineupUpdateSchema>;
export type LineupReview = z.infer<typeof lineupReviewSchema>;
export type LineupReturn = z.infer<typeof lineupReturnSchema>;
export type LineupListQuery = z.infer<typeof lineupListQuerySchema>;
