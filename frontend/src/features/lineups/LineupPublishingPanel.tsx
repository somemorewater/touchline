'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/lib/api/client';
import { lineupsApi } from '@/lib/api/endpoints';
import type { LineupDto } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { DISPLAY_TIME_ZONE } from '@/types';
import styles from './LineupPublishingPanel.module.css';

interface Props {
  matchId: string;
  scheduledAt: string | null;
  fixtureStatus: string;
  matchStatus: string;
  homeTeamRegistrationId: string | null;
  awayTeamRegistrationId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  lineups: LineupDto[];
  canPublish: boolean;
}

const AVAILABILITY_LEAD_MS = 60 * 60 * 1000;

export function LineupPublishingPanel(props: Props) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const scheduledMs = props.scheduledAt ? Date.parse(props.scheduledAt) : null;
  const availableAt = scheduledMs !== null ? new Date(scheduledMs - AVAILABILITY_LEAD_MS).toISOString() : null;
  const activeMatch = props.fixtureStatus === 'scheduled' && props.matchStatus === 'scheduled';

  const publish = async (lineupId: string) => {
    setBusyId(lineupId);
    setError(null);
    setNotice(null);
    try {
      await lineupsApi.publish(lineupId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-match', props.matchId] }),
        queryClient.invalidateQueries({ queryKey: ['official-match', props.matchId] }),
        queryClient.invalidateQueries({ queryKey: ['match', props.matchId] }),
        queryClient.invalidateQueries({ queryKey: ['lineups', props.matchId] }),
      ]);
      setNotice('Lineup published. It will become public at the scheduled availability time.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  const sides = [
    { id: props.homeTeamRegistrationId, name: props.homeTeamName, side: 'Home' },
    { id: props.awayTeamRegistrationId, name: props.awayTeamName, side: 'Away' },
  ];

  return (
    <section className={`tl-card ${styles.panel}`} aria-labelledby={`lineup-publish-${props.matchId}`}>
      <h3 id={`lineup-publish-${props.matchId}`}>Lineup publishing</h3>
      <p className="tl-muted">
        Public availability: {availableAt ? formatDateTime(availableAt, DISPLAY_TIME_ZONE) : 'Set the match kick-off first'}
        {props.scheduledAt ? ' (kick-off minus one hour)' : ''}
      </p>
      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}
      {notice ? <p className="tl-alert tl-alert-success" role="status">{notice}</p> : null}
      <div className={styles.sides}>
        {sides.map(({ id, name, side }) => {
          const lineup = id ? props.lineups.find((entry) => entry.teamRegistrationId === id) ?? null : null;
          const submitted = Boolean(lineup?.submittedAt);
          const approved = lineup?.status === 'confirmed' || lineup?.status === 'published';
          const isPublished = lineup?.status === 'published' && Boolean(lineup.publishedAt);
          const needsPublicationRecord = lineup?.status === 'published' && !lineup.publishedAt;
          const publishReady = (lineup?.status === 'confirmed' || needsPublicationRecord) && props.canPublish && activeMatch && Boolean(availableAt);
          const publicNow = activeMatch && availableAt !== null && Date.parse(availableAt) <= Date.now();

          return (
            <article key={id ?? side} className={styles.side}>
              <h4>{side}: {name}</h4>
              <dl>
                <div><dt>Submission</dt><dd>{submitted ? 'Submitted' : lineup ? 'Draft or returned' : 'Not submitted'}</dd></div>
                <div><dt>Approval</dt><dd>{approved ? 'Completed' : submitted ? 'Required' : 'Not ready'}</dd></div>
                <div><dt>Publication</dt><dd>{isPublished ? !activeMatch ? 'Published but hidden while the match is not scheduled' : publicNow ? 'Available publicly' : 'Published; waiting for availability time' : needsPublicationRecord ? 'Publication time not recorded' : 'Not published'}</dd></div>
                <div><dt>Publication eligibility</dt><dd>{publishReady ? 'Eligible; roster will be revalidated' : lineup?.status === 'confirmed' || needsPublicationRecord ? 'Unavailable for this match state' : 'Requires a confirmed lineup'}</dd></div>
              </dl>
              {isPublished && lineup.publishedAt ? <p className="tl-muted">Published {formatDateTime(lineup.publishedAt, DISPLAY_TIME_ZONE)}</p> : null}
              {publishReady ? (
                <button type="button" className="tl-btn tl-btn-sm tl-btn-primary" onClick={() => void publish(lineup!.id)} disabled={busyId !== null}>
                  {busyId === lineup.id ? 'Publishing…' : `${needsPublicationRecord ? 'Record' : 'Publish'} ${side.toLowerCase()} lineup`}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      {!props.canPublish ? <p className="tl-muted">Publishing requires competition-scoped match/fixture management or an assigned match official.</p> : null}
    </section>
  );
}
