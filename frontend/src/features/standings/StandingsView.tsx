'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StandingsTable } from '@/components/ui/StandingsTable';
import type { StandingsMetaDto } from '@/lib/api/types';
import { useStandings } from './hooks';
import type { LeagueTable } from './types';
import styles from './StandingsView.module.css';

const TIE_LABEL: Record<string, string> = {
  goal_difference: 'goal difference',
  goals_for: 'goals scored',
  goals_against: 'goals conceded',
  wins: 'wins',
  head_to_head: 'head-to-head',
};

const tieLabel = (value: string) => TIE_LABEL[value] ?? value.replaceAll('_', ' ');

/** Rules come from the standings response `meta`, the only authoritative source. */
export function RulesNote({ metas }: { metas: StandingsMetaDto[] }) {
  const meta = metas[0];
  if (!meta) return null;
  const ignored = meta.ignoredTieBreakers.length > 0
    ? ` Unsupported tie-breakers ignored: ${meta.ignoredTieBreakers.map(tieLabel).join(', ')}.`
    : '';
  return (
    <p className={styles.note}>
      {meta.points.win} points for a win, {meta.points.draw} for a draw, {meta.points.loss} for a loss.
      Ties are broken by {meta.tieBreakers.map(tieLabel).join(', then ')}.
      {ignored} Computed from {meta.matchCount} confirmed {meta.matchCount === 1 ? 'result' : 'results'}.
    </p>
  );
}

export function LeagueTables({ tables, compact }: { tables: LeagueTable[]; compact?: boolean }) {
  return (
    <div className={styles.tables}>
      {tables.map((t) => <StandingsTable key={t.league.id || 'season'} caption={t.league.name} rows={t.rows} teams={t.teams} compact={compact} />)}
    </div>
  );
}

export function StandingsView() {
  const { tables, metas, competition, isLoading, isError, refetch } = useStandings();
  const [leagueId, setLeagueId] = useState('');
  const shown = leagueId ? tables.filter((t) => t.league.id === leagueId) : tables;

  return (
    <>
      <PageHeader
        title="Standings"
        lead={competition ? `${competition.name}. Tables are calculated by the competition server from confirmed results.` : undefined}
        aside={tables.length > 1 ? (
          <label className={styles.filter}>League
            <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
              <option value="">All leagues</option>
              {tables.map((t) => <option key={t.league.id || 'season'} value={t.league.id}>{t.league.name}</option>)}
            </select>
          </label>
        ) : undefined}
      />
      {isLoading ? <Skeleton lines={2} height={220} /> : isError ? <ErrorState onRetry={refetch} /> : shown.length === 0 ? (
        <EmptyState title="No tables yet">Tables appear once teams are placed in leagues and results are confirmed.</EmptyState>
      ) : (
        <>
          <LeagueTables tables={shown} />
          <RulesNote metas={metas} />
        </>
      )}
    </>
  );
}
