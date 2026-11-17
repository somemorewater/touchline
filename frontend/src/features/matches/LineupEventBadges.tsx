import { ArrowDown, ArrowRightLeft, ArrowUp, Bandage, Footprints, Goal } from 'lucide-react';
import type { LineupEvent, LineupEventKind } from './lib/lineupEvents';
import styles from './Lineups.module.css';

const KIND_CLASS: Record<LineupEventKind, string | undefined> = {
  goal: styles.eventGoal,
  'own-goal': styles.eventOwnGoal,
  assist: styles.eventAssist,
  yellow: styles.eventYellow,
  red: styles.eventRed,
  'sub-on': styles.eventSubOn,
  'sub-off': styles.eventSubOff,
  injury: styles.eventInjury,
};

function EventIcon({ kind }: { kind: LineupEventKind }) {
  switch (kind) {
    case 'goal':
    case 'own-goal':
      return <Goal size={11} aria-hidden />;
    case 'assist':
      return <Footprints size={11} aria-hidden />;
    case 'yellow':
      return <span className={`${styles.cardIcon} ${styles.yellowCard}`} aria-hidden />;
    case 'red':
      return <span className={`${styles.cardIcon} ${styles.redCard}`} aria-hidden />;
    case 'sub-on':
      return <ArrowUp size={11} aria-hidden />;
    case 'sub-off':
      return <ArrowDown size={11} aria-hidden />;
    case 'injury':
      return <Bandage size={11} aria-hidden />;
  }
}

export function EventBadges({ events, compact = false }: { events: LineupEvent[]; compact?: boolean }) {
  if (events.length === 0) return null;
  return (
    <span className={styles.badges}>
      {events.map((event, index) => (
        <span
          key={`${event.kind}-${event.minute}-${index}`}
          className={`${styles.badge} ${KIND_CLASS[event.kind]}`}
          title={`${event.label} ${event.minute}'`}
          aria-label={`${event.label} ${event.minute}'`}
        >
          <EventIcon kind={event.kind} />
          {compact ? null : <span className={styles.badgeMinute}>{event.minute}&apos;</span>}
        </span>
      ))}
    </span>
  );
}

export function EventLegend() {
  return (
    <div className={styles.legend} aria-label="Match event legend">
      <span><Goal size={12} aria-hidden /> Goal</span>
      <span><Footprints size={12} aria-hidden /> Assist</span>
      <span><span className={`${styles.cardIcon} ${styles.yellowCard}`} aria-hidden /> Yellow card</span>
      <span><span className={`${styles.cardIcon} ${styles.redCard}`} aria-hidden /> Red card</span>
      <span><ArrowRightLeft size={12} aria-hidden /> Substitution</span>
      <span><Bandage size={12} aria-hidden /> Injury</span>
      <span><span className={styles.legendCaptain} aria-hidden>C</span> Captain</span>
    </div>
  );
}
