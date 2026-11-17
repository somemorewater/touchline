'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Crest } from '@/components/ui/Crest';
import { MatchList } from '@/components/ui/MatchList';
import { Section } from '@/components/ui/Section';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useCompetition, useLeagues } from '@/features/competitions/hooks';
import { useMatches } from '@/features/matches/hooks';
import { usePlayers } from '@/features/players/hooks';
import { useStandingsFor } from '@/features/standings/hooks';
import { byKickoff, isFinished, isUpcoming } from '@/lib/match';
import { signed } from '@/lib/format';
import { DISPLAY_TIME_ZONE } from '@/types';
import { useTeam, useTeamMap, useTeamStatistics } from './hooks';
import styles from './Teams.module.css';

const REG_LABEL = {
  draft: 'Draft', submitted: 'Submitted', 'under-review': 'Under review',
  approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn',
} as const;

export function TeamProfile({ teamId }: { teamId: string }) {
  const teamQ = useTeam(teamId);
  const entry = teamQ.data;
  const compQ = useCompetition(entry?.registration.competitionId ?? '');
  const seasonId = entry?.registration.seasonId;
  const competition = compQ.data ?? undefined;
  const leagues = useLeagues(competition?.id, seasonId);
  const { teams } = useTeamMap(competition?.id, seasonId);
  const matchesQ = useMatches({ competitionId: competition?.id, seasonId, teamId });
  const standings = useStandingsFor(competition, seasonId);
  const players = usePlayers({ teamId });
  const teamStatsQ = useTeamStatistics(competition?.id, seasonId);

  const row = standings.tables.flatMap((t) => t.rows).find((r) => r.teamId === teamId);
  const teamStats = teamStatsQ.data?.find((s) => s.teamId === teamId);
  const groups = useMemo(() => {
    const all = matchesQ.data ?? [];
    return { upcoming: all.filter(isUpcoming).sort(byKickoff), results: all.filter(isFinished).sort((a, b) => byKickoff(b, a)) };
  }, [matchesQ.data]);

  if (teamQ.isLoading) return <Skeleton lines={3} height={80} />;
  if (teamQ.isError) return <ErrorState onRetry={() => void teamQ.refetch()} />;
  if (!entry) return <EmptyState title="Team not found" action={<Link href="/teams">All teams</Link>}>This team may have been removed or the link is wrong.</EmptyState>;

  const { team, registration } = entry;
  const league = leagues.data?.find((l) => l.id === registration.leagueId);
  const tz = DISPLAY_TIME_ZONE;

  return (
    <>
      <Link href="/teams" className={styles.back}>All teams</Link>
      <div className={styles.head}>
        <Crest name={team.name} size={72} />
        <div>
          <h1>{team.name}</h1>
          <div className={styles.meta}>
            <span>{competition?.name}</span>
            {league ? <span>{league.name}</span> : null}
            <span>Registration: {REG_LABEL[registration.status]}</span>
            {team.department ? <span>{team.department}</span> : null}
          </div>
        </div>
      </div>

      <Section title="Performance">
        {row ? (
          <dl className={styles.facts}>
            <div><dt>League position</dt><dd className="num">{row.played === 0 ? 'Not started' : row.position}</dd></div>
            <div><dt>Played</dt><dd className="num">{row.played}</dd></div>
            <div><dt>Won</dt><dd className="num">{row.won}</dd></div>
            <div><dt>Drawn</dt><dd className="num">{row.drawn}</dd></div>
            <div><dt>Lost</dt><dd className="num">{row.lost}</dd></div>
            <div><dt>Goals for</dt><dd className="num">{row.goalsFor}</dd></div>
            <div><dt>Goals against</dt><dd className="num">{row.goalsAgainst}</dd></div>
            <div><dt>Goal difference</dt><dd className="num">{signed(row.goalDifference)}</dd></div>
            <div><dt>Points</dt><dd className="num">{row.points}</dd></div>
          </dl>
        ) : <Skeleton lines={1} height={80} />}
      </Section>

      <Section title="Upcoming fixtures">
        {groups.upcoming.length ? <MatchList matches={groups.upcoming} teams={teams} tz={tz} /> : <EmptyState title="No upcoming fixtures">Fixtures for this team appear once the schedule is published.</EmptyState>}
      </Section>
      <Section title="Results">
        {groups.results.length ? <MatchList matches={groups.results} teams={teams} tz={tz} /> : <EmptyState title="No results yet">Confirmed results will be listed here.</EmptyState>}
      </Section>
      <Section title="Squad">
        {(players.data ?? []).length ? (
          <ul>{players.data!.map((p) => <li key={p.id}><Link href={`/players/${p.id}`}>{p.shirtNumber ? `${p.shirtNumber}. ` : ''}{p.fullName}</Link></li>)}</ul>
        ) : <EmptyState title="Squad not registered yet">Approved players appear here once the captain’s registrations are approved.</EmptyState>}
      </Section>
      <Section title="Other statistics">
        {teamStatsQ.isLoading ? <Skeleton lines={1} height={80} /> : teamStats ? (
          <dl className={styles.facts}>
            <div><dt>Clean sheets</dt><dd className={teamStats.cleanSheets.state === 'known' ? 'num' : styles.unknown}>{teamStats.cleanSheets.state === 'known' ? teamStats.cleanSheets.value : 'Not recorded'}</dd></div>
            <div><dt>Yellow cards</dt><dd className={teamStats.yellowCards.state === 'known' ? 'num' : styles.unknown}>{teamStats.yellowCards.state === 'known' ? teamStats.yellowCards.value : 'Not recorded'}</dd></div>
            <div><dt>Red cards</dt><dd className={teamStats.redCards.state === 'known' ? 'num' : styles.unknown}>{teamStats.redCards.state === 'known' ? teamStats.redCards.value : 'Not recorded'}</dd></div>
          </dl>
        ) : (
          <EmptyState title="Not recorded">Clean sheets and disciplinary records need match events, which have not been recorded for this team. They are not shown as zero because they are unknown.</EmptyState>
        )}
      </Section>
    </>
  );
}
