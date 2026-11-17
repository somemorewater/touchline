'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FilePlus2, Gavel, Plus, Scale, Trash2 } from 'lucide-react';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  disciplinaryApi,
  disputesApi,
  filesApi,
  fixturesApi,
  registrationsApi,
  teamsApi,
  usersApi,
} from '@/lib/api/endpoints';
import type {
  EvidenceDto,
  FixtureDto,
  PlayerRegistrationDto,
  TeamListEntryDto,
  UserDto,
} from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { DISPLAY_TIME_ZONE } from '@/types';
import { AdminSection, Feedback, Field, statusLabel, useAdminAction } from './ui';
import styles from './Admin.module.css';

const CASE_STATUSES = ['open', 'under_review', 'awaiting_response', 'decided', 'appealed', 'closed'];
const CASE_SUBJECTS = ['player', 'team', 'official', 'match'];
const ORIGIN_TYPES = ['match_event', 'referee_report', 'competition_administration', 'other'];
const SANCTION_TYPES = ['warning', 'match_suspension', 'competition_suspension', 'other'];
const DISPUTE_STATUSES = ['draft', 'submitted', 'under_review', 'awaiting_information', 'decided', 'closed'];
const DISPUTE_SUBJECTS = [
  'match_result',
  'match_event',
  'player_eligibility',
  'team_participation',
  'competition_decision',
  'other',
];
const DISPUTE_OUTCOMES = ['accepted', 'rejected', 'partially_accepted', 'no_action'];

export function AdminGovernance() {
  const { competition, season } = useActiveCompetition();
  const { can, canIn } = useAuth();

  if (!competition) {
    return (
      <AdminSection title="Cases, disputes and notices">
        <p className={styles.muted}>Select a competition to review disciplinary cases and disputes.</p>
      </AdminSection>
    );
  }

  const canHere = (permission: string) =>
    can(permission) || canIn(permission, competition.id);

  return (
    <AdminSection
      title="Cases, disputes and notices"
      description={`${competition.name}${season ? ` · ${season.label}` : ''}. Reviewer-only entries are filtered by the server before they reach this page.`}
    >
      {canHere('disciplinary.manage') ? (
        <DisciplinaryPanel competitionId={competition.id} seasonId={season?.id} />
      ) : (
        <p className={styles.muted}>Disciplinary case management requires the disciplinary manage permission.</p>
      )}
      <div className={styles.divider} />
      {canHere('disputes.manage') ? (
        <DisputesPanel competitionId={competition.id} seasonId={season?.id} />
      ) : (
        <p className={styles.muted}>Dispute management requires the disputes manage permission.</p>
      )}
    </AdminSection>
  );
}

/* ----------------------------- shared data ------------------------------- */

function useReferenceData(competitionId: string, seasonId?: string) {
  const registrationsQ = useQuery({
    queryKey: ['admin-reference-registrations', seasonId],
    queryFn: () => registrationsApi.list({ seasonId: seasonId!, status: 'approved' }),
    enabled: Boolean(seasonId),
  });
  const entriesQ = useQuery({
    queryKey: ['admin-reference-entries', seasonId],
    queryFn: () => teamsApi.entries(seasonId!),
    enabled: Boolean(seasonId),
  });
  const usersQ = useQuery({
    queryKey: ['admin-reference-users', competitionId],
    queryFn: () => usersApi.list({ competitionId, limit: 100 }),
  });
  const fixturesQ = useQuery({
    queryKey: ['admin-reference-fixtures', seasonId],
    queryFn: () => fixturesApi.list({ seasonId: seasonId! }),
    enabled: Boolean(seasonId),
  });
  return {
    registrations: (registrationsQ.data ?? []) as PlayerRegistrationDto[],
    entries: (entriesQ.data ?? []) as TeamListEntryDto[],
    users: (usersQ.data?.items ?? []) as UserDto[],
    fixtures: (fixturesQ.data ?? []) as FixtureDto[],
  };
}

function ReferenceSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  placeholder: string;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <select className="tl-select" value={value} onChange={(event) => onChange(event.target.value)} required={required}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </Field>
  );
}

/* ---------------------------- disciplinary ------------------------------- */

