import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export function PageHeader({ title, lead, aside }: { title: string; lead?: ReactNode; aside?: ReactNode }) {
  return (
    <header className={styles.head}>
      <div>
        <h1>{title}</h1>
        {lead ? <p>{lead}</p> : null}
      </div>
      {aside}
    </header>
  );
}
