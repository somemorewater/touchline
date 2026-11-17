'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { MatchRow } from '@/components/ui/MatchRow';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useLeagues } from '@/features/competitions/hooks';
import { useTeamMap } from '@/features/teams/hooks';
import { byKickoff, matchesFilter, type MatchFilter } from '@/lib/match';
import { dayKey, formatDay } from '@/lib/format';
import { DISPLAY_TIME_ZONE } from '@/types';
import type { Match } from '@/types';
import { useMatches } from './hooks';
import styles from './MatchesView.module.css';

const FILTERS: { id: MatchFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'live', label: 'Live' }, { id: 'upcoming', label: 'Upcoming' },
  { id: 'finished', label: 'Finished' }, { id: 'postponed', label: 'Postponed' }, { id: 'cancelled', label: 'Cancelled' },
];

export function MatchesView() {
  const { competition, season } = useActiveCompetition();
  const matchesQ = useMatches({ competitionId: competition?.id, seasonId: season?.id });
  const leaguesQ = useLeagues(competition?.id, season?.id);
  const { teams } = useTeamMap(competition?.id, season?.id);

  const [status, setStatus] = useState<MatchFilter>('all');
  const [leagueId, setLeagueId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [date, setDate] = useState('');
  const [text, setText] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');

  const tz = DISPLAY_TIME_ZONE;
  const all = useMemo(() => matchesQ.data ?? [], [matchesQ.data]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, all.filter((m) => matchesFilter(m, f.id)).length])) as Record<MatchFilter, number>, [all]);

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase();
    const name = (id: string) => teams.get(id)?.name.toLowerCase() ?? '';
    const out = all.filter((m) =>
      matchesFilter(m, status) &&
      (!leagueId || m.leagueId === leagueId) &&
      (!teamId || m.homeTeamId === teamId || m.awayTeamId === teamId) &&
      (!date || dayKey(m.kickoffAt, tz).split('/').reverse().join('-') === date) &&
      (!q || name(m.homeTeamId).includes(q) || name(m.awayTeamId).includes(q) || (m.venue ?? '').toLowerCase().includes(q)),
    ).sort(byKickoff);
    return order === 'asc' ? out : out.reverse();
  }, [all, status, leagueId, teamId, date, text, order, teams, tz]);

  const byDay = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of rows) map.set(dayKey(m.kickoffAt, tz), [...(map.get(dayKey(m.kickoffAt, tz)) ?? []), m]);
    return [...map.entries()];
  }, [rows, tz]);

  const filtersActive = status !== 'all' || leagueId || teamId || date || text;
  const reset = () => { setStatus('all'); setLeagueId(''); setTeamId(''); setDate(''); setText(''); };

  return (
    <>
      <PageHeader title="Matches" lead={`${all.length} ${all.length === 1 ? 'match' : 'matches'} in ${season?.label ?? 'this season'}.`} />

      <div className={styles.tabs} role="group" aria-label="Match status">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
            {f.label} <span className="num">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        <label>Search<input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Team or venue" /></label>
        <label>League
          <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
            <option value="">All leagues</option>
            {(leaguesQ.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label>Team
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">All teams</option>
            {[...teams.values()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Sort
          <select value={order} onChange={(e) => setOrder(e.target.value as 'asc' | 'desc')}>
            <option value="asc">Earliest first</option>
            <option value="desc">Latest first</option>
          </select>
        </label>
      </div>

      <p className={styles.count} role="status">{rows.length} shown</p>

      {matchesQ.isLoading ? <Skeleton lines={6} /> : matchesQ.isError ? <ErrorState title="Could not load matches" onRetry={() => void matchesQ.refetch()} /> : rows.length === 0 ? (
        all.length === 0 ? (
          <EmptyState title="No matches yet">The fixture list has not been published. It will appear here once the administrators confirm the schedule.</EmptyState>
        ) : (
          <EmptyState title="No matches fit these filters" action={filtersActive ? <button type="button" className={styles.reset} onClick={reset}>Clear filters</button> : undefined}>Try a different status, team or date.</EmptyState>
        )
      ) : (
        byDay.map(([key, list]) => (
          <section key={key} className={styles.day}>
            <h2>{formatDay(list[0]?.kickoffAt, tz)}</h2>
            <div className={styles.list}>{list.map((m) => <MatchRow key={m.id} match={m} teams={teams} tz={tz} showDay={false} />)}</div>
          </section>
        ))
      )}
    </>
  );
}
