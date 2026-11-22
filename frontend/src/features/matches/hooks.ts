'use client';

import { useQuery } from '@tanstack/react-query';
import { services } from '@/services';
import { isLive } from '@/lib/match';

export const useMatches = (q: { competitionId?: string; seasonId?: string; teamId?: string; leagueId?: string }) =>
  useQuery({
    queryKey: ['matches', q],
    queryFn: () => services.matches.list({ competitionId: q.competitionId!, seasonId: q.seasonId!, teamId: q.teamId, leagueId: q.leagueId }),
    enabled: !!q.competitionId && !!q.seasonId,
  });
/**
 * Match detail polls while the match is live. The WebSocket, when available,
 * invalidates this query immediately; polling keeps the score correct for
 * anonymous visitors and when the socket cannot be opened.
 */
export const useMatchDetail = (matchId: string) =>
  useQuery({
    queryKey: ['match', matchId],
    queryFn: () => services.matches.get(matchId),
    enabled: Boolean(matchId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      if (isLive(data.match.status)) return 15_000;
      const kickoffAt = data.match.kickoffAt;
      if (!kickoffAt) return false;
      const kickoffMs = Date.parse(kickoffAt);
      const availabilityMs = kickoffMs - 60 * 60 * 1000;
      if (Date.now() < availabilityMs) {
        return Math.min(availabilityMs - Date.now() + 500, 60 * 60 * 1000);
      }
      if (Date.now() < kickoffMs) return 60_000;
      return false;
    },
  });
