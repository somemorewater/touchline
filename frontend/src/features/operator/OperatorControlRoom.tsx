'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/features/auth/AuthProvider';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { Feedback, useAdminAction } from '@/features/admin/ui';
import { useMatchLive } from '@/features/matches/useMatchLive';
import { formatClock, useMatchClock } from '@/features/matches/useMatchClock';
import {
  commentaryApi,
  matchesApi,
  type CommentaryCreateInput,
} from '@/lib/api/endpoints';
import type { MatchEventDto, MatchSquadDto, MatchSquadPlayerDto } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { statusLabel } from '@/lib/match';
import { DISPLAY_TIME_ZONE, type MatchStatus } from '@/types';
import styles from './OperatorControlRoom.module.css';

type Assignment = {
  matchId: string;
  fixtureId: string;
  seasonId: string;
  competitionId: string;
  status: string;
  scheduledAt: string | null;
  homeTeamName: string;
  awayTeamName: string;
};

type Dialog = null | 'event' | 'substitution' | 'commentary' | 'key' | 'overview' | 'clock' | 'correct' | 'retract';

const OFFICIAL_EVENT_TYPES = [
  ['goal', 'Goal'], ['own-goal', 'Own goal'], ['penalty-awarded', 'Penalty awarded'],
  ['penalty-scored', 'Penalty scored'], ['penalty-missed', 'Penalty missed'],
  ['yellow-card', 'Yellow card'], ['red-card', 'Red card'], ['injury', 'Injury'],
] as const;

const KEY_MOMENT_TYPES = [
  ['chance', 'Major chance'], ['save', 'Save'], ['goal', 'Goal'], ['penalty-scored', 'Penalty scored'],
  ['red-card', 'Red card'], ['half-time', 'Half-time'], ['full-time', 'Full-time'], ['other', 'Other'],
] as const;

const LIVE_STATUSES = ['first_half', 'live', 'half_time', 'second_half', 'extra_time', 'penalties'];
const PLAYER_REQUIRED_EVENTS = new Set([
  'goal', 'own-goal', 'yellow-card', 'second-yellow', 'red-card',
  'penalty-scored', 'penalty-missed', 'injury', 'substitution',
]);

