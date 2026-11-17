'use client';

import Link from 'next/link';
import { Crest } from '@/components/ui/Crest';
import { Section } from '@/components/ui/Section';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useTeam } from '@/features/teams/hooks';
import { usePlayer, usePlayerStatistics } from './hooks';
import styles from './Players.module.css';
import teamStyles from '@/features/teams/Teams.module.css';

type StatKey =
  | 'appearances'
  | 'starts'
  | 'substituteAppearances'
  | 'goals'
  | 'yellowCards'
  | 'redCards'
  | 'cleanSheets';

const STATS: { key: StatKey; label: string }[] = [
  { key: 'appearances', label: 'Appearances' },
  { key: 'starts', label: 'Starts' },
  { key: 'substituteAppearances', label: 'Substitute appearances' },
  { key: 'goals', label: 'Goals' },
  { key: 'yellowCards', label: 'Yellow cards' },
  { key: 'redCards', label: 'Red cards' },
  { key: 'cleanSheets', label: 'Clean sheets' },
];

export function PlayerProfile({ playerId }: { playerId: string }) {
  const q = usePlayer(playerId);
  const team = useTeam(q.data?.teamId ?? '');
  const { competition, season } = useActiveCompetition();
  const statsQ = usePlayerStatistics(competition?.id, season?.id);
  if (q.isLoading) return <Skeleton lines={3} height={80} />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <EmptyState title="Player not found" action={<Link href="/players">All players</Link>}>This player may not be approved yet, or the link is wrong.</EmptyState>;
  const p = q.data;
  const teamName = team.data?.team.name;
  const stats = statsQ.data?.find((s) => s.playerId === p.id);
  return (
    <>
      <Link href="/players" className={teamStyles.back}>All players</Link>
      <div className={teamStyles.head}>
        {teamName ? <Crest name={teamName} size={56} /> : null}
        <div>
          <h1>{p.fullName}</h1>
          <div className={teamStyles.meta}>
            {p.shirtNumber ? <span>No. {p.shirtNumber}</span> : null}
            <span>{p.position ?? 'Position not set'}</span>
            {teamName ? <Link href={`/teams/${p.teamId}`}>{teamName}</Link> : null}
            {p.department ? <span>{p.department}</span> : null}
            <span>Squad status: {p.squadStatus}</span>
          </div>
        </div>
      </div>
      <Section title="Statistics">
        {statsQ.isLoading ? <Skeleton lines={2} height={80} /> : (
          <dl className={styles.stats}>
            {STATS.map(({ key, label }) => {
              const measured = stats?.[key];
              const value = measured?.state === 'known' ? measured.value : null;
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd className={value === null ? styles.unknown : undefined}>{value ?? 'Not recorded'}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </Section>
    </>
  );
}
