import type { MatchEvent } from '@/types';

export type LineupEventKind = 'goal' | 'own-goal' | 'assist' | 'yellow' | 'red' | 'sub-on' | 'sub-off' | 'injury';

export interface LineupEvent {
  kind: LineupEventKind;
  label: string;
  minute: number;
}

/** Groups match events by the player they belong to, including both sides of a substitution. */
export function buildLineupEventMap(events: MatchEvent[]): Map<string, LineupEvent[]> {
  const map = new Map<string, LineupEvent[]>();
  const add = (playerId: string | undefined, event: LineupEvent) => {
    if (!playerId) return;
    map.set(playerId, [...(map.get(playerId) ?? []), event]);
  };

  for (const event of events) {
    switch (event.type) {
      case 'goal':
        add(event.playerId, { kind: 'goal', label: 'Goal', minute: event.minute });
        add(event.assistPlayerId, { kind: 'assist', label: 'Assist', minute: event.minute });
        break;
      case 'own-goal':
        add(event.playerId, { kind: 'own-goal', label: 'Own goal', minute: event.minute });
        break;
      case 'penalty-scored':
        add(event.playerId, { kind: 'goal', label: 'Penalty scored', minute: event.minute });
        break;
      case 'yellow-card':
        add(event.playerId, { kind: 'yellow', label: 'Yellow card', minute: event.minute });
        break;
      case 'second-yellow':
        add(event.playerId, { kind: 'red', label: 'Second yellow', minute: event.minute });
        break;
      case 'red-card':
        add(event.playerId, { kind: 'red', label: 'Red card', minute: event.minute });
        break;
      case 'substitution':
        add(event.playerOffId, { kind: 'sub-off', label: 'Substituted off', minute: event.minute });
        add(event.playerOnId, { kind: 'sub-on', label: 'Substituted on', minute: event.minute });
        break;
      case 'injury':
        add(event.playerId, { kind: 'injury', label: 'Injury', minute: event.minute });
        break;
      default:
        break;
    }
  }

  return map;
}