export function OperatorControlRoom() {
  const { isOperator, isSuperAdmin } = useAuth();
  const { competitions } = useActiveCompetition();
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [selectedId, setSelectedId] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [eventType, setEventType] = useState<string>('goal');
  const [teamId, setTeamId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [outgoingId, setOutgoingId] = useState('');
  const [incomingId, setIncomingId] = useState('');
  const [minute, setMinute] = useState('0');
  const [addedMinutes, setAddedMinutes] = useState('');
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [important, setImportant] = useState(false);
  const [targetEvent, setTargetEvent] = useState<MatchEventDto | null>(null);
  const [targetEntryId, setTargetEntryId] = useState('');
  const [overviewDraft, setOverviewDraft] = useState({
    introduction: '', preMatchNotes: '', liveSummary: '', narrative: '',
  });

  const assignmentsQ = useQuery({
    queryKey: ['operator-assignments'],
    queryFn: () => matchesApi.myOfficialMatches(),
    enabled: isOperator || isSuperAdmin,
  });
  const assignments = assignmentsQ.data ?? [];
  const liveMatches = assignments.filter((m) => LIVE_STATUSES.includes(m.status));
  const upcoming = assignments.filter((m) => ['scheduled', 'postponed'].includes(m.status));
  const finished = assignments.filter((m) => !LIVE_STATUSES.includes(m.status) && !['scheduled', 'postponed'].includes(m.status));

  const activeId = selectedId || liveMatches[0]?.matchId || assignments[0]?.matchId || '';
  const detailQ = useQuery({
    queryKey: ['operator-match', activeId],
    queryFn: () => matchesApi.get(activeId),
    enabled: Boolean(activeId),
  });
  const detail = detailQ.data ?? null;
  const commentaryQ = useQuery({
    queryKey: ['match-commentary', activeId],
    queryFn: () => commentaryApi.list(activeId),
    enabled: Boolean(activeId),
  });
  const overviewQ = useQuery({
    queryKey: ['match-overview', activeId],
    queryFn: () => commentaryApi.overview(activeId),
    enabled: Boolean(activeId),
  });
  const squadQ = useQuery({
    queryKey: ['operator-squad', activeId],
    queryFn: () => matchesApi.squad(activeId),
    enabled: Boolean(activeId),
  });
  const squad: MatchSquadDto | undefined = squadQ.data;
  const live = useMatchLive(activeId, detail ? LIVE_STATUSES.includes(detail.match.status) : false);

  const clockSource = {
    status: live.update?.match.status ?? detail?.match.status ?? 'scheduled',
    clockRunningAt: live.update?.match.clockRunningAt ?? detail?.match.clockRunningAt ?? null,
    clockAccumulatedSeconds: live.update?.match.clockAccumulatedSeconds ?? detail?.match.clockAccumulatedSeconds ?? 0,
    addedMinutes: live.update?.match.addedMinutes ?? detail?.match.addedMinutes ?? null,
    currentMinute: live.update?.match.currentMinute ?? detail?.match.currentMinute ?? 0,
  };
  const clockDisplay = useMatchClock(clockSource);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['operator-match', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['operator-assignments'] });
    void queryClient.invalidateQueries({ queryKey: ['match-commentary', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['match-overview', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['match', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['matches'] });
  };

  if (!isOperator && !isSuperAdmin) {
    return <EmptyState title="Operator control room is not available">This workspace is for assigned match operators.</EmptyState>;
  }
  if (assignmentsQ.isLoading) return <Skeleton lines={4} height={120} />;
  if (assignmentsQ.isError) return <ErrorState title="Could not load your assignments" onRetry={() => void assignmentsQ.refetch()} />;
  if (assignments.length === 0) {
    return <EmptyState title="No matches assigned">A competition administrator must assign you to a match before you can operate it.</EmptyState>;
  }

  const frame = live.update?.match ?? null;
  const currentMinute = frame?.currentMinute ?? detail?.match.currentMinute ?? 0;
  const status = frame?.status ?? detail?.match.status ?? 'scheduled';
  const score = frame ? { home: frame.homeScore, away: frame.awayScore } : {
    home: detail?.match.homeScore ?? 0, away: detail?.match.awayScore ?? 0,
  };

  const openDialog = (next: Dialog, prefilledMinute = currentMinute) => {
    setMinute(String(prefilledMinute));
    setAddedMinutes('');
    setBody('');
    setReason('');
    setImportant(false);
    setPlayerId('');
    setPlayerSearch('');
    if (next === 'key') setEventType('chance');
    if (next === 'event') setEventType('goal');
    setDialog(next);
  };

  const run = (key: string, task: () => Promise<void>, success: string) => {
    void action.run(key, async () => {
      await task();
      setDialog(null);
      refresh();
      return success;
    });
  };

  const competitionName = (id: string) => competitions.find((c) => c.id === id)?.name ?? 'Competition';

  const matchList = (label: string, list: Assignment[]) => list.length === 0 ? null : (
    <section className={styles.group}>
      <h3>{label}</h3>
      <ul className={styles.matches}>
        {list.map((match) => (
          <li key={match.matchId}>
            <button
              type="button"
              className={`${styles.matchButton} ${activeId === match.matchId ? styles.active : ''}`}
              onClick={() => { setSelectedId(match.matchId); setDialog(null); }}
            >
              <strong>{match.homeTeamName} v {match.awayTeamName}</strong>
              <small>{competitionName(match.competitionId)} · {statusLabel(match.status.replaceAll('_', '-') as MatchStatus)}</small>
              <small>{match.scheduledAt ? formatDateTime(match.scheduledAt, DISPLAY_TIME_ZONE) : 'Kick-off not set'}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  const teamOptions = () => (
    <>
      <option value={detail?.match.homeRegistration?.id ?? ''}>{detail?.match.homeTeam?.name ?? 'Home'}</option>
      <option value={detail?.match.awayRegistration?.id ?? ''}>{detail?.match.awayTeam?.name ?? 'Away'}</option>
    </>
  );
  const squadFor = (id: string) => (squad?.players ?? []).filter(
    (entry) => entry.teamRegistrationId === id && entry.eligible,
  );
  const activeTeamId = teamId || squad?.homeRegistrationId || detail?.match.homeRegistration?.id || '';
  const playerLabel = (entry: MatchSquadPlayerDto) =>
    `${entry.fullName} #${entry.shirtNumber ?? '–'}${entry.lineupRole ? ` (${entry.lineupRole})` : ''}`;
  const selectedPlayer = (squad?.players ?? []).find((entry) => entry.registrationId === playerId);

  const officialTimeline = (detail?.events ?? []).map((event) => ({
    id: event.id, minute: event.minute, at: event.createdAt,
    label: event.eventType.replaceAll('-', ' '), body: event.description ?? '', author: 'Official event', kind: 'official' as const,
  }));
  const editorialTimeline = [
    ...officialTimeline,
    ...(commentaryQ.data ?? []).map((entry) => ({
      id: entry.id, minute: entry.minute ?? 0, at: entry.createdAt,
      label: entry.kind === 'key_moment' ? `Key moment · ${entry.eventType}` : 'Commentary',
      body: entry.body, author: entry.author ?? 'Match operator', kind: 'editorial' as const,
      status: entry.status, entryId: entry.id,
    })),
  ].sort((a, b) => a.minute - b.minute || a.at.localeCompare(b.at));

  return (
    <>
      <PageHeader
        title="Operator control room"
        lead="Run the live match, publish commentary and keep the public match page up to date from one screen."
        aside={<Link className="tl-btn" href="/matches">Public matches</Link>}
      />
      <div className={styles.layout}>
      {detail ? (
        <section className={styles.control}>
          <div className={styles.scoreboard}>
            <div><span>Home</span><strong>{detail.match.homeTeam?.name ?? 'Home'}</strong></div>
            <div className={styles.score}>{score.home} – {score.away}</div>
            <div><span>Away</span><strong>{detail.match.awayTeam?.name ?? 'Away'}</strong></div>
            <dl className={styles.meta}>
              <div><dt>Clock</dt><dd>{formatClock(clockDisplay)}</dd></div>
              <div><dt>Status</dt><dd>{statusLabel(status.replaceAll('_', '-') as MatchStatus)}</dd></div>
              <div><dt>Period</dt><dd>{LIVE_STATUSES.includes(status) ? status.replaceAll('_', ' ') : 'Pre-match'}</dd></div>
              <div><dt>Venue</dt><dd>{detail.match.fixture.venue ?? 'To be confirmed'}</dd></div>
              <div><dt>Connection</dt><dd>{live.state}</dd></div>
            </dl>
          </div>
          <Feedback error={action.error} notice={action.notice} />

          <div className={styles.quick}>
            <button type="button" className="tl-btn tl-btn-primary" onClick={() => openDialog('event')}>Goal / incident</button>
            <button type="button" className="tl-btn" onClick={() => { openDialog('event'); setEventType('own-goal'); }}>Own goal</button>
            <button type="button" className="tl-btn" onClick={() => { openDialog('event'); setEventType('penalty-scored'); }}>Penalty</button>
            <button type="button" className="tl-btn" onClick={() => { openDialog('event'); setEventType('yellow-card'); }}>Yellow card</button>
            <button type="button" className="tl-btn" onClick={() => { openDialog('event'); setEventType('red-card'); }}>Red card</button>
            <button type="button" className="tl-btn" onClick={() => openDialog('substitution')}>Substitution</button>
            <button type="button" className="tl-btn" onClick={() => openDialog('key')}>Key moment</button>
            <button type="button" className="tl-btn" onClick={() => openDialog('commentary')}>Commentary</button>
            <button type="button" className="tl-btn" onClick={() => {
              const overview = overviewQ.data;
              setOverviewDraft({
                introduction: overview?.introduction ?? '',
                preMatchNotes: overview?.preMatchNotes ?? '',
                liveSummary: overview?.liveSummary ?? '',
                narrative: overview?.narrative ?? '',
              });
              setDialog('overview');
            }}>Match overview</button>
          </div>

          <div className={styles.liveControls}>
            {(['start', 'half-time', 'second-half', 'end'] as const).map((step) => (
              <button
                key={step}
                type="button"
                className="tl-btn tl-btn-sm"
                disabled={action.pending !== null}
                onClick={() => run(`period-${step}`, async () => {
                  await matchesApi.lifecycle(activeId, step);
                }, `Match ${step.replaceAll('-', ' ')}.`)}
              >
                {step.replaceAll('-', ' ')}
              </button>
            ))}
            <button type="button" className="tl-btn tl-btn-sm" disabled={action.pending !== null} onClick={() => openDialog('clock')}>
              Set clock
            </button>
          </div>

          <section className={styles.timeline}>
            <h3>Activity timeline</h3>
            {editorialTimeline.length === 0 ? <p className="tl-muted">No events or commentary yet.</p> : (
              <ol>
                {editorialTimeline.map((item) => (
                  <li key={item.id}>
                    <span className={styles.minute}>{item.minute}&apos;</span>
                    <div>
                      <strong>{item.label}</strong>
                      {item.kind === 'editorial' && item.status === 'retracted' ? <span className="tl-badge">Retracted</span> : null}
                      <p>{item.body || '—'}</p>
                      <small>{item.author}</small>
                    </div>
                    {item.kind === 'editorial' && item.status !== 'retracted' ? (
                      <span className={styles.rowActions}>
                        <button type="button" className="tl-btn tl-btn-sm" onClick={() => {
                          setTargetEvent(null);
                          setTargetEntryId((item as { entryId: string }).entryId);
                          setBody((item as { body: string }).body);
                          setDialog('correct');
                        }}>Edit</button>
                        <button type="button" className="tl-btn tl-btn-sm" onClick={() => run(`retract-${item.id}`, async () => {
                          await commentaryApi.retract(activeId, (item as { entryId: string }).entryId);
                        }, 'Entry retracted.')}>Retract</button>
                      </span>
                    ) : null}
                    {item.kind === 'official' ? (
                      <span className={styles.rowActions}>
                        <button type="button" className="tl-btn tl-btn-sm" onClick={() => {
                          const event = (detail?.events ?? []).find((entry) => entry.id === item.id) ?? null;
                          setTargetEvent(event);
                          setTargetEntryId('');
                          setBody(event?.description ?? '');
                          setMinute(String(event?.minute ?? minute));
                          setDialog('correct');
                        }}>Correct</button>
                        <button type="button" className="tl-btn tl-btn-sm" onClick={() => {
                          const event = (detail?.events ?? []).find((entry) => entry.id === item.id) ?? null;
                          setTargetEvent(event);
                          setReason('');
                          setDialog('retract');
                        }}>Void</button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </section>
      ) : detailQ.isLoading ? <Skeleton lines={4} height={120} /> : <ErrorState title="Could not load the selected match" onRetry={() => void detailQ.refetch()} />}

      <aside className={styles.sidebar}>
        {matchList('Live now', liveMatches)}
        {matchList('Upcoming', upcoming)}
        {matchList('Completed', finished)}
      </aside>

      <ConfirmDialog
        open={dialog === 'event'}
        onClose={() => setDialog(null)}
        onConfirm={() => run(`event-${eventType}`, async () => {
          await matchesApi.createEvent(activeId, {
            clientEventId: crypto.randomUUID(),
            eventType,
            teamRegistrationId: teamId || selectedPlayer?.teamRegistrationId || null,
            playerRegistrationId: playerId || null,
            minute: Number(minute),
            addedMinutes: addedMinutes ? Number(addedMinutes) : null,
            description: body || null,
          });
        }, 'Official event recorded.')}
        title="Record official incident"
        message={eventType === 'own-goal'
          ? 'The scorer’s team is recorded; the opponent is credited with the goal.'
          : 'This changes official match data and the score where applicable.'}
        confirmLabel="Record"
        busy={action.pending !== null || (PLAYER_REQUIRED_EVENTS.has(eventType) && !playerId)}
      >
        <div className={styles.formGrid}>
          <label className="tl-field"><span className="tl-label">Type</span>
            <select className="tl-select" value={eventType} onChange={(e) => setEventType(e.target.value)}>
              {OFFICIAL_EVENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="tl-field"><span className="tl-label">Team</span>
            <select className="tl-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">From selected player</option>{teamOptions()}
            </select>
          </label>
          <label className={styles.wide}><span className="tl-label">Find player</span>
            <input className="tl-input" value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} placeholder="Name or shirt number" />
          </label>
          <label className={styles.wide}><span className="tl-label">Player</span>
            <select
              className="tl-select"
              value={playerId}
              onChange={(e) => {
                const next = (squad?.players ?? []).find((entry) => entry.registrationId === e.target.value);
                setPlayerId(e.target.value);
                if (next) setTeamId(next.teamRegistrationId);
              }}
              required={PLAYER_REQUIRED_EVENTS.has(eventType)}
            >
              <option value="">Not specified</option>
              {(['home', 'away'] as const).map((side) => {
                const teamIdForSide = side === 'home' ? squad?.homeRegistrationId : squad?.awayRegistrationId;
                const list = squadFor(teamIdForSide ?? '').filter((entry) => {
                  const term = playerSearch.trim().toLowerCase();
                  return !term || entry.fullName.toLowerCase().includes(term) || String(entry.shirtNumber ?? '').includes(term);
                });
                return list.length === 0 ? null : (
                  <optgroup key={side} label={side === 'home' ? 'Home Team' : 'Away Team'}>
                    {list.map((entry) => <option key={entry.registrationId} value={entry.registrationId}>{playerLabel(entry)}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </label>
          {!squad || squad.players.length === 0 ? (
            <p className="tl-muted">No eligible players found for this match. {squad?.hasLineup === false ? 'Approved, eligible registrations are used when no lineup has been submitted.' : ''}</p>
          ) : null}
          <label className="tl-field"><span className="tl-label">Minute</span><input className="tl-input" type="number" min={0} max={150} value={minute} onChange={(e) => setMinute(e.target.value)} /></label>
          <label className="tl-field"><span className="tl-label">Added</span><input className="tl-input" type="number" min={0} max={30} value={addedMinutes} onChange={(e) => setAddedMinutes(e.target.value)} /></label>
          <label className="tl-field"><span className="tl-label">Description</span><input className="tl-input" value={body} onChange={(e) => setBody(e.target.value)} /></label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'substitution'}
        onClose={() => setDialog(null)}
        onConfirm={() => run('substitution', async () => {
          await matchesApi.createEvent(activeId, {
            clientEventId: crypto.randomUUID(),
            eventType: 'substitution',
            teamRegistrationId: teamId,
            playerRegistrationId: outgoingId,
            secondaryPlayerRegistrationId: incomingId,
            minute: Number(minute),
            addedMinutes: addedMinutes ? Number(addedMinutes) : null,
          });
        }, 'Substitution recorded.')}
        title="Record substitution"
        message="Both players must belong to the selected team and match squad."
        confirmLabel="Record"
        busy={action.pending !== null}
      >
        <div className={styles.formGrid}>
          <label className="tl-field"><span className="tl-label">Team</span>
            <select className="tl-select" value={teamId} onChange={(e) => { setTeamId(e.target.value); setOutgoingId(''); setIncomingId(''); }}>{teamOptions()}</select>
          </label>
          <label className="tl-field"><span className="tl-label">Player off</span>
            <select className="tl-select" value={outgoingId} onChange={(e) => setOutgoingId(e.target.value)}>
              <option value="">Select</option>
              {squadFor(activeTeamId).filter((p) => p.lineupRole === 'starter').map((p) => <option key={p.registrationId} value={p.registrationId}>{playerLabel(p)}</option>)}
            </select>
          </label>
          <label className="tl-field"><span className="tl-label">Player on</span>
            <select className="tl-select" value={incomingId} onChange={(e) => setIncomingId(e.target.value)}>
              <option value="">Select</option>
              {squadFor(activeTeamId).filter((p) => p.lineupRole === 'substitute').map((p) => <option key={p.registrationId} value={p.registrationId}>{playerLabel(p)}</option>)}
            </select>
          </label>
          <label className="tl-field"><span className="tl-label">Minute</span><input className="tl-input" type="number" min={0} max={150} value={minute} onChange={(e) => setMinute(e.target.value)} /></label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'commentary' || dialog === 'key'}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          const input: CommentaryCreateInput = {
            kind: dialog === 'key' ? 'key_moment' : 'commentary',
            eventType: dialog === 'key' ? eventType : null,
            body,
            minute: Number(minute),
            addedMinutes: addedMinutes ? Number(addedMinutes) : null,
            teamRegistrationId: teamId || null,
            isImportant: important,
          };
          run(`commentary-${input.kind}`, async () => {
            await commentaryApi.create(activeId, input);
          }, input.kind === 'key_moment' ? 'Key moment published.' : 'Commentary published.');
        }}
        title={dialog === 'key' ? 'Record key moment' : 'Publish commentary'}
        message={dialog === 'key' ? 'Editorial annotations do not change the official score.' : 'Published immediately to the public match centre.'}
        confirmLabel="Publish"
        busy={action.pending !== null}
      >
        <div className={styles.formGrid}>
          {dialog === 'key' ? (
            <label className="tl-field"><span className="tl-label">Moment</span>
              <select className="tl-select" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                {KEY_MOMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="tl-field"><span className="tl-label">Minute</span><input className="tl-input" type="number" min={0} max={150} value={minute} onChange={(e) => setMinute(e.target.value)} /></label>
          <label className="tl-field"><span className="tl-label">Team</span><select className="tl-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">Not specified</option>{teamOptions()}</select></label>
          <label className="tl-field tl-check"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Important</label>
          <label className={styles.wide}><span className="tl-label">Text</span><textarea className="tl-textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} required /></label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'overview'}
        onClose={() => setDialog(null)}
        onConfirm={() => run('overview', async () => {
          await commentaryApi.saveOverview(activeId, overviewDraft);
        }, 'Match overview updated.')}
        title="Update match overview"
        message="Shown on the public match centre Overview tab."
        confirmLabel="Save overview"
        busy={action.pending !== null}
      >
        <div className={styles.formGrid}>
          {([
            ['introduction', 'Introduction'], ['preMatchNotes', 'Pre-match notes'],
            ['liveSummary', 'Live summary'], ['narrative', 'Match narrative'],
          ] as const).map(([key, label]) => (
            <label key={key} className={styles.wide}><span className="tl-label">{label}</span>
              <textarea className="tl-textarea" rows={3} value={overviewDraft[key]} onChange={(e) => setOverviewDraft({ ...overviewDraft, [key]: e.target.value })} />
            </label>
          ))}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'clock'}
        onClose={() => setDialog(null)}
        onConfirm={() => run('clock', async () => {
          await matchesApi.clock(activeId, Number(minute), addedMinutes ? Number(addedMinutes) : null);
        }, 'Clock updated.')}
        title="Set match clock"
        message="The clock is explicit server state shared with every viewer."
        confirmLabel="Set clock"
        busy={action.pending !== null}
      >
        <div className={styles.formGrid}>
          <label className="tl-field"><span className="tl-label">Minute</span><input className="tl-input" type="number" min={0} max={150} value={minute} onChange={(e) => setMinute(e.target.value)} /></label>
          <label className="tl-field"><span className="tl-label">Added</span><input className="tl-input" type="number" min={0} max={30} value={addedMinutes} onChange={(e) => setAddedMinutes(e.target.value)} /></label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'correct'}
        onClose={() => setDialog(null)}
        onConfirm={() => run('correct', async () => {
          if (targetEvent) {
            await matchesApi.correctEvent(activeId, targetEvent.id, {
              minute: Number(minute), description: body, reason: reason || 'Operator correction',
            });
          } else {
            await commentaryApi.update(activeId, targetEntryId, { body });
          }
        }, 'Entry corrected.')}
        title="Correct entry"
        message="Official corrections are audited and recalculate the score where applicable."
        confirmLabel="Save correction"
        busy={action.pending !== null}
      >
        <div className={styles.formGrid}>
          <label className="tl-field"><span className="tl-label">Minute</span><input className="tl-input" type="number" min={0} max={150} value={minute} onChange={(e) => setMinute(e.target.value)} /></label>
          <label className="tl-field"><span className="tl-label">Reason</span><input className="tl-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <label className={styles.wide}><span className="tl-label">Text</span><textarea className="tl-textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'retract'}
        onClose={() => setDialog(null)}
        onConfirm={() => run('retract-event', async () => {
          if (targetEvent) await matchesApi.voidEvent(activeId, targetEvent.id, reason || 'Recorded in error');
        }, 'Official event voided.')}
        title="Void official event"
        message="The event is preserved in history and removed from the derived score."
        confirmLabel="Void event"
        isDestructive
        busy={action.pending !== null}
      >
        <label className={styles.wide}><span className="tl-label">Reason</span><textarea className="tl-textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </ConfirmDialog>
      </div>
    </>
  );
}
