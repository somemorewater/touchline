/** Player profile positions. Legacy broad codes remain valid for existing records. */
export const PLAYER_POSITIONS = [
  ['GK', 'Goalkeeper'],
  ['CB', 'Center Back'],
  ['LB', 'Left Back'],
  ['RB', 'Right Back'],
  ['DM', 'Defensive Midfielder'],
  ['CM', 'Center Midfielder'],
  ['RM', 'Right Midfielder'],
  ['LM', 'Left Midfielder'],
  ['AM', 'Attacking Midfielder'],
  ['LW', 'Left Wing'],
  ['RW', 'Right Wing'],
  ['CF', 'Center Forward'],
  ['SS', 'Second Striker'],
] as const;

export const LEGACY_PLAYER_POSITIONS = [
  ['DF', 'Defender'],
  ['MF', 'Midfielder'],
  ['FW', 'Forward'],
] as const;

export type PlayerPosition =
  | (typeof PLAYER_POSITIONS)[number][0]
  | (typeof LEGACY_PLAYER_POSITIONS)[number][0];

/** Formation lines used by lineups; detailed player positions map onto these. */
export type PositionCategory = 'GK' | 'DF' | 'MF' | 'FW';

export const PLAYER_POSITION_OPTIONS = [
  { value: '', label: 'Position not specified' },
  ...PLAYER_POSITIONS.map(([value, label]) => ({ value, label: `${label} (${value})` })),
] as const;

const LABELS: Record<PlayerPosition, string> = Object.fromEntries(
  [...PLAYER_POSITIONS, ...LEGACY_PLAYER_POSITIONS].map(([code, name]) => [code, `${name} (${code})`]),
) as Record<PlayerPosition, string>;

const CATEGORIES: Record<PlayerPosition, PositionCategory> = {
  GK: 'GK',
  CB: 'DF',
  LB: 'DF',
  RB: 'DF',
  DM: 'MF',
  CM: 'MF',
  RM: 'MF',
  LM: 'MF',
  AM: 'MF',
  LW: 'FW',
  RW: 'FW',
  CF: 'FW',
  SS: 'FW',
  DF: 'DF',
  MF: 'MF',
  FW: 'FW',
};

export function isPlayerPosition(value: string | null | undefined): value is PlayerPosition {
  return Boolean(value && value in CATEGORIES);
}

/** Human label such as `Center Back (CB)` or `Defender (DF)`. */
export function positionLabel(position: string | null | undefined): string | null {
  if (!position) return null;
  return isPlayerPosition(position) ? LABELS[position] : position;
}

/** Formation line for a detailed position; null when the value is unknown. */
export function positionCategory(position: string | null | undefined): PositionCategory | null {
  return position && isPlayerPosition(position) ? CATEGORIES[position] : null;
}
