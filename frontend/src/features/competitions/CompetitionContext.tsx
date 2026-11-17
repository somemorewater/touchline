'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Competition, Season } from '@/types';
import { useCompetitions, useSeasons } from './hooks';

interface Ctx {
  loading: boolean;
  competitions: Competition[];
  competition?: Competition;
  seasons: Season[];
  season?: Season;
  selectCompetition(id: string): void;
  selectSeason(id: string): void;
}

const ActiveCompetition = createContext<Ctx | null>(null);
const KEY = 'touchline.competition';

export function CompetitionProvider({ children }: { children: ReactNode }) {
  const comps = useCompetitions();
  const [competitionId, setCompetitionId] = useState<string>();
  const [seasonId, setSeasonId] = useState<string>();

  useEffect(() => {
    try { setCompetitionId(localStorage.getItem(KEY) ?? undefined); } catch { /* preference only */ }
  }, []);

  const competitions = useMemo(() => comps.data ?? [], [comps.data]);
  const competition = competitions.find((c) => c.id === competitionId) ?? competitions[0];
  const seasonsQ = useSeasons(competition?.id);
  const seasons = useMemo(() => seasonsQ.data ?? [], [seasonsQ.data]);
  const season =
    seasons.find((s) => s.id === seasonId) ??
    seasons.find((s) => s.status === 'active') ??
    seasons.find((s) => s.status === 'planned') ??
    seasons[0];

  const selectCompetition = useCallback((id: string) => {
    setCompetitionId(id);
    setSeasonId(undefined);
    try { localStorage.setItem(KEY, id); } catch { /* preference only */ }
  }, []);

  const value = useMemo<Ctx>(
    () => ({ loading: comps.isLoading || seasonsQ.isLoading, competitions, competition, seasons, season, selectCompetition, selectSeason: setSeasonId }),
    [comps.isLoading, seasonsQ.isLoading, competitions, competition, seasons, season, selectCompetition],
  );
  return <ActiveCompetition.Provider value={value}>{children}</ActiveCompetition.Provider>;
}

export function useActiveCompetition(): Ctx {
  const v = useContext(ActiveCompetition);
  if (!v) throw new Error('useActiveCompetition must be used inside CompetitionProvider');
  return v;
}
