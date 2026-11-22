'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ClipboardList, Plus, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  competitionsApi,
  registrationsApi,
  teamsApi,
  usersApi,
} from '@/lib/api/endpoints';
import type { GroupDto, PlayerRegistrationDto, PlayerRegistrationHistoryDto, TeamListEntryDto } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { positionLabel } from '@/lib/positions';
import { DISPLAY_TIME_ZONE } from '@/types';
import { AdminSection, Feedback, Field, statusLabel, useAdminAction } from './ui';
import styles from './Admin.module.css';

const REG_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'pending_changes', 'rejected_changes', 'rejected', 'withdrawn'];

export function AdminTeams({ section = 'all' }: { section?: 'teams' | 'players' | 'all' }) {
  const { competition, season } = useActiveCompetition();
  const title = section === 'teams' ? 'Team management' : section === 'players' ? 'Player management' : 'Teams and player registrations';

  if (!competition || !season) {
    return (
      <AdminSection title={title}>
        <p className={styles.muted}>Select a competition and season to manage its teams and registrations.</p>
      </AdminSection>
    );
  }

  return (
    <AdminSection
      title={title}
      description={`${competition.name} · ${season.label}. Access remains limited by the existing team and registration permissions.`}
    >
      {section !== 'players' ? <TeamEntries competitionId={competition.id} seasonId={season.id} /> : null}
      {section === 'all' ? <div className={styles.divider} /> : null}
      {section !== 'teams' ? <PlayerRegistrations seasonId={season.id} competitionId={competition.id} /> : null}
    </AdminSection>
  );
}

