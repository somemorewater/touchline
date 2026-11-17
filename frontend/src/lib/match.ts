import type { Match, MatchStatus } from '@/types';
import { LIVE_STATUSES } from '@/types';

export const isLive = (s: MatchStatus) => LIVE_STATUSES.includes(s);
export const isFinished = (m: Pick<Match, 'status'>) => m.status === 'full-time';
export const isUpcoming = (m: Pick<Match, 'status'>) => m.status === 'scheduled';

const LABELS: Record<MatchStatus, string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  'first-half': 'First half',
  'half-time': 'Half-time',
  'second-half': 'Second half',
  'full-time': 'Full-time',
  'extra-time': 'Extra time',
  penalties: 'Penalties',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
  abandoned: 'Abandoned',
};
export const statusLabel = (s: MatchStatus) => LABELS[s];

export type MatchFilter = 'all' | 'live' | 'upcoming' | 'finished' | 'postponed' | 'cancelled';

export function matchesFilter(m: Match, f: MatchFilter): boolean {
  switch (f) {
    case 'all': return true;
    case 'live': return isLive(m.status);
    case 'upcoming': return m.status === 'scheduled';
    case 'finished': return m.status === 'full-time';
    case 'postponed': return m.status === 'postponed';
    case 'cancelled': return m.status === 'cancelled' || m.status === 'abandoned';
  }
}

export function byKickoff(a: Match, b: Match): number {
  const ta = a.kickoffAt ? Date.parse(a.kickoffAt) : Number.POSITIVE_INFINITY;
  const tb = b.kickoffAt ? Date.parse(b.kickoffAt) : Number.POSITIVE_INFINITY;
  return ta - tb;
}
