'use client';

import { useQuery } from '@tanstack/react-query';
import { services } from '@/services';

export const useCompetitions = () => useQuery({ queryKey: ['competitions'], queryFn: () => services.competitions.list() });
export const useCompetition = (key: string) =>
  useQuery({
    queryKey: ['competition', key],
    queryFn: () => services.competitions.get(key),
    enabled: Boolean(key),
  });
export const useSeasons = (competitionId?: string) =>
  useQuery({ queryKey: ['seasons', competitionId], queryFn: () => services.competitions.listSeasons(competitionId!), enabled: !!competitionId });
export const useLeagues = (competitionId?: string, seasonId?: string) =>
  useQuery({
    queryKey: ['leagues', competitionId, seasonId],
    queryFn: () => services.competitions.listLeagues(competitionId!, seasonId!),
    enabled: !!competitionId && !!seasonId,
  });
