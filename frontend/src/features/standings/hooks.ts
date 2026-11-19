'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useLeagues } from '@/features/competitions/hooks';
import { useTeamEntries } from '@/features/teams/hooks';
import { standingsApi } from '@/lib/api/endpoints';
import type { Competition, League } from '@/types';
import type { StandingsMetaDto } from '@/lib/api/types';
import type { LeagueTable, StandingRow } from './types';

/** Groups are the backend's "leagues"; a season without groups has one implicit table. */
function targetsFor(groups: League[], competitionId: string, seasonId: string): League[] {
  if (groups.length > 0) return groups;
  return [
    {
      id: '',
      competitionId,
      seasonId,
      name: 'All teams',
      kind: 'league',
      archivedAt: null,
    },
  ];
}

export function useStandingsFor(competition: Competition | undefined, seasonId: string | undefined) {
  const leaguesQ = useLeagues(competition?.id, seasonId);
  const entriesQ = useTeamEntries(competition?.id, seasonId);

  const groups = useMemo(() => leaguesQ.data ?? [], [leaguesQ.data]);
  // A grouped season has no whole-season table. Wait for the groups query to
  // settle before falling back to the implicit "All teams" target, otherwise
  // the server rejects a whole-season request with 400.
  const groupsReady = !leaguesQ.isLoading && !leaguesQ.isError;
  const targets = useMemo(
    () =>
      competition && seasonId && groupsReady
        ? targetsFor(groups, competition.id, seasonId)
        : [],
    [competition, seasonId, groups, groupsReady],
  );

  const queries = useQueries({
    queries: targets.map((target) => ({
      queryKey: ['standings', seasonId, target.id || null],
      queryFn: () =>
        standingsApi.get({
          seasonId: seasonId!,
          ...(target.id ? { groupId: target.id } : {}),
        }),
      enabled: Boolean(seasonId),
      staleTime: 30_000,
    })),
  });

  const tables = useMemo<LeagueTable[]>(() => {
    if (!competition || !seasonId || !entriesQ.data) return [];
    const approved = entriesQ.data.filter((entry) => entry.registration.status === 'approved');
    return targets.flatMap((league, index) => {
      const query = queries[index];
      if (!query?.data) return [];
      const inLeague = approved.filter((entry) =>
        league.id ? entry.registration.leagueId === league.id : true,
      );
      const rows: StandingRow[] = query.data.rows.map((row) => ({
        teamId: row.teamId,
        position: row.position,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalDifference,
        points: row.points,
      }));
      return [
        {
          league,
          teams: new Map(inLeague.map((entry) => [entry.team.id, entry.team])),
          rows,
          meta: query.data.meta,
        },
      ];
    });
  }, [competition, seasonId, entriesQ.data, targets, queries]);

  const metas = useMemo<StandingsMetaDto[]>(
    () => queries.flatMap((query) => (query.data ? [query.data.meta] : [])),
    [queries],
  );

  return {
    tables,
    metas,
    isLoading:
      Boolean(seasonId) &&
      (leaguesQ.isLoading || entriesQ.isLoading || queries.some((query) => query.isLoading)),
    isError: leaguesQ.isError || entriesQ.isError || queries.some((query) => query.isError),
    refetch: () => {
      void leaguesQ.refetch();
      void entriesQ.refetch();
      queries.forEach((query) => void query.refetch());
    },
  };
}

export function useStandings() {
  const { competition, season, loading } = useActiveCompetition();
  const standings = useStandingsFor(competition, season?.id);
  return { ...standings, competition, season, isLoading: loading || standings.isLoading };
}
