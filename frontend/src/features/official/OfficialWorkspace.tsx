'use client';

import { useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ClipboardCheck, History, Plus, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage } from '@/lib/api/client';
import {
  matchesApi,
  registrationsApi,
  type MatchLifecycleAction,
} from '@/lib/api/endpoints';
import type { MatchDetailDto, MatchEventDto, PlayerRegistrationDto } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { statusLabel } from '@/lib/match';
import { DISPLAY_TIME_ZONE, type MatchStatus } from '@/types';
import styles from '@/components/layout/Workspace.module.css';

const EVENT_TYPES = [
  ['goal', 'Goal'],
  ['own-goal', 'Own goal'],
  ['penalty-scored', 'Penalty scored'],
  ['penalty-missed', 'Penalty missed'],
  ['penalty-awarded', 'Penalty awarded'],
  ['yellow-card', 'Yellow card'],
  ['second-yellow', 'Second yellow'],
  ['red-card', 'Red card'],
  ['substitution', 'Substitution'],
  ['injury', 'Injury'],
  ['kickoff', 'Kick-off'],
  ['half-time', 'Half-time'],
  ['full-time', 'Full-time'],
] as const;

const EVENT_LABEL = Object.fromEntries(EVENT_TYPES) as Record<string, string>;

const viewStatus = (status: string): MatchStatus => status.replaceAll('_', '-') as MatchStatus;

interface OfficialMatch {
  matchId: string;
  fixtureId: string;
  seasonId: string;
  competitionId: string;
  status: string;
  scheduledAt: string | null;
  homeTeamName: string;
  awayTeamName: string;
}

export function lifecycleActions(status: string): MatchLifecycleAction[] {
  switch (status) {
    case 'scheduled':
      return ['start', 'postpone', 'cancel'];
    case 'first_half':
    case 'live':
      return ['half-time', 'abandon'];
    case 'half_time':
      return ['second-half', 'abandon'];
    case 'second_half':
      return ['end', 'abandon'];
    case 'extra_time':
    case 'penalties':
      return ['abandon'];
    default:
      return [];
  }
}

export const ACTION_LABEL: Record<MatchLifecycleAction, string> = {
  start: 'Start match',
  'half-time': 'Half time',
  'second-half': 'Second half',
  end: 'End at full time',
  postpone: 'Postpone',
  cancel: 'Cancel',
  abandon: 'Abandon',
};

export function OfficialWorkspace() {
  const { status, isOfficial } = useAuth();
  const q = useQuery({
    queryKey: ['official-matches'],
    queryFn: () => matchesApi.myOfficialMatches(),
    enabled: isOfficial,
  });

  if (status === 'loading') return <Skeleton lines={3} height={110} />;
  if (!isOfficial) {
    return (
      <EmptyState title="Official workspace is not available to your account">
        A competition administrator assigns match officials. Only an assigned official can see this workspace.
      </EmptyState>
    );
  }

  return (
    <>
      <PageHeader
        title="Official workspace"
        lead="Matches assigned to you. Record the clock, goals, cards and substitutions, then submit the full-time report."
      />
      {q.isLoading ? <Skeleton lines={3} height={110} /> : q.isError ? (
        <ErrorState title="Could not load your matches" onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState title="No assigned matches">
          A competition administrator assigns officials to matches. Your assignments will appear here.
        </EmptyState>
      ) : (
        <div className="tl-stack">
          {q.data!.map((match) => <OfficialMatchCard key={match.matchId} match={match} />)}
        </div>
      )}
    </>
  );
}

