import { z } from 'zod';

export const notificationListQuerySchema = z
  .object({
    unreadOnly: z.coerce.boolean().optional(),
    type: z.string().trim().min(1).max(60).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
