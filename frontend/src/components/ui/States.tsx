import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import styles from './States.module.css';

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Could not load this', onRetry }: { title?: string; onRetry?: () => void }) {
  return (
    <div className={`${styles.empty} ${styles.error}`} role="alert">
      <TriangleAlert size={20} aria-hidden />
      <h3>{title}</h3>
      <p>Check your connection and try again.</p>
      {onRetry ? <button type="button" className={styles.btn} onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function Skeleton({ lines = 3, height = 44 }: { lines?: number; height?: number }) {
  return (
    <div className={styles.skel} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => <div key={i} style={{ height }} />)}
    </div>
  );
}
