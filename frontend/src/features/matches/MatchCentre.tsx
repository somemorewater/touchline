'use client';

import Link from 'next/link';
import { Crest } from '@/components/ui/Crest';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { useCompetition } from '@/features/competitions/hooks';
import { usePlayers } from '@/features/players/hooks';
import { useTeamMap } from '@/features/teams/hooks';
import { formatDateTime } from '@/lib/format';
import { isLive, statusLabel } from '@/lib/match';
import { DISPLAY_TIME_ZONE } from '@/types';
import type { MatchEvent, MatchStatus, MatchTeamStats } from '@/types';
import { useMatchDetail } from './hooks';
import { MatchLineups } from './MatchLineups';
import { useMatchLive, type LiveConnectionState } from './useMatchLive';
import styles from './MatchCentre.module.css';

const liveStatusLabel: Record<LiveConnectionState, string> = {
  idle: 'Polling every 15 seconds',
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Unavailable — polling every 15 seconds',
};

const EVENT_LABEL: Record<MatchEvent['type'], string> = {
  goal: 'Goal', 'own-goal': 'Own goal', 'yellow-card': 'Yellow card', 'second-yellow': 'Second yellow', 'red-card': 'Red card',
  substitution: 'Substitution', injury: 'Injury', 'penalty-awarded': 'Penalty awarded', 'penalty-scored': 'Penalty scored',
  'penalty-missed': 'Penalty missed', kickoff: 'Kick-off', 'half-time': 'Half-time', 'full-time': 'Full-time',
};

const STAT_ROWS: { key: keyof MatchTeamStats; label: string; unit?: string }[] = [
  { key: 'possession', label: 'Possession', unit: '%' }, { key: 'shots', label: 'Shots' }, { key: 'shotsOnTarget', label: 'Shots on target' },
  { key: 'corners', label: 'Corners' }, { key: 'fouls', label: 'Fouls' }, { key: 'offsides', label: 'Offsides' },
  { key: 'saves', label: 'Saves' }, { key: 'passAccuracy', label: 'Pass accuracy', unit: '%' },
];

