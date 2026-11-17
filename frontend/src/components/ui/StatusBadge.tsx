import { Ban, CalendarClock, Check, CircleAlert, Radio, Pause } from 'lucide-react';
import type { MatchStatus } from '@/types';
import { isLive, statusLabel } from '@/lib/match';
import styles from './StatusBadge.module.css';

function icon(s: MatchStatus) {
  if (s === 'half-time') return <Pause size={12} aria-hidden />;
  if (isLive(s)) return <Radio size={12} aria-hidden />;
  if (s === 'full-time') return <Check size={12} aria-hidden />;
  if (s === 'scheduled') return <CalendarClock size={12} aria-hidden />;
  if (s === 'postponed') return <CircleAlert size={12} aria-hidden />;
  return <Ban size={12} aria-hidden />;
}

/** Status is always spelled out in text; colour and icon are reinforcement only. */
export function StatusBadge({ status }: { status: MatchStatus }) {
  const tone = isLive(status) ? 'live' : status === 'full-time' ? 'done' : status === 'scheduled' ? 'plain' : 'warn';
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {icon(status)}
      {statusLabel(status)}
    </span>
  );
}
