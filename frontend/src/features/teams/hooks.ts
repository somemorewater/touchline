'use client';

import { useQuery } from '@tanstack/react-query';
import { services } from '@/services';

export const useTeamEntries = (competitionId?: string, seasonId?: string) =>
  useQuery({
    queryKey: ['team-entries', competitionId, seasonId],
    queryFn: () => services.teams.listEntries({ competitionId: competitionId!, seasonId: seasonId! }),
    enabled: !!competitionId && !!seasonId,
  });
export const useTeam = (teamId: string) =>
  useQuery({
    queryKey: ['team', teamId],
    queryFn: () => services.teams.get(teamId),
    enabled: Boolean(teamId),
  });
export const useTeamStatistics = (competitionId?: string, seasonId?: string) =>
  useQuery({
    queryKey: ['team-statistics', competitionId, seasonId],
    queryFn: () => services.teams.statistics({ competitionId: competitionId!, seasonId: seasonId! }),
    enabled: !!competitionId && !!seasonId,
  });

export function useTeamMap(competitionId?: string, seasonId?: string) {
  const q = useTeamEntries(competitionId, seasonId);
  return { ...q, teams: new Map((q.data ?? []).map((e) => [e.team.id, e.team])) };
}