export function MatchCentre({ matchId }: { matchId: string }) {
  const q = useMatchDetail(matchId);
  const live = useMatchLive(matchId);
  const compQ = useCompetition(q.data?.match.competitionId ?? '');
  const { teams } = useTeamMap(q.data?.match.competitionId, q.data?.match.seasonId);
  const playersQ = usePlayers({ competitionId: q.data?.match.competitionId });
  const players = new Map((playersQ.data ?? []).map((p) => [p.id, p]));

  if (q.isLoading) return <Skeleton lines={3} height={90} />;
  if (q.isError) return <ErrorState title="Could not load this match" onRetry={() => void q.refetch()} />;
  if (!q.data) return <EmptyState title="Match not found" action={<Link href="/matches">Back to all matches</Link>}>This match may have been removed or the link is wrong.</EmptyState>;

  const { match, events, lineups, statistics, report } = q.data;
  const comp = compQ.data;
  const tz = DISPLAY_TIME_ZONE;
  const home = teams.get(match.homeTeamId)?.name ?? 'Home team';
  const away = teams.get(match.awayTeamId)?.name ?? 'Away team';
  const player = (id?: string) => (id ? players.get(id)?.fullName ?? id : undefined);
  const timeline = [...events].sort((a, b) => a.minute - b.minute);
  const teamName = (id: string) => (id === match.homeTeamId ? home : away);

  // A live frame paints the score and status immediately; the HTTP query is
  // invalidated at the same time, so the two never diverge for long.
  const liveFrame = live.update?.match ?? null;
  const liveStatus = liveFrame ? (liveFrame.status.replaceAll('_', '-') as MatchStatus) : null;
  const effectiveStatus = liveStatus ?? match.status;
  const effectiveScore = liveFrame ? { home: liveFrame.homeScore, away: liveFrame.awayScore } : match.score;
  const showScore = effectiveScore !== null && effectiveStatus !== 'scheduled';
  const minute = liveFrame?.currentMinute ?? null;
  const added = liveFrame?.addedMinutes ?? null;
  const noLineupStatus = effectiveStatus === 'postponed' || effectiveStatus === 'cancelled' || effectiveStatus === 'abandoned';
  const lineupEmptyTitle = noLineupStatus ? `Match ${statusLabel(effectiveStatus).toLowerCase()}` : 'Lineups not published';
  const lineupEmptyBody = noLineupStatus
    ? `This match is marked ${statusLabel(effectiveStatus).toLowerCase()} and no lineup has been recorded for it.`
    : match.kickoffAt && Date.now() < Date.parse(match.kickoffAt) - 60 * 60 * 1000
      ? `Lineups will be available 1 hour before kickoff (${formatDateTime(new Date(Date.parse(match.kickoffAt) - 60 * 60 * 1000).toISOString(), tz)}).`
      : 'No eligible lineup has been published yet.';

  const eventList = (reverse: boolean) => (
    <ol className={styles.events}>
      {(reverse ? [...timeline].reverse() : timeline).map((e) => (
        <li key={e.id}>
          <span className={`${styles.min} num`}>{e.minute}{e.addedMinutes ? `+${e.addedMinutes}` : ''}&apos;</span>
          <span><strong>{EVENT_LABEL[e.type]}</strong> for {teamName(e.teamId)}{player(e.playerId) ? `, ${player(e.playerId)}` : ''}{e.description ? `. ${e.description}` : ''}
            {e.syncState !== 'confirmed' ? <em> (not yet confirmed by the server)</em> : null}
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <p className={styles.crumbs}><Link href="/matches">Matches</Link></p>
      <section className={styles.head} aria-labelledby="match-title">
        <h1 id="match-title" className="sr-only">{home} v {away}</h1>
        <div className={styles.team}><Crest name={home} size={56} /><span>{home}</span></div>
        <div className={styles.mid}>
          <div className={`${styles.score} num`}>{showScore ? `${effectiveScore!.home} – ${effectiveScore!.away}` : 'v'}</div>
          <StatusBadge status={effectiveStatus} />
          {isLive(effectiveStatus) && minute !== null ? (
            <span className={styles.clock}>{minute}{added ? `+${added}` : ''}&apos;</span>
          ) : null}
        </div>
        <div className={styles.team}><Crest name={away} size={56} /><span>{away}</span></div>
        <dl className={styles.meta}>
          <div><dt>Competition</dt><dd>{comp?.name ?? '…'}</dd></div>
          <div><dt>Kick-off</dt><dd>{formatDateTime(match.kickoffAt, tz)}</dd></div>
          <div><dt>Venue</dt><dd>{match.venue ?? 'To be confirmed'}</dd></div>
          {match.round ? <div><dt>Round</dt><dd>{match.round}</dd></div> : null}
          {effectiveStatus === 'full-time' && !match.resultConfirmed ? <div><dt>Result</dt><dd>Awaiting confirmation</dd></div> : null}
          {isLive(effectiveStatus) ? (
            <div>
              <dt>Live updates</dt>
              <dd title={live.error ?? undefined}>{liveStatusLabel[live.state]}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <Tabs
        label="Match sections"
        tabs={[
          { id: 'overview', label: 'Overview', content: timeline.length ? eventList(false) : <EmptyState title="No events recorded">Goals, cards and substitutions appear here once the match official records them.</EmptyState> },
          { id: 'commentary', label: 'Commentary', content: timeline.length ? eventList(true) : <EmptyState title="No commentary yet">Updates are listed newest first as events are recorded.</EmptyState> },
          {
            id: 'lineups', label: 'Lineups',
            content: lineups.length === 0 ? (
              <EmptyState title={lineupEmptyTitle}>{lineupEmptyBody}</EmptyState>
            ) : (
              <MatchLineups
                lineups={lineups}
                events={events}
                teams={teams}
                players={players}
                homeTeamId={match.homeTeamId}
                awayTeamId={match.awayTeamId}
                competitionId={match.competitionId}
                seasonId={match.seasonId}
                matchStatus={effectiveStatus}
              />
            ),
          },
          {
            id: 'stats', label: 'Statistics',
            content: !statistics ? (
              <EmptyState title="No statistics recorded">Only statistics that the match official actually records are shown. Nothing is estimated.</EmptyState>
            ) : (
              <table className={styles.stats}>
                <caption className="sr-only">Match statistics</caption>
                <thead><tr><th scope="col">{home}</th><th scope="col"><span className="sr-only">Statistic</span></th><th scope="col">{away}</th></tr></thead>
                <tbody>
                  {STAT_ROWS.filter((r) => statistics.home[r.key] !== undefined || statistics.away[r.key] !== undefined).map((r) => (
                    <tr key={r.key}>
                      <td className="num">{statistics.home[r.key] ?? 'Not recorded'}{statistics.home[r.key] !== undefined ? r.unit : ''}</td>
                      <th scope="row">{r.label}</th>
                      <td className="num">{statistics.away[r.key] ?? 'Not recorded'}{statistics.away[r.key] !== undefined ? r.unit : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          },
          {
            id: 'report', label: 'Match report',
            content: report ? <p className={styles.report}>{report.summary}</p> : <EmptyState title="No match report yet">The official report is published after full-time and administrator approval.</EmptyState>,
          },
        ]}
      />
    </>
  );
}
