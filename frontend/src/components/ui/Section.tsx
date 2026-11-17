import type { ReactNode } from 'react';
import styles from './Section.module.css';

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.head}><h2>{title}</h2>{aside}</div>
      {children}
    </section>
  );
}
