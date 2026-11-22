import type { PlayerPosition } from '@/types';
import { positionCategory } from './positions';

/** Formations the demo data can choose from. Any 10-outfield formation string is also parsed. */
export const SUPPORTED_FORMATIONS = [
  '4-3-3',
  '4-4-2',
  '4-2-3-1',
  '3-5-2',
  '3-4-3',
  '4-1-4-1',
  '5-3-2',
] as const;

export type FormationCategory = 'GK' | 'DF' | 'MF' | 'FW';

export interface PitchSlot {
  /** 0-100 across the pitch. */
  x: number;
  /** 0-100 up the pitch from the team's own goal line. */
  y: number;
}

export interface PlacedPlayer<T> {
  player: T;
  slot: PitchSlot;
}

export type PitchSide = 'home' | 'away';

/**
 * Turns a formation string such as "4-2-3-1" into row counts, goalkeeper first.
 * The shape comes from the data, not a hardcoded branch per formation.
 */
export function formationRows(formation?: string): number[] {
  if (!formation) return [];
  const rows = formation
    .trim()
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);

  if (rows.length < 2) return [];
  if (rows.reduce((total, n) => total + n, 0) !== 10) return [];
  return [1, ...rows];
}

/**
 * The first outfield row is defence, the last is attack, and any rows between are midfield.
 * This covers every formation listed in the requirement and any similar 10-outfield shape.
 */
export function rowCategories(rows: number[]): FormationCategory[] {
  const outfieldRows = rows.length - 1;
  return rows.map((_, index) => {
    if (index === 0) return 'GK';
    if (index === 1) return 'DF';
    if (index === rows.length - 1) return 'FW';
    return 'MF';
  }).map((category, index) => (outfieldRows === 1 && index === 1 ? 'FW' : category));
}

/** Evenly spaced slots for each formation row, from goalkeeper (low y) to attack (high y). */
export function rowSlots(rows: number[]): PitchSlot[][] {
  const outfieldRows = rows.length - 1;
  return rows.map((count, rowIndex) => {
    const y = rowIndex === 0
      ? 8
      : outfieldRows <= 1
        ? 55
        : 26 + ((rowIndex - 1) / (outfieldRows - 1)) * 56;

    return Array.from({ length: count }, (_, index) => ({
      x: ((index + 1) / (count + 1)) * 100,
      y,
    }));
  });
}

/**
 * Maps a team-relative slot (where y runs up from the team's own goal) onto a
 * full-length combined pitch. Home defends the top goal and away the bottom,
 * so both starting XIs face each other. Away's X axis is mirrored too, which
 * keeps its left and right sides correct from the team's own point of view.
 */
export function orientSlot(slot: PitchSlot, side: PitchSide): PitchSlot {
  const x = Math.min(100, Math.max(0, slot.x));
  const teamY = Math.min(100, Math.max(0, slot.y));
  const y = 8 + (teamY / 100) * 42;

  return side === 'home'
    ? { x, y }
    : { x: 100 - x, y: 100 - y };
}

/**
 * Places a starting XI using the supplied formation and each player's recorded position.
 * Explicit pitch slots always win; otherwise the formation rows provide the coordinates.
 * Returns an empty array when there is no usable formation or the XI is incomplete.
 */
export function placeStarters<T extends { position?: PlayerPosition; slot?: PitchSlot }>(
  formation: string | undefined,
  players: T[],
): PlacedPlayer<T>[] {
  const rows = formationRows(formation);

  if (rows.length > 0 && players.length === 11) {
    const categories = rowCategories(rows);
    const groups: Record<FormationCategory, T[]> = { GK: [], DF: [], MF: [], FW: [] };
    const unknown: T[] = [];

    for (const player of players) {
      const category = positionCategory(player.position);
      if (category) groups[category].push(player);
      else unknown.push(player);
    }

    const assigned: T[][] = rows.map(() => []);
    for (let row = 0; row < rows.length; row++) {
      const category = categories[row]!;
      const count = rows[row]!;
      while (assigned[row]!.length < count && groups[category].length > 0) {
        assigned[row]!.push(groups[category].shift()!);
      }
    }

    const leftovers = [...unknown, ...groups.GK, ...groups.DF, ...groups.MF, ...groups.FW];
    for (let row = 0; row < rows.length; row++) {
      while (assigned[row]!.length < rows[row]! && leftovers.length > 0) {
        assigned[row]!.push(leftovers.shift()!);
      }
    }

    const slots = rowSlots(rows);
    return assigned.flatMap((rowPlayers, row) => rowPlayers.map((player, index) => ({
      player,
      slot: player.slot ?? slots[row]![index] ?? { x: 50, y: 50 },
    })));
  }

  if (players.length > 0 && players.every((player) => player.slot)) {
    return players.map((player) => ({ player, slot: player.slot! }));
  }

  return [];
}
