import { formationLineForPosition, type AcceptedPlayerPosition } from '../../shared/positions.js';

export type OutfieldPosition = 'DF' | 'MF' | 'FW';

export interface FormationSlot {
  /** Stable slot key within a formation, e.g. `DF1`. */
  slot: string;
  position: OutfieldPosition;
  /** Lateral coordinate: 0 = left touchline, 100 = right touchline. */
  x: number;
  /** Depth coordinate: 0 = own goal line, 100 = opponent goal line. */
  y: number;
}

export interface FormationDefinition {
  id: string;
  segments: readonly number[];
  slots: readonly FormationSlot[];
  goalkeeperSlot: { x: number; y: number };
}

/**
 * Data-driven formation catalogue. The dash pattern describes the ten outfield
 * players from defence to attack; every supported formation must total ten.
 * Adding a formation only requires a new entry here.
 */
const FORMATION_SEGMENTS: Record<string, readonly number[]> = {
  '4-3-3': [4, 3, 3],
  '4-4-2': [4, 4, 2],
  '4-2-3-1': [4, 2, 3, 1],
  '3-5-2': [3, 5, 2],
  '3-4-3': [3, 4, 3],
  '4-1-4-1': [4, 1, 4, 1],
  '5-3-2': [5, 3, 2],
};

export const FORMATION_IDS = Object.freeze(Object.keys(FORMATION_SEGMENTS));

export const GOALKEEPER_SLOT = Object.freeze({ x: 50, y: 5 });

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function linePosition(index: number, lineCount: number): OutfieldPosition {
  if (index === 0) return 'DF';
  if (index === lineCount - 1) return 'FW';
  return 'MF';
}

function buildSlots(segments: readonly number[]): FormationSlot[] {
  const slots: FormationSlot[] = [];
  const counts = new Map<OutfieldPosition, number>();
  const depthRange = 70;
  const lateralRange = 60;
  const lineCount = segments.length;

  segments.forEach((count, lineIndex) => {
    const position = linePosition(lineIndex, lineCount);
    const y =
      lineCount === 1
        ? 50
        : roundCoordinate(15 + (lineIndex * depthRange) / (lineCount - 1));
    for (let playerIndex = 0; playerIndex < count; playerIndex += 1) {
      const ordinal = (counts.get(position) ?? 0) + 1;
      counts.set(position, ordinal);
      const x =
        count === 1
          ? 50
          : roundCoordinate(50 + (playerIndex - (count - 1) / 2) * (lateralRange / count));
      slots.push({ slot: `${position}${ordinal}`, position, x, y });
    }
  });

  return slots;
}

const DEFINITIONS = new Map<string, FormationDefinition>();
for (const [id, segments] of Object.entries(FORMATION_SEGMENTS)) {
  DEFINITIONS.set(
    id,
    Object.freeze({
      id,
      segments,
      slots: Object.freeze(buildSlots(segments)),
      goalkeeperSlot: GOALKEEPER_SLOT,
    }),
  );
}

export function getFormation(id: string | null | undefined): FormationDefinition | null {
  if (!id) return null;
  return DEFINITIONS.get(id) ?? null;
}

export function listFormations(): FormationDefinition[] {
  return [...DEFINITIONS.values()];
}

export function isSupportedFormation(id: string): boolean {
  return DEFINITIONS.has(id);
}

export function formationOutfieldCount(id: string): number | null {
  return getFormation(id)?.slots.length ?? null;
}

/** Coordinate equality tolerance for persisted numeric(5,2) values. */
export const SLOT_TOLERANCE = 0.01;

export function slotMatches(
  slot: { x: number; y: number },
  x: number,
  y: number,
): boolean {
  return Math.abs(slot.x - x) <= SLOT_TOLERANCE && Math.abs(slot.y - y) <= SLOT_TOLERANCE;
}

export interface PositionedStarter {
  position: AcceptedPlayerPosition | null;
  x: number | null;
  y: number | null;
}

/**
 * Verifies that outfield starters occupy every formation slot exactly once and
 * that their declared positions match the formation lines. The goalkeeper is
 * validated separately because formations describe only the ten outfield roles.
 */
export function validateFormationPositions(
  formation: FormationDefinition,
  starters: readonly PositionedStarter[],
): string | null {
  const outfield = starters.filter(
    (player): player is PositionedStarter & { position: AcceptedPlayerPosition } =>
      player.position !== null && formationLineForPosition(player.position) !== 'GK',
  );
  const goalkeepers = starters.filter(
    (player) => player.position !== null && formationLineForPosition(player.position) === 'GK',
  );
  if (goalkeepers.length !== 1) {
    return 'A complete starting XI must contain exactly one goalkeeper.';
  }
  if (outfield.length !== formation.slots.length) {
    return `Formation ${formation.id} requires ${formation.slots.length} outfield starters.`;
  }

  const used = new Set<number>();
  for (const player of outfield) {
    if (player.position === null || player.x === null || player.y === null) {
      return 'Every starting outfield player must have a position and pitch coordinates.';
    }
    const slotIndex = formation.slots.findIndex(
      (slot, index) =>
        !used.has(index) &&
        slot.position === formationLineForPosition(player.position) &&
        slotMatches(slot, player.x!, player.y!),
    );
    if (slotIndex === -1) {
      return `Player coordinates (${player.x}, ${player.y}) do not match an available ${player.position} slot in formation ${formation.id}.`;
    }
    used.add(slotIndex);
  }
  if (used.size !== formation.slots.length) {
    return `Formation ${formation.id} requires all ${formation.slots.length} outfield slots to be filled.`;
  }
  return null;
}
