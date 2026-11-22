import { describe, expect, it } from 'vitest';
import { getFormation, validateFormationPositions } from '../src/modules/lineups/formations.js';
import { lineupCreateSchema, lineupPositions, MAX_LINEUP_SUBSTITUTES } from '../src/modules/lineups/schemas.js';

describe('detailed tactical lineup positions', () => {
  it('accepts exact tactical positions that fit the selected formation lines', () => {
    const formation = getFormation('4-3-3');
    expect(formation).not.toBeNull();
    const starters = [
      { position: 'GK' as const, x: 50, y: 5 },
      ...formation!.slots.map((slot, index) => ({
        position: (['CB', 'LB', 'RB', 'CB', 'DM', 'CM', 'AM', 'LW', 'CF', 'RW'] as const)[index]!,
        x: slot.x,
        y: slot.y,
      })),
    ];

    expect(validateFormationPositions(formation!, starters)).toBeNull();
  });

  it('rejects a detailed role outside its formation line without changing the stored assignment', () => {
    const formation = getFormation('4-3-3')!;
    const starters = [
      { position: 'GK' as const, x: 50, y: 5 },
      ...formation.slots.map((slot) => ({ position: slot.position, x: slot.x, y: slot.y })),
    ];
    starters[1] = { ...starters[1]!, position: 'DM', x: formation.slots[0]!.x, y: formation.slots[0]!.y };

    expect(validateFormationPositions(formation, starters)).toContain('do not match an available');
  });

  it('continues to accept broad legacy positions for existing lineups', () => {
    const formation = getFormation('4-3-3')!;
    const starters = [
      { position: 'GK' as const, x: 50, y: 5 },
      ...formation.slots.map((slot) => ({ position: slot.position, x: slot.x, y: slot.y })),
    ];

    expect(validateFormationPositions(formation, starters)).toBeNull();
  });

  it('supports SS and enforces the 0–11 substitute range at the request schema', () => {
    expect(lineupPositions).toContain('SS');
    expect(MAX_LINEUP_SUBSTITUTES).toBe(11);
    const make = (count: number) => lineupCreateSchema.safeParse({
      teamRegistrationId: '00000000-0000-4000-8000-000000000001',
      players: Array.from({ length: count }, (_, index) => ({
        playerRegistrationId: `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`,
        role: 'substitute',
        position: 'SS',
        shirtNumber: index + 1,
      })),
    });

    expect(make(0).success).toBe(true);
    expect(make(11).success).toBe(true);
    expect(make(12).success).toBe(false);
  });
});
