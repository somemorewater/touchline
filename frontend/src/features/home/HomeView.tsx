'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Leaderboard } from '@/components/ui/Leaderboard';
import { MatchList } from '@/components/ui/MatchList';
import { Section } from '@/components/ui/Section';
import { StandingsTable } from '@/components/ui/StandingsTable';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useLeagues } from '@/features/competitions/hooks';
import { useMatches } from '@/features/matches/hooks';
import { useAnnouncements } from '@/features/news/hooks';
import { usePlayers, usePlayerStatistics } from '@/features/players/hooks';
import { buildLeaderboard } from '@/features/players/lib/leaderboards';
import { useStandings } from '@/features/standings/hooks';
import { useTeamMap } from '@/features/teams/hooks';
import { byKickoff, isFinished, isLive, isUpcoming } from '@/lib/match';
import { formatDay } from '@/lib/format';
import { DISPLAY_TIME_ZONE } from '@/types';
import styles from './HomeView.module.css';

export function HomeView() {
  const { competition, season, loading } = useActiveCompetition();
  const matchesQ = useMatches({ competitionId: competition?.id, seasonId: season?.id });
  const leaguesQ = useLeagues(competition?.id, season?.id);
  const { teams } = useTeamMap(competition?.id, season?.id);
  const standings = useStandings();
  const news = useAnnouncements(competition?.id);
  const playersQ = usePlayers({ competitionId: competition?.id });
  const playerStats = usePlayerStatistics(competition?.id, season?.id);
  const players = useMemo(() => new Map((playersQ.data ?? []).map((p) => [p.id, p])), [playersQ.data]);
  const scorers = buildLeaderboard(playerStats.data ?? [], players, teams, 'goals');
  const appearances = buildLeaderboard(playerStats.data ?? [], players, teams, 'appearances');

  const groups = useMemo(() => {
    const all = matchesQ.data ?? [];
    return {
      live: all.filter((m) => isLive(m.status)),
      upcoming: all.filter(isUpcoming).sort(byKickoff).slice(0, 5),
      results: all.filter(isFinished).sort((a, b) => byKickoff(b, a)).slice(0, 5),
    };
  }, [matchesQ.data]);

  if (loading) return <Skeleton lines={4} height={72} />;
  if (!competition || !season) return <EmptyState title="No competition set up yet">Competitions appear here once an administrator creates one.</EmptyState>;
  const tz = DISPLAY_TIME_ZONE;

  return (
    <>
      <section className={styles.mast} aria-labelledby="mast-title">
        <div className={styles.circle} aria-hidden />
        <div className={styles.mastText}>
          <p className={styles.season}>{season.label} season</p>
          <h1 id="mast-title">{competition.name}</h1>
          <p className={styles.lead}>{competition.description}</p>
          <p className={styles.facts}>
            {teams.size} teams in {leaguesQ.data?.length ?? 0} leagues. Standings update from confirmed results.
          </p>
        </div>
      </section>

      {matchesQ.isError ? <ErrorState title="Could not load matches" onRetry={() => void matchesQ.refetch()} /> : null}

      {groups.live.length > 0 ? (
        <Section title="Live now"><MatchList matches={groups.live} teams={teams} tz={tz} /></Section>
      ) : null}

      <div className={styles.cols}>
        <div>
          <Section title="Upcoming fixtures" aside={<Link href="/matches">All matches</Link>}>
            {matchesQ.isLoading ? <Skeleton /> : groups.upcoming.length > 0 ? (
              <MatchList matches={groups.upcoming} teams={teams} tz={tz} />
            ) : (
              <EmptyState title="No fixtures scheduled yet">The fixture list is published by the competition administrators. Check back once the schedule is confirmed.</EmptyState>
            )}
          </Section>
          <Section title="Recent results">
            {matchesQ.isLoading ? <Skeleton /> : groups.results.length > 0 ? (
              <MatchList matches={groups.results} teams={teams} tz={tz} />
            ) : (
              <EmptyState title="No results yet">Results appear here once a match is played and its score is confirmed.</EmptyState>
            )}
          </Section>
        </div>
        <div>
          <Section title="Standings" aside={<Link href="/standings">Full tables</Link>}>
            {standings.isLoading ? <Skeleton lines={2} height={200} /> : standings.isError ? (
              <ErrorState onRetry={standings.refetch} />
            ) : (
              <div className={styles.stack}>
                {standings.tables.map((t) => (
                  <StandingsTable key={t.league.id} caption={t.league.name} rows={t.rows} teams={t.teams} compact />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      <div className={styles.cols}>
        <Section title="Top scorers">
          {scorers.length > 0 ? (
            <Leaderboard rows={scorers} unit="goals" />
          ) : (
            <EmptyState title="No goals recorded yet">Scorer tables fill in once match officials record goals. Players with no recorded goals are not listed.</EmptyState>
          )}
        </Section>
        <Section title="Most appearances">
          {appearances.length > 0 ? (
            <Leaderboard rows={appearances} unit="apps" />
          ) : (
            <EmptyState title="No appearances recorded yet">Appearances are counted from confirmed lineups.</EmptyState>
          )}
        </Section>
      </div>

      <Section title="News and announcements" aside={<Link href="/news">All news</Link>}>
        {(news.data ?? []).length > 0 ? (
          <ul className={styles.news}>
            {news.data!.slice(0, 3).map((a) => (
              <li key={a.id}>
                <Link href={`/news/${a.id}`}>{a.title}</Link>
                <span>{formatDay(a.publishedAt, tz)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No announcements yet">Official notices and match reports will be posted here.</EmptyState>
        )}
      </Section>
    </>
  );
}
