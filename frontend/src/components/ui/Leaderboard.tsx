import Link from 'next/link';
import styles from './Leaderboard.module.css';

export interface LeaderboardRow {
  id: string;
  name: string;
  detail?: string;
  value: number;
  href: string;
}

export function Leaderboard({ rows, unit }: { rows: LeaderboardRow[]; unit: string }) {
  return (
    <ol className={styles.list}>
      {rows.map((row, i) => (
        <li key={row.id}>
          <span className={styles.rank} aria-hidden>{i + 1}</span>
          <span className={styles.who}>
            <Link href={row.href}>{row.name}</Link>
            {row.detail ? <small>{row.detail}</small> : null}
          </span>
          <span className={`${styles.value} num`}>{row.value}<small>{unit}</small></span>
        </li>
      ))}
    </ol>
  );
}
