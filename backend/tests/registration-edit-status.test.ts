import { describe, expect, it } from 'vitest';
import { registrationDisplayStatus } from '../src/modules/registrations/status.js';
import { playerRegistrationListQuerySchema } from '../src/modules/registrations/schemas.js';

describe('player registration edit display status', () => {
  it('distinguishes pending and rejected proposals without changing the approved registration status', () => {
    expect(registrationDisplayStatus('approved', 'pending')).toBe('pending_changes');
    expect(registrationDisplayStatus('approved', 'rejected')).toBe('rejected_changes');
    expect(registrationDisplayStatus('approved', 'approved')).toBe('approved');
    expect(registrationDisplayStatus('submitted', 'pending')).toBe('submitted');
  });

  it('supports edit-aware display filters while preserving the database status filter', () => {
    expect(playerRegistrationListQuerySchema.safeParse({ displayStatus: 'pending_changes' }).success).toBe(true);
    expect(playerRegistrationListQuerySchema.safeParse({ displayStatus: 'rejected_changes' }).success).toBe(true);
    expect(playerRegistrationListQuerySchema.safeParse({ status: 'pending_changes' }).success).toBe(false);
  });
});
