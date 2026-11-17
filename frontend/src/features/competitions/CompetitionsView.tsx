'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useCompetitions } from './hooks';
import styles from './Competitions.module.css';

export const FORMAT_LABEL = {
  'single-league': 'Single league', 'multiple-leagues': 'Multiple leagues', 'group-stage': 'Group stage',
  knockout: 'Knockout', 'league-then-knockout': 'League then knockout',
} as const;
export const STATUS_LABEL = {
  draft: 'Draft', published: 'Published', registration: 'Registration open', active: 'In progress',
  completed: 'Completed', archived: 'Archived',
} as const;

export function CompetitionsView() {
  const q = useCompetitions();
  return (
    <>
      <PageHeader title="Competitions" lead="Every competition run on TOUCHLINE." />
      {q.isLoading ? <Skeleton lines={2} height={110} /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (q.data ?? []).length === 0 ? (
        <EmptyState title="No competitions yet">Competitions appear once an administrator creates and publishes one.</EmptyState>
      ) : (
        <ul className={styles.list}>
          {q.data!.map((c) => (
            <li key={c.id}>
              <Link href={`/competitions/${c.slug}`} className={styles.card}>
                <span>
                  <strong>{c.name}</strong>
                  <span className={styles.sub}>{FORMAT_LABEL[c.format]}. {STATUS_LABEL[c.status]}. {c.visibility === 'private' ? 'Private competition.' : 'Public competition.'}</span>
                  {c.description ? <span className={styles.desc}>{c.description}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
