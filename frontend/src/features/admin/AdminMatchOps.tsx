'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Flag, ListChecks, RefreshCw, Shuffle, Trophy } from 'lucide-react';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/States';
import {
  ACTION_LABEL,
  EventEntry,
  EventList,
  MatchActions,
  ResultPanel,
  lifecycleActions,
} from '@/features/official/OfficialWorkspace';
import { useMatchLive } from '@/features/matches/useMatchLive';
import {
  competitionsApi,
  fixturesApi,
  matchesApi,
  registrationsApi,
  standingsApi,
  teamsApi,
  usersApi,
} from '@/lib/api/endpoints';
import type {
  FixtureDto,
  FixturePreviewDto,
  GroupDto,
  PlayerRegistrationDto,
  StandingsDto,
} from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { statusLabel as matchStatusLabel } from '@/lib/match';
import { DISPLAY_TIME_ZONE, type MatchStatus } from '@/types';
import { AdminSection, Feedback, Field, statusLabel, useAdminAction } from './ui';
import styles from './Admin.module.css';

const viewStatus = (status: string): MatchStatus => status.replaceAll('_', '-') as MatchStatus;

export function AdminMatchOps() {
  const { competition, season } = useActiveCompetition();

  if (!competition || !season) {
    return (
      <AdminSection title="Fixtures, matches and standings">
        <p className={styles.muted}>Select a competition and season to manage fixtures and matches.</p>
      </AdminSection>
    );
  }

  return (
    <AdminSection
      title="Fixtures, matches and standings"
      description={`${competition.name} · ${season.label}. Fixtures become public matches when published; every lifecycle action is checked by the server.`}
    >
      <FixtureManagement competitionId={competition.id} seasonId={season.id} />
      <div className={styles.divider} />
      <StandingsPanel competitionId={competition.id} seasonId={season.id} />
    </AdminSection>
  );
}

/* ------------------------------- fixtures -------------------------------- */

function FixtureManagement({ competitionId, seasonId }: { competitionId: string; seasonId: string }) {
  const { canIn, user } = useAuth();
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const canManage = canIn('fixtures.manage', competitionId);
  const canManageMatches = canIn('matches.manage', competitionId);
  const canAssignOfficials = canIn('officials.assign', competitionId);

  const fixturesQ = useQuery({
    queryKey: ['admin-fixtures', seasonId],
    queryFn: () => fixturesApi.list({ seasonId }),
  });
  const entriesQ = useQuery({
    queryKey: ['admin-team-entries', seasonId],
    queryFn: () => teamsApi.entries(seasonId),
  });
  const groupsQ = useQuery({
    queryKey: ['admin-groups', seasonId],
    queryFn: () => competitionsApi.groups(seasonId),
  });

  const [openFixture, setOpenFixture] = useState<string | null>(null);

  const invalidate = (matchId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['admin-fixtures', seasonId] });
    if (matchId) {
      void queryClient.invalidateQueries({ queryKey: ['admin-match', matchId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-result', matchId] });
      void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
    }
  };

  const fixtures = useMemo(
    () => [...(fixturesQ.data ?? [])].sort((a, b) => {
      const at = a.scheduledAt ? Date.parse(a.scheduledAt) : Number.POSITIVE_INFINITY;
      const bt = b.scheduledAt ? Date.parse(b.scheduledAt) : Number.POSITIVE_INFINITY;
      return at - bt || (a.round ?? 0) - (b.round ?? 0);
    }),
    [fixturesQ.data],
  );

  const approvedEntries = (entriesQ.data ?? []).filter((entry) => entry.registration.status === 'approved');

  return (
    <>
      <Feedback error={action.error} notice={action.notice} />

      <h3 className={styles.subheading}><ListChecks size={16} aria-hidden /> Fixtures</h3>
      {fixturesQ.isLoading ? <p className={styles.muted}>Loading fixtures…</p> : fixturesQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load fixtures.</p>
      ) : fixtures.length === 0 ? (
        <EmptyState title="No fixtures yet">Create fixtures individually or preview a round-robin schedule below.</EmptyState>
      ) : (
        <div className={styles.list}>
          {fixtures.map((fixture) => (
            <FixtureRow
              key={fixture.id}
              fixture={fixture}
              groups={groupsQ.data ?? []}
              canManage={canManage}
              canManageMatches={canManageMatches}
              canAssignOfficials={canAssignOfficials}
              currentUserId={user?.id ?? null}
              competitionId={competitionId}
              open={openFixture === fixture.id}
              onToggle={() => setOpenFixture(openFixture === fixture.id ? null : fixture.id)}
              onChanged={invalidate}
              onNotice={action.setNotice}
              run={action.run}
              pending={action.pending}
            />
          ))}
        </div>
      )}

      {canManage ? (
        <>
          <CreateFixtureForm
            seasonId={seasonId}
            entries={approvedEntries}
            groups={groupsQ.data ?? []}
            pending={action.pending === 'create-fixture'}
            onCreated={() => {
              invalidate();
              return 'Fixture created as a draft.';
            }}
            run={action.run}
          />
          <RoundRobinPanel
            seasonId={seasonId}
            groups={groupsQ.data ?? []}
            pending={action.pending}
            onCommitted={() => {
              invalidate();
            }}
            run={action.run}
          />
        </>
      ) : (
        <p className={styles.muted}>Fixtures require the fixtures manage permission in this competition.</p>
      )}
    </>
  );
}

