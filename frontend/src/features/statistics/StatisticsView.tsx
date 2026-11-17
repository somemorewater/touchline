'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Leaderboard } from '@/components/ui/Leaderboard';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { usePlayers, usePlayerStatistics } from '@/features/players/hooks';
import { buildLeaderboard } from '@/features/players/lib/leaderboards';
import { useStandings } from '@/features/standings/hooks';
import { useTeamMap } from '@/features/teams/hooks';
import { signed } from '@/lib/format';
import styles from './Statistics.module.css';

type SortKey = 'goalsFor' | 'goalsAgainst' | 'perMatch' | 'won';

export function StatisticsView() {
  const { tables, isLoading, isError, refetch } = useStandings();
  const { competition, season } = useActiveCompetition();
  const { teams } = useTeamMap(competition?.id, season?.id);
  const playersQ = usePlayers({ competitionId: competition?.id });
  const playerStats = usePlayerStatistics(competition?.id, season?.id);
  const [sort, setSort] = useState<SortKey>('goalsFor');

  const players = useMemo(() => new Map((playersQ.data ?? []).map((p) => [p.id, p])), [playersQ.data]);
  const leaders = useMemo(() => {
    const stats = playerStats.data ?? [];
    return {
      goals: buildLeaderboard(stats, players, teams, 'goals'),
      appearances: buildLeaderboard(stats, players, teams, 'appearances'),
      yellowCards: buildLeaderboard(stats, players, teams, 'yellowCards'),
      cleanSheets: buildLeaderboard(stats, players, teams, 'cleanSheets'),
    };
  }, [playerStats.data, players, teams]);
  const hasLeaders = Object.values(leaders).some((rows) => rows.length > 0);

  const rows = useMemo(() => {
    const all = tables.flatMap((t) => t.rows.map((r) => ({ ...r, name: t.teams.get(r.teamId)?.name ?? r.teamId, league: t.league.name })));
    const per = (r: (typeof all)[number]) => (r.played ? r.goalsFor / r.played : -1);
    return all.sort((a, b) => sort === 'perMatch' ? per(b) - per(a) : sort === 'goalsAgainst' ? a.goalsAgainst - b.goalsAgainst : b[sort] - a[sort]);
  }, [tables, sort]);

  const played = rows.reduce((n, r) => n + r.played, 0) / 2;
  const goals = rows.reduce((n, r) => n + r.goalsFor, 0);

  return (
    <>
      <PageHeader title="Statistics" lead="Calculated by the competition server from confirmed results and lineups. Anything not recorded is shown as not recorded, never as zero." />
      {isLoading ? <Skeleton lines={4} /> : isError ? <ErrorState onRetry={refetch} /> : (
        <>
          <p className={styles.summary} role="status">
            {played > 0 ? `${played} matches played, ${goals} goals, ${(goals / played).toFixed(2)} goals per match.` : 'No confirmed results yet, so there are no team statistics to show.'}
          </p>
          <div className={styles.head}>
            <h2>Team table</h2>
            <label>Order by
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="goalsFor">Goals scored</option>
                <option value="goalsAgainst">Fewest goals conceded</option>
                <option value="perMatch">Goals per match</option>
                <option value="won">Wins</option>
              </select>
            </label>
          </div>
          {rows.length === 0 ? <EmptyState title="No teams">Teams appear once they are placed in leagues and results are confirmed.</EmptyState> : (
            <div className={styles.wrap}>
              <table>
                <caption className="sr-only">Team statistics</caption>
                <thead><tr><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">GF</th><th scope="col">GA</th><th scope="col">GD</th><th scope="col">Goals per match</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.teamId}>
                      <th scope="row"><Link href={`/teams/${r.teamId}`}>{r.name}</Link><small>{r.league}</small></th>
                      <td className="num">{r.played}</td><td className="num">{r.won}</td><td className="num">{r.drawn}</td><td className="num">{r.lost}</td>
                      <td className="num">{r.goalsFor}</td><td className="num">{r.goalsAgainst}</td><td className="num">{signed(r.goalDifference)}</td>
                      <td className="num">{r.played ? (r.goalsFor / r.played).toFixed(2) : 'No matches'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className={styles.leaders}>
            <h2>Player leaderboards</h2>
            {hasLeaders ? (
              <div className={styles.leaderGrid}>
                <section><h3>Top scorers</h3><Leaderboard rows={leaders.goals} unit="goals" /></section>
                <section><h3>Most appearances</h3><Leaderboard rows={leaders.appearances} unit="apps" /></section>
                <section><h3>Yellow cards</h3><Leaderboard rows={leaders.yellowCards} unit="cards" /></section>
                <section><h3>Clean sheets</h3><Leaderboard rows={leaders.cleanSheets} unit="clean sheets" /></section>
              </div>
            ) : (
              <EmptyState title="Player leaderboards">Goals, appearances, cards and clean sheets are counted from confirmed lineups and match events. None are recorded yet.</EmptyState>
            )}
          </div>
        </>
      )}
    </>
  );
}