function OfficialMatchCard({ match }: { match: OfficialMatch }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: ['official-match', match.matchId],
    queryFn: () => matchesApi.get(match.matchId),
    enabled: open,
  });
  const resultQ = useQuery({
    queryKey: ['official-result', match.matchId],
    queryFn: () => matchesApi.result(match.matchId),
    enabled: open,
  });

  const detail = detailQ.data;
  const registrations = [
    detail?.match.homeRegistration?.id,
    detail?.match.awayRegistration?.id,
  ].filter((id): id is string => Boolean(id));

  const registrationQueries = useQueries({
    queries: registrations.map((registrationId) => ({
      queryKey: ['official-squad', registrationId],
      queryFn: () => registrationsApi.list({ teamRegistrationId: registrationId, status: 'approved' }),
      enabled: open && Boolean(registrationId),
    })),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['official-match', match.matchId] });
    void queryClient.invalidateQueries({ queryKey: ['official-result', match.matchId] });
    void queryClient.invalidateQueries({ queryKey: ['official-matches'] });
    void queryClient.invalidateQueries({ queryKey: ['match', match.matchId] });
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (action: MatchLifecycleAction) => run(async () => {
    await matchesApi.lifecycle(match.matchId, action);
    refresh();
    setNotice(`Match updated: ${ACTION_LABEL[action].toLowerCase()}.`);
  });

  const actions = lifecycleActions(match.status);

  return (
    <section className="tl-card">
      <header className={styles.cardHead}>
        <div>
          <h2>{match.homeTeamName} v {match.awayTeamName}</h2>
          <p className="tl-muted">
            {formatDateTime(match.scheduledAt ?? undefined, DISPLAY_TIME_ZONE)} · {statusLabel(viewStatus(match.status))}
          </p>
        </div>
        <button type="button" className="tl-btn tl-btn-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Close match' : 'Open match'}
        </button>
      </header>

      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}
      {notice ? <p className="tl-alert tl-alert-success" role="status">{notice}</p> : null}

      {open ? (
        detailQ.isLoading ? <Skeleton lines={2} height={60} /> : detailQ.isError || !detail ? (
          <p className="tl-alert tl-alert-error" role="alert">Could not load this match.</p>
        ) : (
          <div className="tl-stack">
            <MatchActions
              detail={detail}
              actions={actions}
              busy={busy}
              onAction={changeStatus}
              onRun={run}
              onRefresh={refresh}
              result={resultQ.data}
            />

            <EventEntry
              detail={detail}
              squads={registrationQueries.map((query) => query.data ?? [])}
              busy={busy}
              onRun={run}
              onDone={(message) => {
                refresh();
                setNotice(message);
              }}
            />

            <EventList detail={detail} busy={busy} onRun={run} onDone={(message) => {
              refresh();
              setNotice(message);
            }} />

            <ResultPanel
              detail={detail}
              result={resultQ.data}
              busy={busy}
              onRun={run}
              onDone={(message) => {
                refresh();
                setNotice(message);
              }}
            />
          </div>
        )
      ) : null}
    </section>
  );
}

export function MatchActions({
  detail,
  actions,
  busy,
  onAction,
  onRun,
  onRefresh,
  result,
}: {
  detail: MatchDetailDto;
  actions: MatchLifecycleAction[];
  busy: boolean;
  onAction: (action: MatchLifecycleAction) => void;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onRefresh: () => void;
  result: { score: { homeScore: number; awayScore: number } } | undefined;
}) {
  const [minute, setMinute] = useState(String(detail.match.currentMinute ?? ''));
  const [added, setAdded] = useState(String(detail.match.addedMinutes ?? ''));
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="tl-card">
      <h3 className={styles.sectionTitle}><Activity size={16} aria-hidden /> Match clock and lifecycle</h3>
      <p className="tl-muted">
        Status {statusLabel(viewStatus(detail.match.status))}
        {detail.match.currentMinute !== null ? ` · Minute ${detail.match.currentMinute}${detail.match.addedMinutes ? `+${detail.match.addedMinutes}` : ''}` : ''}
        {result ? ` · Recorded score ${result.score.homeScore}–${result.score.awayScore}` : ''}
      </p>

      {actions.length > 0 ? (
        <div className={styles.inlineForm}>
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={`tl-btn ${action === 'start' || action === 'end' ? 'tl-btn-primary' : ''} ${action === 'abandon' || action === 'cancel' ? 'tl-btn-danger' : ''}`}
              onClick={() => onAction(action)}
              disabled={busy}
            >
              {ACTION_LABEL[action]}
            </button>
          ))}
        </div>
      ) : null}

      {['first_half', 'live', 'half_time', 'second_half', 'extra_time', 'penalties'].includes(detail.match.status) ? (
        <form
          className={styles.inlineForm}
          onSubmit={(event) => {
            event.preventDefault();
            void onRun(async () => {
              await matchesApi.clock(detail.match.id, Number(minute), added === '' ? null : Number(added));
              onRefresh();
            });
          }}
        >
          <label className="tl-field">
            <span className="tl-label">Minute</span>
            <input className="tl-input" type="number" min={0} max={150} value={minute} onChange={(event) => setMinute(event.target.value)} required />
          </label>
          <label className="tl-field">
            <span className="tl-label">Added minutes</span>
            <input className="tl-input" type="number" min={0} max={30} value={added} onChange={(event) => setAdded(event.target.value)} />
          </label>
          <button type="submit" className="tl-btn" disabled={busy}>Update clock</button>
        </form>
      ) : null}

      {detail.match.status === 'scheduled' || detail.match.status === 'postponed' ? (
        <form
          className={styles.inlineForm}
          onSubmit={(event) => {
            event.preventDefault();
            void onRun(async () => {
              await matchesApi.reschedule(detail.match.id, new Date(rescheduleAt).toISOString(), reason.trim() || null);
              onRefresh();
            });
          }}
        >
          <label className="tl-field">
            <span className="tl-label">New kick-off</span>
            <input className="tl-input" type="datetime-local" value={rescheduleAt} onChange={(event) => setRescheduleAt(event.target.value)} required />
          </label>
          <label className="tl-field">
            <span className="tl-label">Reason</span>
            <input className="tl-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
          </label>
          <button type="submit" className="tl-btn" disabled={busy || !rescheduleAt}>Reschedule</button>
        </form>
      ) : null}
    </div>
  );
}