function FixtureRow({
  fixture,
  groups,
  canManage,
  canManageMatches,
  canAssignOfficials,
  currentUserId,
  competitionId,
  open,
  onToggle,
  onChanged,
  onNotice,
  run,
  pending,
}: {
  fixture: FixtureDto;
  groups: GroupDto[];
  canManage: boolean;
  canManageMatches: boolean;
  canAssignOfficials: boolean;
  currentUserId: string | null;
  competitionId: string;
  open: boolean;
  onToggle: () => void;
  onChanged: (matchId?: string) => void;
  onNotice: (message: string) => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  pending: string | null;
}) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [reason, setReason] = useState('');
  const matchId = fixture.match?.id ?? null;
  const group = groups.find((entry) => entry.id === fixture.groupId);

  return (
    <div className={styles.entryRow}>
      <div className={styles.entryMain}>
        <strong>{fixture.homeTeam.name} v {fixture.awayTeam.name}</strong>
        <span className={styles.muted}>
          {fixture.scheduledAt ? formatDateTime(fixture.scheduledAt, DISPLAY_TIME_ZONE) : 'Kick-off not set'}
          {fixture.round ? ` · Round ${fixture.round}` : ''}
          {group ? ` · ${group.name}` : ''}
          {fixture.venue ? ` · ${fixture.venue}` : ''}
        </span>
      </div>
      <div className={styles.rowActions}>
        <span className="tl-badge">{statusLabel(fixture.status)}</span>
        {fixture.match ? (
          <span className="tl-badge">
            {matchStatusLabel(viewStatus(fixture.match.status))}
            {fixture.match.status !== 'scheduled' ? ` ${fixture.match.homeScore}–${fixture.match.awayScore}` : ''}
          </span>
        ) : null}

        {canManage && fixture.status === 'draft' ? (
          <button
            type="button"
            className="tl-btn tl-btn-sm tl-btn-primary"
            disabled={pending !== null}
            onClick={() => void run(`publish-fixture:${fixture.id}`, async () => {
              await fixturesApi.publish(fixture.id);
              onChanged(matchId ?? undefined);
              return 'Fixture published.';
            })}
          >
            Publish
          </button>
        ) : null}
        {canManage && fixture.status === 'scheduled' && fixture.publishedAt ? (
          <button
            type="button"
            className="tl-btn tl-btn-sm"
            disabled={pending !== null}
            onClick={() => void run(`unpublish-fixture:${fixture.id}`, async () => {
              await fixturesApi.unpublish(fixture.id);
              onChanged(matchId ?? undefined);
              return 'Fixture returned to draft.';
            })}
          >
            Unpublish
          </button>
        ) : null}
        {canManage && ['scheduled', 'postponed'].includes(fixture.status) ? (
          <button
            type="button"
            className="tl-btn tl-btn-sm"
            disabled={pending !== null}
            onClick={() => { setRescheduleOpen((value) => !value); setReason(''); }}
            aria-expanded={rescheduleOpen}
          >
            Reschedule
          </button>
        ) : null}
        {canManage && fixture.status === 'scheduled' ? (
          <button
            type="button"
            className="tl-btn tl-btn-sm"
            disabled={pending !== null}
            onClick={() => void run(`postpone-fixture:${fixture.id}`, async () => {
              await fixturesApi.postpone(fixture.id);
              onChanged(matchId ?? undefined);
              return 'Fixture postponed.';
            })}
          >
            Postpone
          </button>
        ) : null}
        {canManage && fixture.status === 'scheduled' ? (
          <button
            type="button"
            className="tl-btn tl-btn-sm tl-btn-danger"
            disabled={pending !== null}
            onClick={() => void run(`cancel-fixture:${fixture.id}`, async () => {
              await fixturesApi.cancel(fixture.id);
              onChanged(matchId ?? undefined);
              return 'Fixture cancelled.';
            })}
          >
            Cancel
          </button>
        ) : null}
        {matchId ? (
          <button type="button" className="tl-btn tl-btn-sm" onClick={onToggle} aria-expanded={open}>
            {open ? 'Close match' : 'Manage match'}
          </button>
        ) : null}
      </div>

      {rescheduleOpen ? (
        <form
          className={`${styles.form} ${styles.fullRow}`}
          onSubmit={(event) => {
            event.preventDefault();
            void run(`reschedule-fixture:${fixture.id}`, async () => {
              await fixturesApi.reschedule(fixture.id, new Date(scheduledAt).toISOString(), reason.trim() || null);
              setRescheduleOpen(false);
              setScheduledAt('');
              setReason('');
              onChanged(matchId ?? undefined);
              return 'Fixture rescheduled.';
            });
          }}
        >
          <div className={styles.formGrid}>
            <Field label="New kick-off">
              <input
                className="tl-input"
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                required
              />
            </Field>
            <Field label="Reason (optional)">
              <input className="tl-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
            </Field>
          </div>
          <div className={styles.formActions}>
            <button type="submit" className="tl-btn tl-btn-primary" disabled={pending !== null || !scheduledAt}>Save kick-off</button>
            <button type="button" className="tl-btn" onClick={() => setRescheduleOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : null}

      {open && matchId ? (
        <div className={`${styles.fullRow} ${styles.detail}`}>
          <MatchAdminPanel
            matchId={matchId}
            competitionId={competitionId}
            canManage={canManageMatches}
            canAssignOfficials={canAssignOfficials}
            currentUserId={currentUserId}
            onChanged={() => onChanged(matchId)}
            onNotice={onNotice}
            run={run}
            pending={pending}
          />
        </div>
      ) : null}
    </div>
  );
}

function CreateFixtureForm({
  seasonId,
  entries,
  groups,
  pending,
  onCreated,
  run,
}: {
  seasonId: string;
  entries: { registration: { id: string; status: string }; team: { name: string } }[];
  groups: GroupDto[];
  pending: boolean;
  onCreated: () => string;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
}) {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [groupId, setGroupId] = useState('');
  const [round, setRound] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [venue, setVenue] = useState('');

  if (entries.length < 2) {
    return <p className="tl-alert tl-alert-info">At least two approved team entries are needed before fixtures can be created.</p>;
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void run('create-fixture', async () => {
          await fixturesApi.create({
            seasonId,
            groupId: groupId || null,
            homeTeamRegistrationId: home,
            awayTeamRegistrationId: away,
            round: round ? Number(round) : null,
            scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
            venue: venue.trim() || null,
          });
          setHome('');
          setAway('');
          setRound('');
          setScheduledAt('');
          setVenue('');
          onCreated();
        });
      }}
    >
      <h3><CalendarPlus size={16} aria-hidden /> Create a fixture</h3>
      <div className={styles.formGrid}>
        <Field label="Home team">
          <select className="tl-select" value={home} onChange={(event) => setHome(event.target.value)} required>
            <option value="">Select a team</option>
            {entries.map((entry) => (
              <option key={entry.registration.id} value={entry.registration.id}>{entry.team.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Away team">
          <select className="tl-select" value={away} onChange={(event) => setAway(event.target.value)} required>
            <option value="">Select a team</option>
            {entries.map((entry) => (
              <option key={entry.registration.id} value={entry.registration.id}>{entry.team.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Group">
          <select className="tl-select" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">No group</option>
            {groups.filter((group) => !group.archivedAt).map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Round">
          <input className="tl-input" type="number" min={1} max={500} value={round} onChange={(event) => setRound(event.target.value)} />
        </Field>
        <Field label="Kick-off">
          <input className="tl-input" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
        </Field>
        <Field label="Venue">
          <input className="tl-input" value={venue} onChange={(event) => setVenue(event.target.value)} maxLength={200} />
        </Field>
      </div>
      <div className={styles.formActions}>
        <button type="submit" className="tl-btn tl-btn-primary" disabled={pending || !home || !away || home === away}>
          {pending ? 'Creating…' : 'Create fixture'}
        </button>
        {home && away && home === away ? <span className={styles.muted}>A team cannot play itself.</span> : null}
      </div>
    </form>
  );
}

function RoundRobinPanel({
  seasonId,
  groups,
  pending,
  onCommitted,
  run,
}: {
  seasonId: string;
  groups: GroupDto[];
  pending: string | null;
  onCommitted: () => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
}) {
  const [groupId, setGroupId] = useState('');
  const [legs, setLegs] = useState<'1' | '2'>('1');
  const [preview, setPreview] = useState<FixturePreviewDto | null>(null);

  return (
    <div className={styles.form}>
      <h3><Shuffle size={16} aria-hidden /> Round-robin generator</h3>
      <p className={styles.muted}>
        The preview is calculated by the server from the approved team entries. Nothing is written until the schedule is committed.
      </p>
      <div className={styles.formGrid}>
        <Field label="Group">
          <select className="tl-select" value={groupId} onChange={(event) => { setGroupId(event.target.value); setPreview(null); }}>
            <option value="">Whole season</option>
            {groups.filter((group) => !group.archivedAt).map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Legs">
          <select className="tl-select" value={legs} onChange={(event) => { setLegs(event.target.value as '1' | '2'); setPreview(null); }}>
            <option value="1">Single round robin</option>
            <option value="2">Home and away</option>
          </select>
        </Field>
      </div>
      <div className={styles.formActions}>
        <button
          type="button"
          className="tl-btn"
          disabled={pending !== null}
          onClick={() => void run('preview-round-robin', async () => {
            const result = await fixturesApi.previewGeneration({
              seasonId,
              groupId: groupId || null,
              legs: Number(legs) as 1 | 2,
            });
            setPreview(result);
            return `Preview generated: ${result.fixtures.length} fixtures across ${result.rounds} rounds.`;
          })}
        >
          <RefreshCw size={15} aria-hidden /> Preview schedule
        </button>
        {preview ? (
          <button
            type="button"
            className="tl-btn tl-btn-primary"
            disabled={pending !== null}
            onClick={() => void run('commit-round-robin', async () => {
              const result = await fixturesApi.generate({
                seasonId,
                groupId: groupId || null,
                legs: Number(legs) as 1 | 2,
              });
              setPreview(null);
              onCommitted();
              return `${result.created} fixtures created as drafts.`;
            })}
          >
            Commit {preview.fixtures.length} fixtures
          </button>
        ) : null}
      </div>

      {preview ? (
        <div className="tl-scroll">
          <table className="tl-table">
            <caption className="sr-only">Round-robin preview</caption>
            <thead>
              <tr><th scope="col">Round</th><th scope="col">Home</th><th scope="col">Away</th></tr>
            </thead>
            <tbody>
              {preview.fixtures.map((fixture, index) => (
                <tr key={`${fixture.round}:${fixture.homeTeamRegistrationId}:${fixture.awayTeamRegistrationId}:${index}`}>
                  <td className="num">{fixture.round}</td>
                  <td>{fixture.homeTeamName}</td>
                  <td>{fixture.awayTeamName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.warnings && preview.warnings.length > 0 ? (
            <ul className={styles.list}>
              {preview.warnings.map((warning) => <li key={warning} className={styles.warning}>{warning}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------- match ---------------------------------- */

function MatchAdminPanel({
  matchId,
  competitionId,
  canManage,
  canAssignOfficials,
  currentUserId,
  onChanged,
  onNotice,
  run,
  pending,
}: {
  matchId: string;
  competitionId: string;
  canManage: boolean;
  canAssignOfficials: boolean;
  currentUserId: string | null;
  onChanged: () => void;
  onNotice: (message: string) => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  pending: string | null;
}) {
  const detailQ = useQuery({
    queryKey: ['admin-match', matchId],
    queryFn: () => matchesApi.get(matchId),
  });
  const resultQ = useQuery({
    queryKey: ['admin-result', matchId],
    queryFn: () => matchesApi.result(matchId),
  });

  const detail = detailQ.data;
  const registrationIds = [
    detail?.match.homeRegistration?.id,
    detail?.match.awayRegistration?.id,
  ].filter((id): id is string => Boolean(id));

  const squadQueries = useQueries({
    queries: registrationIds.map((registrationId) => ({
      queryKey: ['admin-squad', registrationId],
      queryFn: () => registrationsApi.list({ teamRegistrationId: registrationId, status: 'approved' }),
      enabled: Boolean(detail),
    })),
  });

  const live = useMatchLive(
    matchId,
    Boolean(detail) && ['first_half', 'live', 'half_time', 'second_half', 'extra_time', 'penalties'].includes(detail!.match.status),
  );

  if (detailQ.isLoading) return <p className={styles.muted}>Loading match…</p>;
  if (detailQ.isError || !detail) return <p className="tl-alert tl-alert-error" role="alert">Could not load this match.</p>;

  const actions = lifecycleActions(detail.match.status);
  const squads = squadQueries.map((query) => (query.data ?? []) as PlayerRegistrationDto[]);

  return (
    <div className="tl-stack">
      <header className={styles.matchHead}>
        <div>
          <h4>{detail.match.homeTeam?.name ?? 'Home team'} v {detail.match.awayTeam?.name ?? 'Away team'}</h4>
          <p className={styles.muted}>
            {formatDateTime(detail.match.fixture.scheduledAt ?? undefined, DISPLAY_TIME_ZONE)} ·{' '}
            {matchStatusLabel(viewStatus(detail.match.status))}
            {live.state === 'open' ? ' · live connection open' : live.state === 'reconnecting' ? ' · reconnecting' : ''}
          </p>
        </div>
        <Link className="tl-btn tl-btn-sm" href={`/matches/${matchId}`}>Open public match page</Link>
      </header>

      {canManage ? (
        <>
          <MatchActions
            detail={detail}
            actions={actions}
            busy={pending !== null}
            onAction={(action) => {
              void run(`match:${matchId}:${action}`, async () => {
                await matchesApi.lifecycle(matchId, action);
                onChanged();
                return `Match ${ACTION_LABEL[action].toLowerCase()}.`;
              });
            }}
            onRun={(task) => run(`match-action:${matchId}`, task)}
            onRefresh={onChanged}
            result={resultQ.data}
          />

          <EventEntry
            detail={detail}
            squads={squads}
            busy={pending !== null}
            onRun={(task) => run(`event-entry:${matchId}`, task)}
            onDone={(message) => { onNotice(message); onChanged(); }}
          />

          <EventList
            detail={detail}
            busy={pending !== null}
            onRun={(task) => run(`event-list:${matchId}`, task)}
            onDone={(message) => { onNotice(message); onChanged(); }}
          />

          <ResultPanel
            detail={detail}
            result={resultQ.data}
            busy={pending !== null}
            onRun={(task) => run(`result:${matchId}`, task)}
            onDone={(message) => { onNotice(message); onChanged(); }}
          />

          <CorrectResult matchId={matchId} confirmed={Boolean(detail.match.resultConfirmedAt)} onChanged={onChanged} run={run} pending={pending} />
        </>
      ) : (
        <p className={styles.muted}>Recording events and confirming results requires the matches manage permission.</p>
      )}

      <OfficialsPanel
        matchId={matchId}
        competitionId={competitionId}
        canAssign={canAssignOfficials}
        currentUserId={currentUserId}
        onChanged={onChanged}
        run={run}
        pending={pending}
      />
    </div>
  );
}

function CorrectResult({
  matchId,
  confirmed,
  onChanged,
  run,
  pending,
}: {
  matchId: string;
  confirmed: boolean;
  onChanged: () => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  pending: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!confirmed) return null;

  return (
    <div className={styles.detail}>
      <h4>Correct the confirmed result</h4>
      {open ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void run(`correct-result:${matchId}`, async () => {
              await matchesApi.correctResult(matchId, reason.trim());
              setOpen(false);
              setReason('');
              onChanged();
              return 'Result corrected and a new version recorded.';
            });
          }}
        >
          <Field label="Correction reason" hint="Every correction is written to the result history.">
            <textarea className="tl-textarea" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} required />
          </Field>
          <div className={styles.formActions}>
            <button type="submit" className="tl-btn tl-btn-danger" disabled={pending !== null || !reason.trim()}>Apply correction</button>
            <button type="button" className="tl-btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className={styles.formActions}>
          <button type="button" className="tl-btn tl-btn-sm" onClick={() => setOpen(true)}>Correct result</button>
          <span className={styles.muted}>Corrections require a reason and keep the previous version in history.</span>
        </div>
      )}
    </div>
  );
}

function OfficialsPanel({
  matchId,
  competitionId,
  canAssign,
  currentUserId,
  onChanged,
  run,
  pending,
}: {
  matchId: string;
  competitionId: string;
  canAssign: boolean;
  currentUserId: string | null;
  onChanged: () => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  pending: string | null;
}) {
  const queryClient = useQueryClient();
  const officialsQ = useQuery({
    queryKey: ['admin-officials', matchId],
    queryFn: () => matchesApi.officials(matchId),
  });
  const candidatesQ = useQuery({
    queryKey: ['admin-official-users', competitionId],
    queryFn: () => usersApi.list({ role: 'match_official', competitionId, limit: 50 }),
    enabled: canAssign,
  });
  const [selected, setSelected] = useState('');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-officials', matchId] });
    onChanged();
  };

  const assigned = new Set((officialsQ.data ?? []).map((entry) => entry.userId));
  const candidates = (candidatesQ.data?.items ?? []).filter(
    (candidate) => candidate.isActive && candidate.id !== currentUserId && !assigned.has(candidate.id),
  );

  return (
    <div className={styles.detail}>
      <h4><Flag size={15} aria-hidden /> Match officials</h4>
      {officialsQ.isLoading ? <p className={styles.muted}>Loading officials…</p> : officialsQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load the officials.</p>
      ) : (officialsQ.data ?? []).length === 0 ? (
        <p className={styles.muted}>No official is assigned to this match.</p>
      ) : (
        <ul className={styles.list}>
          {officialsQ.data!.map((official) => (
            <li key={official.userId} className={styles.entryRow}>
              <div className={styles.entryMain}>
                <strong>{official.displayName}</strong>
                <span className={styles.muted}>{statusLabel(official.role)} · assigned {formatDateTime(official.assignedAt, DISPLAY_TIME_ZONE)}</span>
              </div>
              {canAssign ? (
                <button
                  type="button"
                  className="tl-btn tl-btn-sm tl-btn-danger"
                  disabled={pending !== null}
                  onClick={() => void run(`remove-official:${matchId}:${official.userId}`, async () => {
                    await matchesApi.removeOfficial(matchId, official.userId);
                    invalidate();
                    return `${official.displayName} removed from the match.`;
                  })}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canAssign ? (
        <form
          className={styles.inlineForm}
          onSubmit={(event) => {
            event.preventDefault();
            void run(`assign-official:${matchId}`, async () => {
              await matchesApi.assignOfficial(matchId, selected);
              setSelected('');
              invalidate();
              return 'Official assigned.';
            });
          }}
        >
          <Field label="Assign an official">
            <select className="tl-select" value={selected} onChange={(event) => setSelected(event.target.value)} required>
              <option value="">Select a match official</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.email}</option>
              ))}
            </select>
          </Field>
          <button type="submit" className="tl-btn" disabled={pending !== null || !selected}>Assign</button>
        </form>
      ) : null}
    </div>
  );
}

/* ------------------------------- standings ------------------------------- */

function StandingsPanel({ competitionId, seasonId }: { competitionId: string; seasonId: string }) {
  const { canIn } = useAuth();
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const canManage = canIn('standings.manage', competitionId);
  const [groupId, setGroupId] = useState('');
  const [reason, setReason] = useState('');

  const groupsQ = useQuery({
    queryKey: ['admin-groups', seasonId],
    queryFn: () => competitionsApi.groups(seasonId),
  });
  const groups = groupsQ.data ?? [];
  // A grouped season has no whole-season table. Default to the first group
  // instead of issuing a request the backend must reject with 400.
  const selectedGroupId = groupId || groups[0]?.id || '';
  const groupReady = !groupsQ.isLoading && (groups.length === 0 || Boolean(selectedGroupId));
  const standingsQ = useQuery({
    queryKey: ['admin-standings', seasonId, selectedGroupId],
    queryFn: () => standingsApi.get({ seasonId, groupId: selectedGroupId || undefined }),
    enabled: groupReady,
  });
  const snapshotsQ = useQuery({
    queryKey: ['admin-standings-snapshots', seasonId, selectedGroupId],
    queryFn: () => standingsApi.snapshots({ seasonId, groupId: selectedGroupId || undefined, limit: 10 }),
    enabled: groupReady,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-standings', seasonId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-standings-snapshots', seasonId] });
    void queryClient.invalidateQueries({ queryKey: ['standings'] });
  };

  const standings = standingsQ.data;

  return (
    <>
      <h3 className={styles.subheading}><Trophy size={16} aria-hidden /> Standings</h3>
      <Feedback error={action.error} notice={action.notice} />

      <div className={styles.filterRow}>
        <Field label="Group">
          <select
            className="tl-select"
            value={selectedGroupId}
            onChange={(event) => setGroupId(event.target.value)}
            disabled={groupsQ.isLoading}
          >
            {groupsQ.isLoading ? <option value="">Loading groups…</option> : groups.length === 0 ? (
              <option value="">Whole season</option>
            ) : groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </Field>
      </div>

      {groupsQ.isLoading || standingsQ.isLoading ? <p className={styles.muted}>Loading standings…</p> : standingsQ.isError || !standings ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load standings.</p>
      ) : (
        <StandingsTable standings={standings} />
      )}

      {standings ? (
        <p className={styles.muted}>
          Live calculation uses {standings.meta.points.win} points for a win and {standings.meta.points.draw} for a draw.{' '}
          {standings.snapshot
            ? `Current snapshot version ${standings.snapshot.version}, calculated ${formatDateTime(standings.snapshot.calculatedAt, DISPLAY_TIME_ZONE)}${standings.snapshot.stale ? ' (stale)' : ''}.`
            : 'No snapshot has been published for this scope.'}
        </p>
      ) : null}

      {canManage ? (
        <div className={styles.form}>
          <h4>Publish a standings snapshot</h4>
          <p className={styles.muted}>
            A snapshot freezes the current live calculation. Recalculating advances the snapshot version and requires a reason.
          </p>
          <Field label="Reason (required to recalculate)">
            <input className="tl-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
          </Field>
          <div className={styles.formActions}>
            <button
              type="button"
              className="tl-btn tl-btn-primary"
              disabled={action.pending !== null}
              onClick={() => void action.run('publish-snapshot', async () => {
                const snapshot = await standingsApi.snapshot({ seasonId, groupId: selectedGroupId || null, reason: reason.trim() || undefined });
                invalidate();
                setReason('');
                return `Snapshot version ${snapshot.version} published.`;
              })}
            >
              Publish snapshot
            </button>
            <button
              type="button"
              className="tl-btn"
              disabled={action.pending !== null || !reason.trim()}
              onClick={() => void action.run('recalculate-standings', async () => {
                const snapshot = await standingsApi.recalculate({ seasonId, groupId: selectedGroupId || null, reason: reason.trim() });
                invalidate();
                setReason('');
                return `Standings recalculated as snapshot version ${snapshot.version}.`;
              })}
            >
              Recalculate
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.muted}>Publishing snapshots requires the standings manage permission.</p>
      )}

      <h4>Recent snapshots</h4>
      {groupsQ.isLoading || snapshotsQ.isLoading ? <p className={styles.muted}>Loading snapshots…</p> : snapshotsQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load snapshot history.</p>
      ) : (snapshotsQ.data?.items ?? []).length === 0 ? (
        <p className={styles.muted}>No snapshots have been published for this scope.</p>
      ) : (
        <ul className={styles.list}>
          {snapshotsQ.data!.items.map((snapshot) => (
            <li key={snapshot.id} className={styles.entryRow}>
              <div className={styles.entryMain}>
                <strong>Version {snapshot.version}{snapshot.isCurrent ? ' · current' : ''}</strong>
                <span className={styles.muted}>
                  {formatDateTime(snapshot.calculatedAt, DISPLAY_TIME_ZONE)} · {snapshot.rows.length} teams
                  {snapshot.stale ? ' · stale' : ''}
                </span>
              </div>
              {snapshot.isCurrent ? <span className="tl-badge">Current</span> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function StandingsTable({ standings }: { standings: StandingsDto }) {
  if (standings.rows.length === 0) {
    return <p className={styles.muted}>No confirmed results contribute to this table yet.</p>;
  }
  return (
    <div className="tl-scroll">
      <table className="tl-table">
        <caption className="sr-only">Standings</caption>
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Team</th>
            <th scope="col" className="num">P</th>
            <th scope="col" className="num">W</th>
            <th scope="col" className="num">D</th>
            <th scope="col" className="num">L</th>
            <th scope="col" className="num">GF</th>
            <th scope="col" className="num">GA</th>
            <th scope="col" className="num">GD</th>
            <th scope="col" className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.rows.map((row) => (
            <tr key={row.teamRegistrationId}>
              <td className="num">{row.position}</td>
              <th scope="row">{row.teamName}</th>
              <td className="num">{row.played}</td>
              <td className="num">{row.won}</td>
              <td className="num">{row.drawn}</td>
              <td className="num">{row.lost}</td>
              <td className="num">{row.goalsFor}</td>
              <td className="num">{row.goalsAgainst}</td>
              <td className="num">{row.goalDifference}</td>
              <td className="num">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
