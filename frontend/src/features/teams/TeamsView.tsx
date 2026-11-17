'use client';

import Link from 'next/link';
import { Crest } from '@/components/ui/Crest';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useLeagues } from '@/features/competitions/hooks';
import { useTeamEntries } from './hooks';
import styles from './Teams.module.css';

export function TeamsView() {
  const { competition, season } = useActiveCompetition();
  const entries = useTeamEntries(competition?.id, season?.id);
  const leagues = useLeagues(competition?.id, season?.id);
  const list = entries.data ?? [];

  return (
    <>
      <PageHeader title="Teams" lead={`${list.length} teams in ${competition?.name ?? 'the competition'}.`} />
      {entries.isLoading ? <Skeleton lines={4} height={80} /> : entries.isError ? <ErrorState onRetry={() => void entries.refetch()} /> : list.length === 0 ? (
        <EmptyState title="No teams registered">Teams appear here once their registration is approved.</EmptyState>
      ) : (
        (leagues.data ?? []).map((l) => (
          <section key={l.id} className={styles.group}>
            <h2>{l.name}</h2>
            <ul className={styles.grid}>
              {list.filter((e) => e.registration.leagueId === l.id).map(({ team }) => (
                <li key={team.id}>
                  <Link href={`/teams/${team.id}`} className={styles.card}>
                    <Crest name={team.name} size={36} />
                    <span>{team.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