function DisciplinaryPanel({ competitionId, seasonId }: { competitionId: string; seasonId?: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [subjectType, setSubjectType] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['admin-cases', competitionId, seasonId, status, subjectType],
    queryFn: () => disciplinaryApi.list({
      competitionId,
      seasonId,
      status: status || undefined,
      subjectType: subjectType || undefined,
      limit: 50,
    }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-cases'] });
    if (selected) void queryClient.invalidateQueries({ queryKey: ['admin-case', selected] });
  };

  return (
    <>
      <h3 className={styles.subheading}><Gavel size={16} aria-hidden /> Disciplinary cases</h3>
      <div className={styles.filterRow}>
        <Field label="Status">
          <select className="tl-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any status</option>
            {CASE_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </Field>
        <Field label="Subject">
          <select className="tl-select" value={subjectType} onChange={(event) => setSubjectType(event.target.value)}>
            <option value="">Any subject</option>
            {CASE_SUBJECTS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </Field>
      </div>

      {q.isLoading ? <p className={styles.muted}>Loading cases…</p> : q.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load disciplinary cases.</p>
      ) : (q.data?.items ?? []).length === 0 ? (
        <p className={styles.muted}>No disciplinary cases match this filter.</p>
      ) : (
        <div className={styles.list}>
          {q.data!.items.map((entry) => (
            <div key={entry.id} className={styles.entryRow}>
              <div className={styles.entryMain}>
                <strong>{entry.title}</strong>
                <span className={styles.muted}>
                  {statusLabel(entry.subjectType)} · {statusLabel(entry.status)} · opened {formatDateTime(entry.openedAt, DISPLAY_TIME_ZONE)}
                </span>
              </div>
              <div className={styles.rowActions}>
                <span className="tl-badge">{statusLabel(entry.status)}</span>
                <button
                  type="button"
                  className="tl-btn tl-btn-sm"
                  onClick={() => setSelected(selected === entry.id ? null : entry.id)}
                  aria-expanded={selected === entry.id}
                >
                  {selected === entry.id ? 'Close' : 'Open'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected ? (
        <DisciplinaryDetail
          key={selected}
          caseId={selected}
          competitionId={competitionId}
          onChanged={invalidate}
        />
      ) : null}

      <CreateCaseForm competitionId={competitionId} seasonId={seasonId} onCreated={invalidate} />
    </>
  );
}

function DisciplinaryDetail({
  caseId,
  competitionId,
  onChanged,
}: {
  caseId: string;
  competitionId: string;
  onChanged: () => void;
}) {
  const { can, canIn } = useAuth();
  const action = useAdminAction();
  const canManage = can('disciplinary.manage') || canIn('disciplinary.manage', competitionId);
  const caseQ = useQuery({ queryKey: ['admin-case', caseId], queryFn: () => disciplinaryApi.get(caseId) });
  const historyQ = useQuery({
    queryKey: ['admin-case-history', caseId],
    queryFn: () => disciplinaryApi.history(caseId),
    enabled: Boolean(caseQ.data),
  });
  const reviewersQ = useQuery({
    queryKey: ['admin-reviewers', competitionId],
    queryFn: () => usersApi.list({ competitionId, role: 'competition_admin', limit: 50 }),
  });

  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('');
  const [finding, setFinding] = useState('');
  const [note, setNote] = useState('');
  const [internal, setInternal] = useState(true);
  const [response, setResponse] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [sanctionType, setSanctionType] = useState('warning');
  const [sanctionReason, setSanctionReason] = useState('');
  const [matchesCount, setMatchesCount] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const invalidate = () => {
    void caseQ.refetch();
    void historyQ.refetch();
    onChanged();
  };

  if (caseQ.isLoading) return <p className={styles.muted}>Loading case…</p>;
  if (caseQ.isError || !caseQ.data) {
    return <p className="tl-alert tl-alert-error" role="alert">Could not load this disciplinary case.</p>;
  }

  const record = caseQ.data;
  const status = record.status;
  const sanctionable = Boolean(
    record.subjectPlayerRegistrationId || record.subjectUserId || record.subjectTeamRegistrationId,
  );
  const suspension = sanctionType === 'match_suspension' || sanctionType === 'competition_suspension';
  const sanctionValid =
    sanctionReason.trim().length >= 3 && (!suspension || Boolean(matchesCount) || Boolean(endsAt));

  return (
    <div className={styles.detail}>
      <header className={styles.cardHead}>
        <div>
          <h3>{record.title}</h3>
          <p className={styles.muted}>
            {statusLabel(record.subjectType)} · {statusLabel(status)} · origin {statusLabel(record.originType)}
            {record.assignedReviewerId ? ` · reviewer ${record.assignedReviewerId}` : ' · no reviewer assigned'}
          </p>
        </div>
        <span className="tl-badge">{statusLabel(status)}</span>
      </header>

      <p className={styles.pre}>{record.description}</p>
      <Feedback error={action.error} notice={action.notice} />

      <h4>Entries returned by the server</h4>
      {(record.entries ?? []).length === 0 ? (
        <p className={styles.muted}>No entries are visible to your account for this case.</p>
      ) : (
        <ul className={styles.list}>
          {record.entries!.map((entry) => {
            const isInternal = entry.metadata?.isInternal === true;
            return (
              <li key={entry.id} className={`${styles.entry} ${isInternal ? styles.entryInternal : ''}`}>
                <div className={styles.entryHead}>
                  <strong>{statusLabel(entry.entryType)}{isInternal ? ' · reviewer-only' : ''}</strong>
                  <span>{formatDateTime(entry.createdAt, DISPLAY_TIME_ZONE)}</span>
                </div>
                {entry.body ? <p className={styles.pre}>{entry.body}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      <h4>Sanctions</h4>
      {(record.sanctions ?? []).length === 0 ? (
        <p className={styles.muted}>No sanctions recorded.</p>
      ) : (
        <ul className={styles.list}>
          {record.sanctions!.map((sanction) => (
            <li key={sanction.id} className={styles.entry}>
              <div className={styles.entryHead}>
                <strong>{statusLabel(sanction.sanctionType)}</strong>
                <span>{formatDateTime(sanction.createdAt, DISPLAY_TIME_ZONE)}</span>
              </div>
              <p className={styles.pre}>{sanction.reason}</p>
              <p className={styles.muted}>
                {sanction.matchesCount ? `${sanction.matchesCount} match(es)` : 'No match count'}
                {sanction.startsAt ? ` · starts ${formatDateTime(sanction.startsAt, DISPLAY_TIME_ZONE)}` : ''}
                {sanction.endsAt ? ` · ends ${formatDateTime(sanction.endsAt, DISPLAY_TIME_ZONE)}` : ''}
                {sanction.liftedAt ? ` · lifted ${formatDateTime(sanction.liftedAt, DISPLAY_TIME_ZONE)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="tl-stack">
          <div className={styles.form}>
            <h4>Reviewer</h4>
            <form
              className={styles.inlineForm}
              onSubmit={(event) => {
                event.preventDefault();
                void action.run('assign-reviewer', async () => {
                  await disciplinaryApi.assignReviewer(caseId, reviewerId, reason.trim() || null);
                  setReviewerId('');
                  invalidate();
                  return 'Reviewer assigned.';
                });
              }}
            >
              <ReferenceSelect
                label="Assign reviewer"
                value={reviewerId}
                onChange={setReviewerId}
                placeholder="Select an administrator"
                options={(reviewersQ.data?.items ?? []).map((user) => ({ id: user.id, label: `${user.displayName} · ${user.email}` }))}
                required
              />
              <button type="submit" className="tl-btn" disabled={action.pending !== null || !reviewerId}>Assign</button>
            </form>
          </div>

          <div className={styles.form}>
            <h4>Workflow actions</h4>
            <Field label="Reason or decision note">
              <textarea className="tl-textarea" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
            </Field>
            <div className={styles.formActions}>
              {['open', 'awaiting_response', 'appealed'].includes(status) ? (
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null}
                  onClick={() => void action.run('start-review', async () => {
                    await disciplinaryApi.review(caseId, reason.trim() || null);
                    setReason('');
                    invalidate();
                    return 'Case moved under review.';
                  })}
                >
                  Start review
                </button>
              ) : null}
              {status === 'under_review' ? (
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null || reason.trim().length < 3}
                  onClick={() => void action.run('request-response', async () => {
                    await disciplinaryApi.requestResponse(caseId, reason.trim());
                    setReason('');
                    invalidate();
                    return 'Response requested.';
                  })}
                >
                  Request response
                </button>
              ) : null}
              {['under_review', 'awaiting_response'].includes(status) ? (
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null}
                  onClick={() => void action.run('add-finding', async () => {
                    await disciplinaryApi.addFindings(caseId, finding.trim());
                    setFinding('');
                    invalidate();
                    return 'Finding recorded.';
                  })}
                >
                  Add finding
                </button>
              ) : null}
              {['decided', 'appealed'].includes(status) ? (
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null || reason.trim().length < 3}
                  onClick={() => void action.run('close-case', async () => {
                    await disciplinaryApi.close(caseId, reason.trim());
                    setReason('');
                    invalidate();
                    return 'Case closed.';
                  })}
                >
                  Close case
                </button>
              ) : null}
              {status === 'decided' ? (
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null || reason.trim().length < 3}
                  onClick={() => void action.run('appeal-case', async () => {
                    await disciplinaryApi.appeal(caseId, reason.trim());
                    setReason('');
                    invalidate();
                    return 'Appeal recorded.';
                  })}
                >
                  Record appeal
                </button>
              ) : null}
            </div>
            {['under_review', 'awaiting_response'].includes(status) ? (
              <Field label="Finding body">
                <textarea className="tl-textarea" value={finding} onChange={(event) => setFinding(event.target.value)} maxLength={10000} />
              </Field>
            ) : null}
          </div>

          {['under_review', 'awaiting_response'].includes(status) ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void action.run('decide-case', async () => {
                  await disciplinaryApi.decide(caseId, decision.trim(), reason.trim() || null);
                  setDecision('');
                  setReason('');
                  invalidate();
                  return 'Decision recorded.';
                });
              }}
            >
              <h4>Decision</h4>
              <Field label="Decision">
                <textarea className="tl-textarea" value={decision} onChange={(event) => setDecision(event.target.value)} minLength={3} maxLength={10000} required />
              </Field>
              <div className={styles.formActions}>
                <button type="submit" className="tl-btn tl-btn-primary" disabled={action.pending !== null || decision.trim().length < 3}>
                  Record decision
                </button>
              </div>
            </form>
          ) : null}

          <div className={styles.form}>
            <h4>Notes and responses</h4>
            <Field label="Note">
              <textarea className="tl-textarea" value={note} onChange={(event) => setNote(event.target.value)} maxLength={10000} />
            </Field>
            <label className="tl-check">
              <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
              <span>Reviewer-only note. The server omits it from responses to everyone who cannot review this case.</span>
            </label>
            <div className={styles.formActions}>
              <button
                type="button"
                className="tl-btn"
                disabled={action.pending !== null || note.trim().length === 0}
                onClick={() => void action.run('add-note', async () => {
                  await disciplinaryApi.addNote(caseId, note.trim(), internal);
                  setNote('');
                  invalidate();
                  return 'Note added.';
                })}
              >
                Add note
              </button>
            </div>
            <Field label="Response body">
              <textarea className="tl-textarea" value={response} onChange={(event) => setResponse(event.target.value)} maxLength={10000} />
            </Field>
            <div className={styles.formActions}>
              <button
                type="button"
                className="tl-btn"
                disabled={action.pending !== null || response.trim().length === 0}
                onClick={() => void action.run('add-response', async () => {
                  await disciplinaryApi.addResponse(caseId, response.trim());
                  setResponse('');
                  invalidate();
                  return 'Response added.';
                })}
              >
                Add response
              </button>
            </div>
          </div>

          {sanctionable ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void action.run('add-sanction', async () => {
                await disciplinaryApi.addSanction(caseId, {
                  subjectType: record.subjectType === 'match' || record.subjectType === 'other' ? 'other' : record.subjectType,
                  subjectPlayerRegistrationId: record.subjectPlayerRegistrationId,
                  subjectUserId: record.subjectUserId,
                  subjectTeamRegistrationId: record.subjectTeamRegistrationId,
                  sanctionType,
                  reason: sanctionReason.trim(),
                  matchesCount: matchesCount ? Number(matchesCount) : null,
                  startsAt: startsAt ? new Date(startsAt).toISOString() : null,
                  endsAt: endsAt ? new Date(endsAt).toISOString() : null,
                });
                setSanctionReason('');
                setMatchesCount('');
                setStartsAt('');
                setEndsAt('');
                invalidate();
                return 'Sanction recorded.';
              });
            }}
          >
            <h4>Add a sanction</h4>
            <div className={styles.formGrid}>
              <Field label="Type">
                <select className="tl-select" value={sanctionType} onChange={(event) => setSanctionType(event.target.value)}>
                  {SANCTION_TYPES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
                </select>
              </Field>
              <Field label="Matches (for suspension)">
                <input className="tl-input" type="number" min={1} max={200} value={matchesCount} onChange={(event) => setMatchesCount(event.target.value)} />
              </Field>
              <Field label="Starts at">
                <input className="tl-input" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
              </Field>
              <Field label="Ends at">
                <input className="tl-input" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
              </Field>
            </div>
            <Field label="Sanction reason">
              <textarea className="tl-textarea" value={sanctionReason} onChange={(event) => setSanctionReason(event.target.value)} maxLength={5000} required />
            </Field>
            <div className={styles.formActions}>
              <button type="submit" className="tl-btn tl-btn-primary" disabled={action.pending !== null || !sanctionValid}>
                Add sanction
              </button>
              {suspension && !matchesCount && !endsAt ? (
                <span className={styles.muted}>A suspension needs a match count or an end date.</span>
              ) : null}
            </div>
          </form>
          ) : (
            <p className={styles.muted}>
              A sanction must name a player, user or team. This case has no such subject recorded.
            </p>
          )}
        </div>
      ) : null}

      <EvidencePanel kind="case" id={caseId} onChanged={invalidate} />

      <details className={styles.detailsBlock}>
        <summary>Case history</summary>
        {historyQ.isLoading ? <p className={styles.muted}>Loading history…</p> : historyQ.isError ? (
          <p className={styles.muted}>History is not available.</p>
        ) : (historyQ.data ?? []).length === 0 ? (
          <p className={styles.muted}>No history entries.</p>
        ) : (
          <ul className={styles.list}>
            {historyQ.data!.map((entry) => (
              <li key={entry.id} className={styles.entry}>
                <div className={styles.entryHead}>
                  <strong>{statusLabel(entry.action.replaceAll('.', ' '))}</strong>
                  <span>{formatDateTime(entry.createdAt, DISPLAY_TIME_ZONE)}</span>
                </div>
                {entry.reason ? <p className={styles.pre}>{entry.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function CreateCaseForm({
  competitionId,
  seasonId,
  onCreated,
}: {
  competitionId: string;
  seasonId?: string;
  onCreated: () => void;
}) {
  const action = useAdminAction();
  const data = useReferenceData(competitionId, seasonId);
  const [open, setOpen] = useState(false);
  const [subjectType, setSubjectType] = useState('player');
  const [subjectId, setSubjectId] = useState('');
  const [originType, setOriginType] = useState('competition_administration');
  const [originMatchId, setOriginMatchId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  if (!open) {
    return (
      <div className={styles.formActions}>
        <button type="button" className="tl-btn" onClick={() => setOpen(true)}>
          <Plus size={15} aria-hidden /> Open a disciplinary case
        </button>
      </div>
    );
  }

  const subjectOptions = subjectType === 'player'
    ? data.registrations.map((entry) => ({ id: entry.id, label: `${entry.player.fullName} · ${entry.team.name}` }))
    : subjectType === 'team'
      ? data.entries.map((entry) => ({ id: entry.registration.id, label: entry.team.name }))
      : subjectType === 'official'
        ? data.users.map((user) => ({ id: user.id, label: `${user.displayName} · ${user.email}` }))
        : data.fixtures.filter((fixture) => fixture.match).map((fixture) => ({
            id: fixture.id,
            label: `${fixture.homeTeam.name} v ${fixture.awayTeam.name}${fixture.scheduledAt ? ` · ${formatDateTime(fixture.scheduledAt, DISPLAY_TIME_ZONE)}` : ''}`,
          }));

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run('create-case', async () => {
          const matchFixture = data.fixtures.find((fixture) => fixture.id === originMatchId);
          const subjectMatch = data.fixtures.find((fixture) => fixture.id === subjectId);
          await disciplinaryApi.create({
            competitionId,
            seasonId: seasonId ?? null,
            subjectType,
            subjectPlayerRegistrationId: subjectType === 'player' ? subjectId : null,
            subjectTeamRegistrationId: subjectType === 'team' ? subjectId : null,
            subjectUserId: subjectType === 'official' ? subjectId : null,
            originType,
            originMatchId: subjectType === 'match'
              ? subjectMatch?.match?.id ?? null
              : (originType === 'match_event' || originType === 'referee_report'
                ? (originMatchId ? matchFixture?.match?.id ?? null : null)
                : null),
            title: title.trim(),
            description: description.trim(),
          });
          setTitle('');
          setDescription('');
          setSubjectId('');
          setOriginMatchId('');
          setOpen(false);
          onCreated();
          return 'Disciplinary case opened.';
        });
      }}
    >
      <h4>Open a disciplinary case</h4>
      <Feedback error={action.error} notice={action.notice} />
      <div className={styles.formGrid}>
        <Field label="Subject type">
          <select className="tl-select" value={subjectType} onChange={(event) => { setSubjectType(event.target.value); setSubjectId(''); }}>
            {CASE_SUBJECTS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </Field>
        {subjectType === 'match' ? (
          <ReferenceSelect
            label="Match"
            value={subjectId}
            onChange={setSubjectId}
            placeholder="Select a match"
            options={subjectOptions}
            required
          />
        ) : (
          <ReferenceSelect
            label={`Subject ${subjectType}`}
            value={subjectId}
            onChange={setSubjectId}
            placeholder={subjectOptions.length ? 'Select a subject' : 'No reference data available'}
            options={subjectOptions}
            required
          />
        )}
        <Field label="Origin">
          <select className="tl-select" value={originType} onChange={(event) => setOriginType(event.target.value)}>
            {ORIGIN_TYPES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </Field>
        {originType === 'match_event' || originType === 'referee_report' ? (
          <ReferenceSelect
            label="Originating match"
            value={originMatchId}
            onChange={setOriginMatchId}
            placeholder="Select a match"
            options={data.fixtures.filter((fixture) => fixture.match).map((fixture) => ({
              id: fixture.id,
              label: `${fixture.homeTeam.name} v ${fixture.awayTeam.name}`,
            }))}
            required
          />
        ) : null}
      </div>
      <Field label="Title">
        <input className="tl-input" value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={200} required />
      </Field>
      <Field label="Description">
        <textarea className="tl-textarea" value={description} onChange={(event) => setDescription(event.target.value)} minLength={3} maxLength={10000} required />
      </Field>
      <div className={styles.formActions}>
        <button type="submit" className="tl-btn tl-btn-primary" disabled={action.pending !== null || !subjectId || title.trim().length < 3 || description.trim().length < 3}>
          Open case
        </button>
        <button type="button" className="tl-btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/* ------------------------------- disputes -------------------------------- */

function DisputesPanel({ competitionId, seasonId }: { competitionId: string; seasonId?: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [subjectType, setSubjectType] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['admin-disputes', competitionId, seasonId, status, subjectType],
    queryFn: () => disputesApi.list({
      competitionId,
      seasonId,
      status: status || undefined,
      subjectType: subjectType || undefined,
      limit: 50,
    }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-disputes'] });
    if (selected) void queryClient.invalidateQueries({ queryKey: ['admin-dispute', selected] });
  };

  return (
    <>
      <h3 className={styles.subheading}><Scale size={16} aria-hidden /> Disputes</h3>
      <div className={styles.filterRow}>
        <Field label="Status">
          <select className="tl-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any status</option>
            {DISPUTE_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </Field>
        <Field label="Subject">
          <select className="tl-select" value={subjectType} onChange={(event) => setSubjectType(event.target.value)}>
            <option value="">Any subject</option>
            {DISPUTE_SUBJECTS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </Field>
      </div>

      {q.isLoading ? <p className={styles.muted}>Loading disputes…</p> : q.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load disputes.</p>
      ) : (q.data?.items ?? []).length === 0 ? (
        <p className={styles.muted}>No disputes match this filter.</p>
      ) : (
        <div className={styles.list}>
          {q.data!.items.map((entry) => (
            <div key={entry.id} className={styles.entryRow}>
              <div className={styles.entryMain}>
                <strong>{entry.title}</strong>
                <span className={styles.muted}>
                  {statusLabel(entry.subjectType)} · {statusLabel(entry.status)} · created {formatDateTime(entry.createdAt, DISPLAY_TIME_ZONE)}
                </span>
              </div>
              <div className={styles.rowActions}>
                <span className="tl-badge">{statusLabel(entry.status)}</span>
                <button
                  type="button"
                  className="tl-btn tl-btn-sm"
                  onClick={() => setSelected(selected === entry.id ? null : entry.id)}
                  aria-expanded={selected === entry.id}
                >
                  {selected === entry.id ? 'Close' : 'Open'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected ? <DisputeDetail key={selected} disputeId={selected} competitionId={competitionId} onChanged={invalidate} /> : null}

      <CreateDisputeForm competitionId={competitionId} seasonId={seasonId} onCreated={invalidate} />
    </>
  );
}

function DisputeDetail({
  disputeId,
  competitionId,
  onChanged,
}: {
  disputeId: string;
  competitionId: string;
  onChanged: () => void;
}) {
  const { can, canIn } = useAuth();
  const action = useAdminAction();
  const canManage = can('disputes.manage') || canIn('disputes.manage', competitionId);
  const disputeQ = useQuery({ queryKey: ['admin-dispute', disputeId], queryFn: () => disputesApi.get(disputeId) });
  const historyQ = useQuery({
    queryKey: ['admin-dispute-history', disputeId],
    queryFn: () => disputesApi.history(disputeId),
    enabled: Boolean(disputeQ.data),
  });
  const reviewersQ = useQuery({
    queryKey: ['admin-reviewers', competitionId],
    queryFn: () => usersApi.list({ competitionId, role: 'competition_admin', limit: 50 }),
  });

  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('');
  const [outcome, setOutcome] = useState('accepted');
  const [response, setResponse] = useState('');
  const [internal, setInternal] = useState(false);
  const [information, setInformation] = useState('');
  const [reviewerId, setReviewerId] = useState('');

  const invalidate = () => {
    void disputeQ.refetch();
    void historyQ.refetch();
    onChanged();
  };

  if (disputeQ.isLoading) return <p className={styles.muted}>Loading dispute…</p>;
  if (disputeQ.isError || !disputeQ.data) {
    return <p className="tl-alert tl-alert-error" role="alert">Could not load this dispute.</p>;
  }

  const record = disputeQ.data;
  const status = record.status;

  return (
    <div className={styles.detail}>
      <header className={styles.cardHead}>
        <div>
          <h3>{record.title}</h3>
          <p className={styles.muted}>
            {statusLabel(record.subjectType)} · {statusLabel(status)}
            {record.outcome ? ` · outcome ${statusLabel(record.outcome)}` : ''}
            {record.assignedReviewerId ? ` · reviewer ${record.assignedReviewerId}` : ' · no reviewer assigned'}
          </p>
        </div>
        <span className="tl-badge">{statusLabel(status)}</span>
      </header>

      <p className={styles.pre}>{record.description}</p>
      {record.decision ? <p className="tl-alert tl-alert-info">Decision: {record.decision}</p> : null}
      <Feedback error={action.error} notice={action.notice} />

      <h4>Entries returned by the server</h4>
      {(record.entries ?? []).length === 0 ? (
        <p className={styles.muted}>No entries are visible to your account for this dispute.</p>
      ) : (
        <ul className={styles.list}>
          {record.entries!.map((entry) => (
            <li key={entry.id} className={`${styles.entry} ${entry.isInternal ? styles.entryInternal : ''}`}>
              <div className={styles.entryHead}>
                <strong>{statusLabel(entry.entryType)}{entry.isInternal ? ' · reviewer-only' : ''}</strong>
                <span>{formatDateTime(entry.createdAt, DISPLAY_TIME_ZONE)}</span>
              </div>
              {entry.body ? <p className={styles.pre}>{entry.body}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="tl-stack">
          <div className={styles.form}>
            <h4>Reviewer</h4>
            <form
              className={styles.inlineForm}
              onSubmit={(event) => {
                event.preventDefault();
                void action.run('assign-dispute-reviewer', async () => {
                  await disputesApi.assignReviewer(disputeId, reviewerId, reason.trim() || null);
                  setReviewerId('');
                  invalidate();
                  return 'Reviewer assigned.';
                });
              }}
            >
              <ReferenceSelect
                label="Assign reviewer"
                value={reviewerId}
                onChange={setReviewerId}
                placeholder="Select an administrator"
                options={(reviewersQ.data?.items ?? []).map((user) => ({ id: user.id, label: `${user.displayName} · ${user.email}` }))}
                required
              />
              <button type="submit" className="tl-btn" disabled={action.pending !== null || !reviewerId}>Assign</button>
            </form>
          </div>

          <div className={styles.form}>
            <h4>Workflow actions</h4>
            <Field label="Reason">
              <textarea className="tl-textarea" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
            </Field>
            <div className={styles.formActions}>
              {status === 'draft' ? (
                <button
                  type="button"
                  className="tl-btn tl-btn-primary"
                  disabled={action.pending !== null}
                  onClick={() => void action.run('submit-dispute', async () => {
                    await disputesApi.submit(disputeId);
                    invalidate();
                    return 'Dispute submitted.';
                  })}
                >
                  Submit dispute
                </button>
              ) : null}
              {status === 'submitted' ? (
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null}
                  onClick={() => void action.run('review-dispute', async () => {
                    await disputesApi.review(disputeId, reason.trim() || null);
                    setReason('');
                    invalidate();
                    return 'Dispute moved under review.';
                  })}
                >
                  Start review
                </button>
              ) : null}
              {status === 'under_review' ? (
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null || reason.trim().length < 3}
                  onClick={() => void action.run('request-information', async () => {
                    await disputesApi.requestInformation(disputeId, reason.trim());
                    setReason('');
                    invalidate();
                    return 'Information requested.';
                  })}
                >
                  Request information
                </button>
              ) : null}
              {status === 'decided' ? (
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null || reason.trim().length < 3}
                  onClick={() => void action.run('close-dispute', async () => {
                    await disputesApi.close(disputeId, reason.trim());
                    setReason('');
                    invalidate();
                    return 'Dispute closed.';
                  })}
                >
                  Close dispute
                </button>
              ) : null}
            </div>
          </div>

          {['submitted', 'under_review', 'awaiting_information'].includes(status) ? (
            <div className={styles.form}>
              <h4>Responses and information</h4>
              <Field label="Response">
                <textarea className="tl-textarea" value={response} onChange={(event) => setResponse(event.target.value)} maxLength={10000} />
              </Field>
              <label className="tl-check">
                <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
                <span>Reviewer-only response. The server filters it from viewers who cannot review this dispute.</span>
              </label>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null || response.trim().length < 3}
                  onClick={() => void action.run('add-dispute-response', async () => {
                    await disputesApi.addResponse(disputeId, response.trim(), internal);
                    setResponse('');
                    invalidate();
                    return 'Response added.';
                  })}
                >
                  Add response
                </button>
              </div>
              <Field label="Information supplied by the team">
                <textarea className="tl-textarea" value={information} onChange={(event) => setInformation(event.target.value)} maxLength={10000} />
              </Field>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className="tl-btn"
                  disabled={action.pending !== null || information.trim().length < 3}
                  onClick={() => void action.run('add-dispute-information', async () => {
                    await disputesApi.addInformation(disputeId, information.trim());
                    setInformation('');
                    invalidate();
                    return 'Information recorded.';
                  })}
                >
                  Add information
                </button>
              </div>
            </div>
          ) : null}

          {['under_review', 'awaiting_information'].includes(status) ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void action.run('decide-dispute', async () => {
                  await disputesApi.decide(disputeId, outcome, decision.trim(), reason.trim() || null);
                  setDecision('');
                  setReason('');
                  invalidate();
                  return 'Dispute decided.';
                });
              }}
            >
              <h4>Decision</h4>
              <div className={styles.formGrid}>
                <Field label="Outcome">
                  <select className="tl-select" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
                    {DISPUTE_OUTCOMES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Decision">
                <textarea className="tl-textarea" value={decision} onChange={(event) => setDecision(event.target.value)} minLength={3} maxLength={10000} required />
              </Field>
              <p className={styles.muted}>A dispute decision never changes a result by itself; use the result correction action separately.</p>
              <div className={styles.formActions}>
                <button type="submit" className="tl-btn tl-btn-primary" disabled={action.pending !== null || decision.trim().length < 3}>
                  Record decision
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      <EvidencePanel kind="dispute" id={disputeId} onChanged={invalidate} />

      <details className={styles.detailsBlock}>
        <summary>Dispute history</summary>
        {historyQ.isLoading ? <p className={styles.muted}>Loading history…</p> : historyQ.isError ? (
          <p className={styles.muted}>History is not available.</p>
        ) : (historyQ.data ?? []).length === 0 ? (
          <p className={styles.muted}>No history entries.</p>
        ) : (
          <ul className={styles.list}>
            {historyQ.data!.map((entry) => (
              <li key={entry.id} className={styles.entry}>
                <div className={styles.entryHead}>
                  <strong>{statusLabel(entry.action.replaceAll('.', ' '))}</strong>
                  <span>{formatDateTime(entry.createdAt, DISPLAY_TIME_ZONE)}</span>
                </div>
                {entry.reason ? <p className={styles.pre}>{entry.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function CreateDisputeForm({
  competitionId,
  seasonId,
  onCreated,
}: {
  competitionId: string;
  seasonId?: string;
  onCreated: () => void;
}) {
  const action = useAdminAction();
  const data = useReferenceData(competitionId, seasonId);
  const [open, setOpen] = useState(false);
  const [subjectType, setSubjectType] = useState('match_result');
  const [matchId, setMatchId] = useState('');
  const [teamRegistrationId, setTeamRegistrationId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submit, setSubmit] = useState(false);

  if (!open) {
    return (
      <div className={styles.formActions}>
        <button type="button" className="tl-btn" onClick={() => setOpen(true)}>
          <Plus size={15} aria-hidden /> Open a dispute
        </button>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run('create-dispute', async () => {
          await disputesApi.create({
            competitionId,
            seasonId: seasonId ?? null,
            subjectType,
            matchId: ['match_result', 'match_event'].includes(subjectType) ? matchId : null,
            teamRegistrationId: teamRegistrationId || null,
            title: title.trim(),
            description: description.trim(),
            submit,
          });
          setTitle('');
          setDescription('');
          setMatchId('');
          setTeamRegistrationId('');
          setOpen(false);
          onCreated();
          return submit ? 'Dispute submitted.' : 'Dispute saved as a draft.';
        });
      }}
    >
      <h4>Open a dispute</h4>
      <Feedback error={action.error} notice={action.notice} />
      <div className={styles.formGrid}>
        <Field label="Subject type">
          <select className="tl-select" value={subjectType} onChange={(event) => setSubjectType(event.target.value)}>
            {DISPUTE_SUBJECTS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </Field>
        {['match_result', 'match_event'].includes(subjectType) ? (
          <ReferenceSelect
            label="Match"
            value={matchId}
            onChange={setMatchId}
            placeholder="Select a match"
            options={data.fixtures.filter((fixture) => fixture.match).map((fixture) => ({
              id: fixture.match!.id,
              label: `${fixture.homeTeam.name} v ${fixture.awayTeam.name}`,
            }))}
            required
          />
        ) : null}
        {['team_participation', 'player_eligibility'].includes(subjectType) ? (
          <ReferenceSelect
            label="Team entry"
            value={teamRegistrationId}
            onChange={setTeamRegistrationId}
            placeholder="Select a team entry"
            options={data.entries.map((entry) => ({ id: entry.registration.id, label: entry.team.name }))}
          />
        ) : null}
      </div>
      <Field label="Title">
        <input className="tl-input" value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={200} required />
      </Field>
      <Field label="Description">
        <textarea className="tl-textarea" value={description} onChange={(event) => setDescription(event.target.value)} minLength={3} maxLength={10000} required />
      </Field>
      <label className="tl-check">
        <input type="checkbox" checked={submit} onChange={(event) => setSubmit(event.target.checked)} />
        <span>Submit immediately instead of saving a draft.</span>
      </label>
      <div className={styles.formActions}>
        <button
          type="submit"
          className="tl-btn tl-btn-primary"
          disabled={action.pending !== null || title.trim().length < 3 || description.trim().length < 3 || (['match_result', 'match_event'].includes(subjectType) && !matchId)}
        >
          {submit ? 'Submit dispute' : 'Save draft'}
        </button>
        <button type="button" className="tl-btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/* -------------------------------- evidence ------------------------------- */

function EvidencePanel({ kind, id, onChanged }: { kind: 'case' | 'dispute'; id: string; onChanged: () => void }) {
  const action = useAdminAction();
  const queryClient = useQueryClient();
  const key = kind === 'case' ? 'admin-case-evidence' : 'admin-dispute-evidence';
  const q = useQuery({
    queryKey: [key, id],
    queryFn: () => (kind === 'case' ? filesApi.caseEvidence(id) : filesApi.disputeEvidence(id)),
  });
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState('');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [key, id] });
    onChanged();
  };

  const download = async (evidence: EvidenceDto) => {
    try {
      const blob = await filesApi.download(evidence.fileId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = evidence.originalName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      action.setError(cause instanceof Error ? cause.message : 'The file could not be downloaded.');
    }
  };

  return (
    <div className={styles.detail}>
      <h4><FilePlus2 size={15} aria-hidden /> Evidence</h4>
      <Feedback error={action.error} notice={action.notice} />

      {q.isLoading ? <p className={styles.muted}>Loading evidence…</p> : q.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load evidence.</p>
      ) : (q.data ?? []).length === 0 ? (
        <p className={styles.muted}>No evidence files are attached.</p>
      ) : (
        <ul className={styles.list}>
          {q.data!.map((evidence) => (
            <li key={evidence.id} className={styles.entryRow}>
              <div className={styles.entryMain}>
                <strong>{evidence.originalName}</strong>
                <span className={styles.muted}>
                  {evidence.contentType} · {(evidence.sizeBytes / 1024).toFixed(1)} KiB
                  {evidence.removedAt ? ` · removed ${formatDateTime(evidence.removedAt, DISPLAY_TIME_ZONE)}` : ''}
                </span>
              </div>
              <div className={styles.rowActions}>
                <button type="button" className="tl-btn tl-btn-sm" onClick={() => void download(evidence)}>
                  <Download size={13} aria-hidden /> Download
                </button>
                {!evidence.removedAt ? (
                  <button
                    type="button"
                    className="tl-btn tl-btn-sm tl-btn-danger"
                    onClick={() => { setPendingRemove(evidence.id); setRemoveReason(''); }}
                  >
                    <Trash2 size={13} aria-hidden /> Remove
                  </button>
                ) : null}
              </div>
              {pendingRemove === evidence.id ? (
                <form
                  className={`${styles.form} ${styles.fullRow}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action.run(`remove-evidence:${evidence.id}`, async () => {
                      if (kind === 'case') await filesApi.removeCaseEvidence(id, evidence.id, removeReason.trim() || undefined);
                      else await filesApi.removeDisputeEvidence(id, evidence.id, removeReason.trim() || undefined);
                      setPendingRemove(null);
                      setRemoveReason('');
                      invalidate();
                      return 'Evidence removed.';
                    });
                  }}
                >
                  <Field label="Removal reason (optional)">
                    <input className="tl-input" value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} maxLength={2000} />
                  </Field>
                  <div className={styles.formActions}>
                    <button type="submit" className="tl-btn tl-btn-sm tl-btn-danger" disabled={action.pending !== null}>Remove evidence</button>
                    <button type="button" className="tl-btn tl-btn-sm" onClick={() => setPendingRemove(null)}>Cancel</button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Field label="Upload evidence" hint="The file is sent as a raw binary body. Private files are downloaded through the authenticated endpoint.">
        <input
          className="tl-input"
          type="file"
          disabled={action.pending !== null}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void action.run('upload-evidence', async () => {
              if (kind === 'case') await filesApi.uploadCaseEvidence(id, file);
              else await filesApi.uploadDisputeEvidence(id, file);
              invalidate();
              return `${file.name} uploaded.`;
            });
            event.target.value = '';
          }}
        />
      </Field>
    </div>
  );
}
