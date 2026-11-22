/**
 * Detailed player positions accepted for player profiles and registrations.
 * `legacyPlayerPositionCodes` keeps existing records valid; it must not be
 * used to infer a narrower position for a player.
 */
export const playerPositionCodes = [
  'GK',
  'CB',
  'LB',
  'RB',
  'DM',
  'CM',
  'RM',
  'LM',
  'AM',
  'LW',
  'RW',
  'CF',
  'SS',
] as const;

export const legacyPlayerPositionCodes = ['DF', 'MF', 'FW'] as const;

export const acceptedPlayerPositionCodes = [
  ...playerPositionCodes,
  ...legacyPlayerPositionCodes,
] as const;

export type PlayerPosition = (typeof playerPositionCodes)[number];
export type LegacyPlayerPosition = (typeof legacyPlayerPositionCodes)[number];
export type AcceptedPlayerPosition = (typeof acceptedPlayerPositionCodes)[number];

export type FormationLine = 'GK' | 'DF' | 'MF' | 'FW';

const POSITION_LINES: Record<AcceptedPlayerPosition, FormationLine> = {
  GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF',
  DM: 'MF', CM: 'MF', RM: 'MF', LM: 'MF', AM: 'MF',
  LW: 'FW', RW: 'FW', CF: 'FW', SS: 'FW', DF: 'DF', MF: 'MF', FW: 'FW',
};

export function formationLineForPosition(position: AcceptedPlayerPosition): FormationLine {
  return POSITION_LINES[position];
}
