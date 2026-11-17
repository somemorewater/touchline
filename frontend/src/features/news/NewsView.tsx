'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { formatDay } from '@/lib/format';
import { DISPLAY_TIME_ZONE } from '@/types';
import { useAnnouncement, useAnnouncements } from './hooks';
import styles from './News.module.css';

const excerpt = (body: string) => {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
};

export function NewsView() {
  const { competition } = useActiveCompetition();
  const q = useAnnouncements(competition?.id);
  return (
    <>
      <PageHeader title="News" lead="Official announcements and notices published by the competition administrators." />
      {q.isLoading ? <Skeleton lines={3} height={70} /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (q.data ?? []).length === 0 ? (
        <EmptyState title="Nothing published yet">When the administrators publish an announcement, it will appear here.</EmptyState>
      ) : (
        <ul className={styles.list}>
          {q.data!.map((a) => (
            <li key={a.id}>
              <Link href={`/news/${a.id}`}>
                <strong>{a.title}</strong>
                <span>{a.audience === 'public' ? 'Public notice' : `${a.audience} notice`}. {formatDay(a.publishedAt ?? a.createdAt, DISPLAY_TIME_ZONE)}</span>
                <p>{excerpt(a.body)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ArticleView({ id }: { id: string }) {
  const q = useAnnouncement(id);
  if (q.isLoading) return <Skeleton lines={3} />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <EmptyState title="Article not found" action={<Link href="/news">All news</Link>}>It may have been unpublished, archived or the link is wrong.</EmptyState>;
  return (
    <article className={styles.article}>
      <Link href="/news">All news</Link>
      <h1>{q.data.title}</h1>
      <p className={styles.byline}>
        Published {formatDay(q.data.publishedAt ?? q.data.createdAt, DISPLAY_TIME_ZONE)}
        {q.data.audience === 'public' ? '' : ` · ${q.data.audience} audience`}
      </p>
      <div className={styles.body}>{q.data.body}</div>
    </article>
  );
}
