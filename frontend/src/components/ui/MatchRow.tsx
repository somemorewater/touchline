import Link from 'next/link';
import type { Match, Team } from '@/types';
import { formatDay, formatTime } from '@/lib/format';
import { Crest } from './Crest';
import { StatusBadge } from './StatusBadge';
import styles from './MatchRow.module.css';

export function MatchRow({ match, teams, tz, showDay = true }: { match: Match; teams: Map<string, Team>; tz: string; showDay?: boolean }) {
  const home = teams.get(match.homeTeamId)?.name ?? 'Unknown team';
  const away = teams.get(match.awayTeamId)?.name ?? 'Unknown team';
  const hasScore = match.score !== null && match.status !== 'scheduled';
  return (
    <Link href={`/matches/${match.id}`} className={styles.row}>
      <span className={styles.when}>
        {showDay ? <span>{formatDay(match.kickoffAt, tz)}</span> : null}
        <StatusBadge status={match.status} />
      </span>
      <span className={`${styles.side} ${styles.home}`}>
        <span>{home}</span>
        <Crest name={home} size={26} />
      </span>
      <span className={`${styles.score} num`} aria-label={hasScore ? `${match.score!.home} to ${match.score!.away}` : `Kick-off ${formatTime(match.kickoffAt, tz)}`}>
        {hasScore ? `${match.score!.home} – ${match.score!.away}` : formatTime(match.kickoffAt, tz)}
      </span>
      <span className={`${styles.side} ${styles.away}`}>
        <Crest name={away} size={26} />
        <span>{away}</span>
      </span>
    </Link>
  );
}
