import type { Match, Team } from '@/types';
import { MatchRow } from './MatchRow';
import styles from './Section.module.css';

export function MatchList({ matches, teams, tz }: { matches: Match[]; teams: Map<string, Team>; tz: string }) {
  return (
    <div className={styles.list}>
      {matches.map((m) => <MatchRow key={m.id} match={m} teams={teams} tz={tz} />)}
    </div>
  );
}