function TeamEntries({ competitionId, seasonId }: { competitionId: string; seasonId: string }) {
  const { canIn } = useAuth();
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const canManage = canIn('teams.manage', competitionId);
  const canManageCaptains = canIn('captains.manage', competitionId);

  const entriesQ = useQuery({
    queryKey: ['admin-team-entries', seasonId],
    queryFn: () => teamsApi.entries(seasonId),
  });
  const groupsQ = useQuery({
    queryKey: ['admin-groups', seasonId],
    queryFn: () => competitionsApi.groups(seasonId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-team-entries', seasonId] });
    void queryClient.invalidateQueries({ queryKey: ['team-entries'] });
  };

  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [department, setDepartment] = useState('');
  const [groupId, setGroupId] = useState('');

  return (
    <>
      <Feedback error={action.error} notice={action.notice} />

      <h3 className={styles.subheading}>Season entries</h3>
      {entriesQ.isLoading ? <p className={styles.muted}>Loading team entries…</p> : entriesQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load team entries.</p>
      ) : (entriesQ.data ?? []).length === 0 ? (
        <p className={styles.muted}>No teams have entered this season yet.</p>
      ) : (
        <div className={styles.list}>
          {entriesQ.data!.map((entry) => (
            <TeamEntryRow
              key={entry.registration.id}
              entry={entry}
              groups={groupsQ.data ?? []}
              canManage={canManage}
              canManageCaptains={canManageCaptains}
              onChanged={invalidate}
              run={action.run}
              pending={action.pending}
            />
          ))}
        </div>
      )}

      {canManage ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void action.run('create-team', async () => {
              const created = await teamsApi.create({
                name: name.trim(),
                shortName: shortName.trim() || null,
                department: department.trim() || null,
                seasonId,
                groupId: groupId || null,
              });
              setName('');
              setShortName('');
              setDepartment('');
              setGroupId('');
              invalidate();
              return `${created.name} created with a draft season entry.`;
            });
          }}
        >
          <h3>Add a team</h3>
          <div className={styles.formGrid}>
            <Field label="Team name">
              <input className="tl-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required />
            </Field>
            <Field label="Short name">
              <input className="tl-input" value={shortName} onChange={(event) => setShortName(event.target.value)} maxLength={50} />
            </Field>
            <Field label="Department">
              <input className="tl-input" value={department} onChange={(event) => setDepartment(event.target.value)} maxLength={120} />
            </Field>
            <Field label="Group">
              <select className="tl-select" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                <option value="">No group</option>
                {(groupsQ.data ?? []).filter((group) => !group.archivedAt).map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className={styles.formActions}>
            <button type="submit" className="tl-btn tl-btn-primary" disabled={action.pending !== null}>
              <Plus size={15} aria-hidden /> {action.pending === 'create-team' ? 'Creating…' : 'Add team'}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

const ENTRY_ACTIONS: Record<string, { to: string; label: string }[]> = {
  draft: [
    { to: 'submitted', label: 'Submit' },
    { to: 'approved', label: 'Approve' },
  ],
  submitted: [
    { to: 'under_review', label: 'Start review' },
    { to: 'approved', label: 'Approve' },
  ],
  under_review: [{ to: 'approved', label: 'Approve' }],
  approved: [],
  rejected: [{ to: 'submitted', label: 'Resubmit' }],
  withdrawn: [{ to: 'submitted', label: 'Resubmit' }],
};

function TeamEntryRow({
  entry,
  groups,
  canManage,
  canManageCaptains,
  onChanged,
  run,
  pending,
}: {
  entry: TeamListEntryDto;
  groups: GroupDto[];
  canManage: boolean;
  canManageCaptains: boolean;
  onChanged: () => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  pending: string | null;
}) {
  const { registration, team } = entry;
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [captainsOpen, setCaptainsOpen] = useState(false);

  const changeStatus = (to: string) => {
    if (to === 'rejected' && !rejecting) {
      setRejecting(true);
      return;
    }
    void run(`entry:${registration.id}:${to}`, async () => {
      await teamsApi.updateEntry(registration.id, {
        status: to,
        ...(to === 'rejected' ? { reviewNote: rejectReason.trim() } : {}),
      });
      setRejecting(false);
      setRejectReason('');
      onChanged();
      return `${team.name} entry is now ${statusLabel(to)}.`;
    });
  };

  return (
    <div className={styles.entryRow}>
      <div className={styles.entryMain}>
        <strong>{team.name}</strong>
        <span className={styles.muted}>
          {statusLabel(registration.status)}
          {registration.reviewNote ? ` · ${registration.reviewNote}` : ''}
        </span>
      </div>
      <div className={styles.rowActions}>
        {canManage ? (
          <select
            className="tl-select"
            aria-label={`Group for ${team.name}`}
            value={registration.groupId ?? ''}
            disabled={pending !== null}
            onChange={(event) => {
              void run(`entry-group:${registration.id}`, async () => {
                await teamsApi.updateEntry(registration.id, { groupId: event.target.value || null });
                onChanged();
                return `${team.name} moved to a new group.`;
              });
            }}
          >
            <option value="">No group</option>
            {groups.filter((group) => !group.archivedAt).map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        ) : null}

        {canManage ? ENTRY_ACTIONS[registration.status]?.map((next) => (
          <button
            key={next.to}
            type="button"
            className="tl-btn tl-btn-sm"
            disabled={pending !== null}
            onClick={() => changeStatus(next.to)}
          >
            {next.label}
          </button>
        )) : null}

        {canManage && ['submitted', 'under_review', 'approved'].includes(registration.status) ? (
          <button
            type="button"
            className="tl-btn tl-btn-sm tl-btn-danger"
            disabled={pending !== null}
            onClick={() => {
              setRejecting(true);
              setRejectReason('');
            }}
          >
            <X size={13} aria-hidden /> Reject
          </button>
        ) : null}

        <button
          type="button"
          className="tl-btn tl-btn-sm"
          onClick={() => setCaptainsOpen((value) => !value)}
          aria-expanded={captainsOpen}
        >
          <UserPlus size={13} aria-hidden /> Captain
        </button>
      </div>

      {rejecting ? (
        <form
          className={`${styles.form} ${styles.fullRow}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!rejectReason.trim()) return;
            void run(`entry:${registration.id}:rejected`, async () => {
              await teamsApi.updateEntry(registration.id, {
                status: 'rejected',
                reviewNote: rejectReason.trim(),
              });
              setRejecting(false);
              setRejectReason('');
              onChanged();
              return `${team.name} entry rejected.`;
            });
          }}
        >
          <Field label="Rejection reason">
            <input
              className="tl-input"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              maxLength={2000}
              required
            />
          </Field>
          <div className={styles.formActions}>
            <button type="submit" className="tl-btn tl-btn-sm tl-btn-danger" disabled={pending !== null || !rejectReason.trim()}>
              Confirm rejection
            </button>
            <button type="button" className="tl-btn tl-btn-sm tl-btn-ghost" onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {captainsOpen ? (
        <div className={`${styles.fullRow} ${styles.detail}`}>
          <CaptainPanel
            teamRegistrationId={registration.id}
            teamName={team.name}
            canManage={canManageCaptains}
            onChanged={onChanged}
            run={run}
            pending={pending}
          />
        </div>
      ) : null}
    </div>
  );
}

function CaptainPanel({
  teamRegistrationId,
  teamName,
  canManage,
  onChanged,
  run,
  pending,
}: {
  teamRegistrationId: string;
  teamName: string;
  canManage: boolean;
  onChanged: () => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  pending: string | null;
}) {
  const captainQ = useQuery({
    queryKey: ['admin-captain', teamRegistrationId],
    queryFn: () => teamsApi.captain(teamRegistrationId),
  });
  const [search, setSearch] = useState('');
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const usersQ = useQuery({
    queryKey: ['admin-captain-users', search],
    queryFn: () => usersApi.list({ q: search.trim(), limit: 8 }),
    enabled: canManage && search.trim().length >= 2,
  });

  return (
    <>
      <h4>Captain</h4>
      {captainQ.isLoading ? <p className={styles.muted}>Loading captain…</p> : captainQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load the captain.</p>
      ) : captainQ.data?.captain ? (
        <p>
          {captainQ.data.captain.displayName} · {captainQ.data.captain.email}
          {canManage ? (
            <button
              type="button"
              className="tl-btn tl-btn-sm tl-btn-danger"
              disabled={pending !== null}
              onClick={() => {
                void run(`revoke-captain:${teamRegistrationId}`, async () => {
                  await teamsApi.revokeCaptain(teamRegistrationId);
                  onChanged();
                  return `Captain removed from ${teamName}.`;
                });
              }}
            >
              Revoke
            </button>
          ) : null}
        </p>
      ) : (
        <p className={styles.muted}>No captain is assigned to this entry.</p>
      )}

      {canManage ? (
        <>
          <Field label="Find an account" hint="Search by name or email, then assign the account. The captain role is granted by the server.">
            <input className="tl-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="At least two characters" />
          </Field>
          {usersQ.isFetching ? <p className={styles.muted}>Searching…</p> : null}
          {(usersQ.data?.items ?? []).length > 0 ? (
            <ul className={styles.list}>
              {usersQ.data!.items.map((user) => (
                <li key={user.id} className={styles.entryRow}>
                  <div className={styles.entryMain}>
                    <strong>{user.displayName}</strong>
                    <span className={styles.muted}>{user.email}{user.isActive ? '' : ' · inactive'}</span>
                  </div>
                  <button
                    type="button"
                    className="tl-btn tl-btn-sm tl-btn-primary"
                    disabled={pending !== null || !user.isActive}
                    onClick={() => {
                      void run(`assign-captain:${teamRegistrationId}:${user.id}`, async () => {
                        await teamsApi.assignCaptain(teamRegistrationId, user.id);
                        setSearch('');
                        onChanged();
                        return `${user.displayName} is now captain of ${teamName}.`;
                      });
                    }}
                  >
                    Assign
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <button type="button" className="tl-btn tl-btn-sm" onClick={() => setProvisionOpen((value) => !value)} aria-expanded={provisionOpen}>
            <Plus size={13} aria-hidden /> Create a captain account
          </button>
          {provisionOpen ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void run(`provision-captain:${teamRegistrationId}`, async () => {
                  await teamsApi.provisionCaptain({
                    email: email.trim(),
                    password,
                    displayName: displayName.trim(),
                    teamRegistrationId,
                  });
                  setEmail('');
                  setPassword('');
                  setDisplayName('');
                  setProvisionOpen(false);
                  onChanged();
                  return `Captain account created for ${teamName}.`;
                });
              }}
            >
              <div className={styles.formGrid}>
                <Field label="Display name">
                  <input className="tl-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={160} required />
                </Field>
                <Field label="Email">
                  <input className="tl-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </Field>
                <Field label="Temporary password" hint="At least 8 characters.">
                  <input className="tl-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required />
                </Field>
              </div>
              <div className={styles.formActions}>
                <button type="submit" className="tl-btn tl-btn-primary" disabled={pending !== null || password.length < 8}>
                  Create account and assign
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : (
        <p className={styles.muted}>Assigning captains requires the captains manage permission in this competition.</p>
      )}
    </>
  );
}

function PlayerRegistrations({ seasonId, competitionId }: { seasonId: string; competitionId: string }) {
  const { canIn } = useAuth();
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const canReview = canIn('registrations.review', competitionId);
  const [status, setStatus] = useState('');
  const [teamFilter, setTeamFilter] = useState('');

  const entriesQ = useQuery({
    queryKey: ['admin-team-entries', seasonId],
    queryFn: () => teamsApi.entries(seasonId),
  });
  const registrationsQ = useQuery({
    queryKey: ['admin-registrations', seasonId, status],
    queryFn: () => registrationsApi.list({ seasonId, displayStatus: status || undefined }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-registrations', seasonId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-team-entries', seasonId] });
  };

  const rows = (registrationsQ.data ?? []).filter(
    (entry) => !teamFilter || entry.teamRegistrationId === teamFilter,
  );

  return (
    <>
      <h3 className={styles.subheading}>Player registrations</h3>
      <Feedback error={action.error} notice={action.notice} />

      <div className={styles.filterRow}>
        <Field label="Status">
          <select className="tl-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {REG_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </Field>
        <Field label="Team entry">
          <select className="tl-select" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
            <option value="">All teams</option>
            {(entriesQ.data ?? []).map((entry) => (
              <option key={entry.registration.id} value={entry.registration.id}>{entry.team.name}</option>
            ))}
          </select>
        </Field>
      </div>

      {registrationsQ.isLoading ? <p className={styles.muted}>Loading registrations…</p> : registrationsQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load player registrations.</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>No player registrations match this filter.</p>
      ) : (
        <div className="tl-scroll">
          <table className="tl-table">
            <caption className="sr-only">Player registrations in this season</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Team</th>
                <th scope="col">Position</th>
                <th scope="col" className="num">No.</th>
                <th scope="col">Status</th>
                <th scope="col">Review</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((registration) => (
                <RegistrationRow
                  key={registration.id}
                  registration={registration}
                  canReview={canReview}
                  onChanged={invalidate}
                  run={action.run}
                  pending={action.pending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function RegistrationRow({
  registration,
  canReview,
  onChanged,
  run,
  pending,
}: {
  registration: PlayerRegistrationDto;
  canReview: boolean;
  onChanged: () => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  pending: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const reviewable = canReview && ['submitted', 'under_review'].includes(registration.status);

  const historyQ = useQuery({
    queryKey: ['admin-registration-history', registration.id],
    queryFn: () => registrationsApi.history(registration.id),
    enabled: historyOpen,
  });

  const act = (kind: 'review' | 'approve' | 'reject') => {
    void run(`registration:${registration.id}:${kind}`, async () => {
      if (kind === 'review') await registrationsApi.review(registration.id, note.trim() || null);
      if (kind === 'approve') await registrationsApi.approve(registration.id, note.trim() || null);
      if (kind === 'reject') await registrationsApi.reject(registration.id, note.trim());
      setOpen(false);
      setNote('');
      onChanged();
      return `${registration.player.fullName}: ${kind === 'review' ? 'under review' : kind === 'approve' ? 'approved' : 'rejected'}.`;
    });
  };

  const reviewEdit = (decision: 'approve' | 'reject') => {
    if (!registration.pendingEdit) return;
    void run(`registration-edit:${registration.id}:${decision}`, async () => {
      const note = decision === 'reject' ? window.prompt('Reason for rejecting these changes') : window.prompt('Optional review note');
      if (decision === 'reject' && !note?.trim()) return 'A rejection reason is required.';
      await registrationsApi.reviewEdit(registration.id, registration.pendingEdit!.id, decision, note?.trim() || null);
      onChanged();
      return `Player changes ${decision === 'approve' ? 'approved' : 'rejected'}.`;
    });
  };

  return (
    <>
      <tr>
        <th scope="row">{registration.player.fullName}</th>
        <td>{registration.team.name}</td>
        <td>{positionLabel(registration.player.position) ?? 'Not recorded'}</td>
        <td className="num">{registration.shirtNumber ?? '—'}</td>
        <td><span className="tl-badge">{statusLabel(registration.displayStatus ?? registration.status)}</span></td>
        <td>{registration.latestEdit?.status === 'rejected' ? registration.latestEdit.reviewNote ?? 'Proposed changes were rejected; approved information remains unchanged.' : registration.reviewNote ?? '—'}</td>
        <td>
          <div className={styles.rowActions}>
            {registration.pendingEdit && canReview ? <>
              <span className="tl-badge">Changes pending</span>
              <details><summary>View proposed changes</summary><pre className={styles.pre}>{JSON.stringify(registration.pendingEdit.proposed, null, 2)}</pre></details>
              <button type="button" className="tl-btn tl-btn-sm" disabled={pending !== null} onClick={() => reviewEdit('approve')}>Approve changes</button>
              <button type="button" className="tl-btn tl-btn-sm tl-btn-danger" disabled={pending !== null} onClick={() => reviewEdit('reject')}>Reject changes</button>
            </> : null}
            {reviewable ? (
              <button type="button" className="tl-btn tl-btn-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
                <ClipboardList size={13} aria-hidden /> Review
              </button>
            ) : null}
            <button type="button" className="tl-btn tl-btn-sm tl-btn-ghost" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen}>
              <ChevronDown size={13} aria-hidden /> History
            </button>
          </div>
        </td>
      </tr>
      {open && reviewable ? (
        <tr>
          <td colSpan={7}>
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                act('approve');
              }}
            >
              <Field label="Review note">
                <textarea className="tl-textarea" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
              </Field>
              <p className={styles.muted}>
                Approval revalidates the player, shirt number and eligibility. A rejection requires a note.
              </p>
              <div className={styles.formActions}>
                {registration.status === 'submitted' ? (
                  <button type="button" className="tl-btn tl-btn-sm" disabled={pending !== null} onClick={() => act('review')}>
                    <ShieldCheck size={13} aria-hidden /> Start review
                  </button>
                ) : null}
                <button type="submit" className="tl-btn tl-btn-sm tl-btn-primary" disabled={pending !== null}>
                  <Check size={13} aria-hidden /> Approve
                </button>
                <button
                  type="button"
                  className="tl-btn tl-btn-sm tl-btn-danger"
                  disabled={pending !== null || note.trim().length === 0}
                  onClick={() => act('reject')}
                >
                  <X size={13} aria-hidden /> Reject
                </button>
              </div>
            </form>
          </td>
        </tr>
      ) : null}
      {historyOpen ? (
        <tr>
          <td colSpan={7}>
            {historyQ.isLoading ? <p className={styles.muted}>Loading history…</p> : historyQ.isError ? (
              <p className="tl-alert tl-alert-error" role="alert">Could not load the registration history.</p>
            ) : (historyQ.data ?? []).length === 0 ? (
              <p className={styles.muted}>No history entries.</p>
            ) : (
              <ul className={styles.list}>
                {(historyQ.data as PlayerRegistrationHistoryDto[]).map((entry) => (
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
          </td>
        </tr>
      ) : null}
    </>
  );
}
