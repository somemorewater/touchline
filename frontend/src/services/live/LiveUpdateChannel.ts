import type { Id, MatchEvent, MatchStatus, Score } from '@/types';

export type LiveUpdate =
  | { kind: 'score'; matchId: Id; score: Score }
  | { kind: 'status'; matchId: Id; status: MatchStatus }
  | { kind: 'event'; matchId: Id; event: MatchEvent }
  | { kind: 'standings-stale'; competitionId: Id };

export interface LiveUpdateChannel {
  readonly transport: 'none' | 'websocket' | 'sse';
  subscribe(topic: { matchId?: Id; competitionId?: Id }, onUpdate: (u: LiveUpdate) => void): () => void;
}

/** No real-time connection exists yet. This says so honestly and never emits updates. */
export const noLiveChannel: LiveUpdateChannel = {
  transport: 'none',
  subscribe: () => () => undefined,
};