export function EventEntry({
  detail,
  squads,
  busy,
  onRun,
  onDone,
}: {
  detail: MatchDetailDto;
  squads: PlayerRegistrationDto[][];
  busy: boolean;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onDone: (message: string) => void;
}) {
  const [eventType, setEventType] = useState<string>('goal');
  const [side, setSide] = useState<'home' | 'away' | ''>('home');
  const [playerId, setPlayerId] = useState('');
  const [secondaryId, setSecondaryId] = useState('');
  const [minute, setMinute] = useState('');
  const [added, setAdded] = useState('');
  const [description, setDescription] = useState('');

  const registrationId = side === 'home'
    ? detail.match.homeRegistration?.id
    : side === 'away'
      ? detail.match.awayRegistration?.id
      : undefined;
  const squadIndex = registrationId
    ? [detail.match.homeRegistration?.id, detail.match.awayRegistration?.id].indexOf(registrationId)
    : -1;
  const squad = squadIndex >= 0 ? squads[squadIndex] ?? [] : [];
  const isSubstitution = eventType === 'substitution';

  return (
    <form
      className="tl-card"
      onSubmit={(event) => {
        event.preventDefault();
        const chosenPlayer = playerId || null;
        const secondary = secondaryId || null;
        void onRun(async () => {
          await matchesApi.createEvent(detail.match.id, {
            clientEventId: crypto.randomUUID(),
            eventType,
            teamRegistrationId: registrationId ?? null,
            playerRegistrationId: chosenPlayer,
            secondaryPlayerRegistrationId: isSubstitution ? secondary : null,
            minute: Number(minute),
            addedMinutes: added === '' ? null : Number(added),
            description: description.trim() || null,
          });
          setMinute('');
          setAdded('');
          setDescription('');
          setPlayerId('');
          setSecondaryId('');
          onDone('Event recorded.');
        });
      }}
    >
      <h3 className={styles.sectionTitle}><Plus size={16} aria-hidden /> Record an event</h3>
      <p className="tl-muted">
        The score is derived from goal, own-goal and penalty-scored events. Record those before submitting the result.
      </p>
      <div className={styles.formGrid}>
        <label className="tl-field">
          <span className="tl-label">Event</span>
          <select className="tl-select" value={eventType} onChange={(event) => setEventType(event.target.value)}>
            {EVENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="tl-field">
          <span className="tl-label">Team</span>
          <select className="tl-select" value={side} onChange={(event) => { setSide(event.target.value as 'home' | 'away' | ''); setPlayerId(''); setSecondaryId(''); }}>
            <option value="">Not team-specific</option>
            <option value="home">{detail.match.fixture.homeTeam.name}</option>
            <option value="away">{detail.match.fixture.awayTeam.name}</option>
          </select>
        </label>
        <label className="tl-field">
          <span className="tl-label">{isSubstitution ? 'Player off' : 'Player'}</span>
          <select className="tl-select" value={playerId} onChange={(event) => setPlayerId(event.target.value)} disabled={!registrationId}>
            <option value="">Not specified</option>
            {squad.map((entry) => <option key={entry.id} value={entry.id}>{entry.player.fullName}</option>)}
          </select>
        </label>
        {isSubstitution ? (
          <label className="tl-field">
            <span className="tl-label">Player on</span>
            <select className="tl-select" value={secondaryId} onChange={(event) => setSecondaryId(event.target.value)} disabled={!registrationId}>
              <option value="">Not specified</option>
              {squad.map((entry) => <option key={entry.id} value={entry.id}>{entry.player.fullName}</option>)}
            </select>
          </label>
        ) : null}
        <label className="tl-field">
          <span className="tl-label">Minute</span>
          <input className="tl-input" type="number" min={0} max={150} value={minute} onChange={(event) => setMinute(event.target.value)} required />
        </label>
        <label className="tl-field">
          <span className="tl-label">Added minutes</span>
          <input className="tl-input" type="number" min={0} max={30} value={added} onChange={(event) => setAdded(event.target.value)} />
        </label>
        <label className="tl-field">
          <span className="tl-label">Description</span>
          <input className="tl-input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
        </label>
      </div>
      <button type="submit" className="tl-btn tl-btn-primary" disabled={busy || minute === ''}>Record event</button>
    </form>
  );
}

export function EventList({
  detail,
  busy,
  onRun,
  onDone,
}: {
  detail: MatchDetailDto;
  busy: boolean;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onDone: (message: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [minute, setMinute] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');

  const events = useMemo(
    () => [...detail.events].sort((a, b) => a.minute - b.minute || (a.addedMinutes ?? 0) - (b.addedMinutes ?? 0)),
    [detail.events],
  );

  const teamName = (registrationId: string | null) => {
    if (!registrationId) return 'Match';
    if (registrationId === detail.match.homeRegistration?.id) return detail.match.fixture.homeTeam.name;
    if (registrationId === detail.match.awayRegistration?.id) return detail.match.fixture.awayTeam.name;
    return 'Team';
  };

  return (
    <div className="tl-card">
      <h3 className={styles.sectionTitle}><ClipboardCheck size={16} aria-hidden /> Recorded events</h3>
      {events.length === 0 ? (
        <p className="tl-muted">No events recorded yet.</p>
      ) : (
        <div className="tl-scroll">
          <table className="tl-table">
            <caption className="sr-only">Recorded match events</caption>
            <thead>
              <tr><th scope="col">Min</th><th scope="col">Event</th><th scope="col">Team</th><th scope="col">Player</th><th scope="col">State</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  teamName={teamName(event.teamRegistrationId)}
                  busy={busy}
                  editing={editing === event.id}
                  voiding={voiding === event.id}
                  onEdit={() => {
                    setVoiding(null);
                    setEditing(editing === event.id ? null : event.id);
                    setMinute(String(event.minute));
                    setDescription(event.description ?? '');
                    setReason('');
                  }}
                  onVoid={() => {
                    setEditing(null);
                    setVoiding(voiding === event.id ? null : event.id);
                    setReason('');
                  }}
                  onCancel={() => { setEditing(null); setVoiding(null); }}
                  minute={minute}
                  setMinute={setMinute}
                  description={description}
                  setDescription={setDescription}
                  reason={reason}
                  setReason={setReason}
                  onRun={onRun}
                  onDone={onDone}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EventRow({
  event,
  teamName,
  busy,
  editing,
  voiding,
  onEdit,
  onVoid,
  onCancel,
  minute,
  setMinute,
  description,
  setDescription,
  reason,
  setReason,
  onRun,
  onDone,
}: {
  event: MatchEventDto;
  teamName: string;
  busy: boolean;
  editing: boolean;
  voiding: boolean;
  onEdit: () => void;
  onVoid: () => void;
  onCancel: () => void;
  minute: string;
  setMinute: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onDone: (message: string) => void;
}) {
  return (
    <>
      <tr>
        <td className="num">{event.minute}{event.addedMinutes ? `+${event.addedMinutes}` : ''}&apos;</td>
        <td>{EVENT_LABEL[event.eventType] ?? event.eventType}</td>
        <td>{teamName}</td>
        <td>{event.playerRegistrationId ?? '—'}</td>
        <td>
          {event.voidedAt ? <span className="tl-badge">Voided</span> : event.correctedAt ? <span className="tl-badge">Corrected</span> : <span className="tl-badge">Recorded</span>}
        </td>
        <td>
          {!event.voidedAt ? (
            <span className={styles.pillRow}>
              <button type="button" className="tl-btn tl-btn-sm" onClick={onEdit} disabled={busy}>Correct</button>
              <button type="button" className="tl-btn tl-btn-sm tl-btn-danger" onClick={onVoid} disabled={busy}>Void</button>
            </span>
          ) : null}
        </td>
      </tr>
      {editing ? (
        <tr>
          <td colSpan={6}>
            <form
              className={styles.inlineForm}
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault();
                void onRun(async () => {
                  await matchesApi.correctEvent(event.matchId, event.id, {
                    minute: Number(minute),
                    description: description.trim(),
                    reason: reason.trim(),
                  });
                  onCancel();
                  onDone('Event corrected.');
                });
              }}
            >
              <label className="tl-field"><span className="tl-label">Minute</span><input className="tl-input" type="number" min={0} max={150} value={minute} onChange={(e) => setMinute(e.target.value)} required /></label>
              <label className="tl-field"><span className="tl-label">Description</span><input className="tl-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></label>
              <label className="tl-field"><span className="tl-label">Reason (required)</span><input className="tl-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></label>
              <button type="submit" className="tl-btn tl-btn-primary" disabled={busy || !reason.trim()}>Save correction</button>
              <button type="button" className="tl-btn tl-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            </form>
          </td>
        </tr>
      ) : null}
      {voiding ? (
        <tr>
          <td colSpan={6}>
            <form
              className={styles.inlineForm}
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault();
                void onRun(async () => {
                  await matchesApi.voidEvent(event.matchId, event.id, reason.trim());
                  onCancel();
                  onDone('Event voided.');
                });
              }}
            >
              <label className="tl-field"><span className="tl-label">Void reason (required)</span><input className="tl-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></label>
              <button type="submit" className="tl-btn tl-btn-danger" disabled={busy || !reason.trim()}>Void event</button>
              <button type="button" className="tl-btn tl-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function ResultPanel({
  detail,
  result,
  busy,
  onRun,
  onDone,
}: {
  detail: MatchDetailDto;
  result: { score: { homeScore: number; awayScore: number }; derivedScore: { homeScore: number; awayScore: number }; match: { resultConfirmedAt: string | null } } | undefined;
  busy: boolean;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onDone: (message: string) => void;
}) {
  const historyQ = useQuery({
    queryKey: ['official-result-history', detail.match.id],
    queryFn: () => matchesApi.resultHistory(detail.match.id),
    enabled: Boolean(detail.match.resultConfirmedAt),
  });
  const [reason, setReason] = useState('');

  return (
    <div className="tl-card">
      <h3 className={styles.sectionTitle}><ShieldAlert size={16} aria-hidden /> Result</h3>
      {detail.match.status !== 'full_time' ? (
        <p className="tl-muted">The result can be submitted after the match reaches full time.</p>
      ) : detail.match.resultConfirmedAt ? (
        <p className="tl-alert tl-alert-success">
          Result confirmed {formatDateTime(detail.match.resultConfirmedAt, DISPLAY_TIME_ZONE)}.
          {result ? ` Recorded ${result.score.homeScore}–${result.score.awayScore}, derived ${result.derivedScore.homeScore}–${result.derivedScore.awayScore}.` : ''}
        </p>
      ) : (
        <div className="tl-stack-sm">
          <p className="tl-muted">
            Submitting the report confirms the score derived from the recorded goal events and makes it count toward standings.
          </p>
          <label className="tl-field">
            <span className="tl-label">Reason (optional)</span>
            <input className="tl-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
          </label>
          <button
            type="button"
            className="tl-btn tl-btn-primary"
            disabled={busy}
            onClick={() => void onRun(async () => {
              await matchesApi.report(detail.match.id, reason.trim() || null);
              setReason('');
              onDone('Result submitted and confirmed.');
            })}
          >
            Submit full-time result
          </button>
        </div>
      )}

      {detail.match.resultConfirmedAt ? (
        <>
          <h4 className={styles.sectionTitle}><History size={15} aria-hidden /> Result history</h4>
          {historyQ.isLoading ? <Skeleton lines={1} height={36} /> : historyQ.isError ? (
            <p className="tl-muted">Could not load the result history.</p>
          ) : (historyQ.data ?? []).length === 0 ? (
            <p className="tl-muted">No result history entries.</p>
          ) : (
            <ul className={styles.list}>
              {historyQ.data!.map((entry) => (
                <li key={entry.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <strong>{entry.action}</strong>
                    <span className="tl-muted">{formatDateTime(entry.createdAt, DISPLAY_TIME_ZONE)}{entry.reason ? ` · ${entry.reason}` : ''}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
