import { z } from 'zod';
import { uuidSchema, dateOnlySchema } from '../../shared/schema.js';

const statisticsBaseSchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    groupId: uuidSchema.optional(),
    teamId: uuidSchema.optional(),
    teamRegistrationId: uuidSchema.optional(),
    playerId: uuidSchema.optional(),
    playerRegistrationId: uuidSchema.optional(),
    matchId: uuidSchema.optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const statisticsFilterSchema = statisticsBaseSchema
  .refine((value) => !(value.teamId && value.teamRegistrationId), {
    message: 'Filter by teamId or teamRegistrationId, not both.',
  })
  .refine((value) => !(value.playerId && value.playerRegistrationId), {
    message: 'Filter by playerId or playerRegistrationId, not both.',
  });

export const playerStatisticsQuerySchema = statisticsFilterSchema;

export const teamStatisticsQuerySchema = statisticsBaseSchema.omit({
  playerId: true,
  playerRegistrationId: true,
});

export const playerRankingsQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    groupId: uuidSchema.optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    metric: z
      .enum(['goals', 'appearances', 'yellow_cards', 'red_cards', 'clean_sheets'])
      .default('goals'),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type StatisticsFilter = z.infer<typeof statisticsFilterSchema>;
export type TeamStatisticsQuery = z.infer<typeof teamStatisticsQuerySchema>;
export type PlayerRankingsQuery = z.infer<typeof playerRankingsQuerySchema>;
