import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

export const administrationOverviewQuerySchema = z
  .object({
    seasonId: uuidSchema.optional(),
  })
  .strict();
