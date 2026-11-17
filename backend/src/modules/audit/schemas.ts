import { z } from 'zod';
import { uuidSchema } from '../../shared/schema.js';

export const auditListQuerySchema = z
  .object({
    competitionId: uuidSchema.optional(),
    seasonId: uuidSchema.optional(),
    actorUserId: uuidSchema.optional(),
    action: z.string().trim().min(1).max(100).optional(),
    entityType: z.string().trim().min(1).max(80).optional(),
    entityId: uuidSchema.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()
  .refine((value) => !value.from || !value.to || new Date(value.to) >= new Date(value.from), {
    message: 'to must not precede from.',
  });
