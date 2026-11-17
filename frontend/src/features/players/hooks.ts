'use client';

import { useQuery } from '@tanstack/react-query';
import { services } from '@/services';

export const usePlayers = (q: { teamId?: string; competitionId?: string }) =>
  useQuery({ queryKey: ['players', q], queryFn: () => services.players.list(q) });
export const usePlayer = (id: string) =>
  useQuery({
    queryKey: ['player', id],
    queryFn: () => services.players.get(id),
    enabled: Boolean(id),
  });
export const usePlayerStatistics = (competitionId?: string, seasonId?: string) =>
  useQuery({
    queryKey: ['player-statistics', competitionId, seasonId],
    queryFn: () => services.players.statistics({ competitionId: competitionId!, seasonId: seasonId! }),
    enabled: !!competitionId && !!seasonId,
  });
