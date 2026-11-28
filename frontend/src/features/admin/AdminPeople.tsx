'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, KeyRound, Megaphone, Plus, Search, ShieldCheck, UserCog } from 'lucide-react';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useAuth } from '@/features/auth/AuthProvider';
import { roleLabel } from '@/features/auth/labels';
import {
  adminApi,
  announcementsApi,
  auditApi,
  competitionAccountsApi,
  competitionsApi,
  usersApi,
} from '@/lib/api/endpoints';
import type {
  AdminAccountDto,
  AnnouncementAudience,
  AnnouncementDto,
  UserDto,
} from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { DISPLAY_TIME_ZONE } from '@/types';
import { AdminSection, Feedback, Field, statusLabel, useAdminAction } from './ui';
import styles from './Admin.module.css';

const ROLES = [
  'registered_user',
  'team_captain',
  'match_official',
  'commentary_operator',
  'competition_admin',
  'super_admin',
] as const;

const SCOPED_ROLES = new Set(['team_captain', 'match_official', 'commentary_operator', 'competition_admin']);
const AUDIENCES: AnnouncementAudience[] = ['public', 'participants', 'captains', 'officials', 'administrators'];

export function AdminPeople({ section = 'all' }: { section?: 'users' | 'announcements' | 'audit' | 'all' }) {
  const { competition } = useActiveCompetition();
  const { can, canIn, isSuperAdmin } = useAuth();
  const competitionId = competition?.id;
  const canHere = (permission: string) =>
    can(permission) || (competitionId ? canIn(permission, competitionId) : false);

  const titles = { users: 'User management', announcements: 'Announcements', audit: 'Audit logs', all: 'Users, announcements and audit' };
  return (
    <AdminSection
      title={titles[section]}
      description={section === 'all' ? 'Accounts and role assignments are always filtered by the server to your administrative scope.' : undefined}
    >
      {section !== 'announcements' && section !== 'audit' ? (canHere('users.read') ? <UsersPanel competitionId={competitionId} /> : (
        <p className={styles.muted}>Your account cannot read user records.</p>
      )) : null}

      {section === 'all' ? <div className={styles.divider} /> : null}
      {section !== 'announcements' && section !== 'audit' ? (isSuperAdmin ? <AdminAccountsPanel competitionId={competitionId} /> : (
        <p className={styles.muted}>Administrator account provisioning is restricted to a super administrator.</p>
      )) : null}

      {section === 'all' ? <div className={styles.divider} /> : null}
      {section !== 'users' && section !== 'audit' ? (canHere('announcements.manage') ? (
        <AnnouncementsPanel competitionId={competitionId} />
      ) : (
        <p className={styles.muted}>Announcement management requires the announcements manage permission.</p>
      )) : null}

      {section === 'all' ? <div className={styles.divider} /> : null}
      {section !== 'users' && section !== 'announcements' ? (canHere('audit.read') ? <AuditPanel competitionId={competitionId} /> : (
        <p className={styles.muted}>Audit history requires the audit read permission.</p>
      )) : null}
    </AdminSection>
  );
}

/* -------------------------------- users ---------------------------------- */

function UsersPanel({ competitionId }: { competitionId?: string }) {
  const queryClient = useQueryClient();
  const { canIn } = useAuth();
  const accountAction = useAdminAction();
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'match_official' | 'commentary_operator'>('match_official');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const usersQ = useQuery({
    queryKey: ['admin-users', competitionId, q, status, role],
    queryFn: () => usersApi.list({
      q: q.trim() || undefined,
      status: status || undefined,
      role: role || undefined,
      competitionId,
      limit: 50,
    }),
  });

  const users = usersQ.data?.items ?? [];
  const selectedUser = users.find((entry) => entry.id === selected) ?? null;

  return (
    <>
      <h3 className={styles.subheading}><UserCog size={16} aria-hidden /> Users</h3>
      {competitionId && canIn('roles.manage', competitionId) ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void accountAction.run('provision-account', async () => {
              await competitionAccountsApi.create({
                email: newEmail.trim(),
                displayName: newName.trim(),
                password: newPassword,
                role: newRole,
                competitionId,
              });
              setNewEmail('');
              setNewName('');
              setNewPassword('');
              void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
              return 'Operational account created for this competition.';
            });
          }}
        >
          <strong>Add an operational account</strong>
          <Feedback error={accountAction.error} notice={accountAction.notice} />
          <div className={styles.formGrid}>
            <Field label="Display name"><input className="tl-input" required value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
            <Field label="Email"><input className="tl-input" type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></Field>
            <Field label="Temporary password"><input className="tl-input" type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field>
            <Field label="Role">
              <select className="tl-select" value={newRole} onChange={(e) => setNewRole(e.target.value as typeof newRole)}>
                <option value="match_official">Match official</option>
                <option value="commentary_operator">Match operator</option>
              </select>
            </Field>
          </div>
          <div className={styles.formActions}>
            <button type="submit" className="tl-btn tl-btn-primary" disabled={accountAction.pending !== null}>Create account</button>
          </div>
        </form>
      ) : null}
      <div className={styles.filterRow}>
        <Field label="Search">
          <input className="tl-input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Name or email" />
        </Field>
        <Field label="Status">
          <select className="tl-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
        <Field label="Role">
          <select className="tl-select" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">Any role</option>
            {ROLES.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}
          </select>
        </Field>
      </div>

      {usersQ.isLoading ? <p className={styles.muted}>Loading users…</p> : usersQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load users in this scope.</p>
      ) : users.length === 0 ? (
        <p className={styles.muted}>No users match this filter.</p>
      ) : (
        <div className="tl-scroll">
          <table className="tl-table">
            <caption className="sr-only">Users visible to your scope</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Status</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <th scope="row">{user.displayName}</th>
                  <td>{user.email}</td>
                  <td>
                    <span className="tl-badge">
                      {user.suspendedAt ? 'Suspended' : user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="tl-btn tl-btn-sm"
                      onClick={() => setSelected(selected === user.id ? null : user.id)}
                      aria-expanded={selected === user.id}
                    >
                      {selected === user.id ? 'Close' : 'Open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedUser ? (
        <UserDetail
          key={selectedUser.id}
          user={selectedUser}
          competitionId={competitionId}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            void queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUser.id] });
          }}
        />
      ) : null}
    </>
  );
}

function UserDetail({
  user,
  competitionId,
  onChanged,
}: {
  user: UserDto;
  competitionId?: string;
  onChanged: () => void;
}) {
  const { can, canIn, isSuperAdmin } = useAuth();
  const action = useAdminAction();
  const canManageAccounts = can('users.manage');
  const canManageRoles = can('roles.manage') || Boolean(competitionId && canIn('roles.manage', competitionId));

  const rolesQ = useQuery({
    queryKey: ['admin-user-roles', user.id],
    queryFn: () => usersApi.roles(user.id),
  });
  const associationsQ = useQuery({
    queryKey: ['admin-user-associations', user.id],
    queryFn: () => usersApi.associations(user.id),
  });
  const historyQ = useQuery({
    queryKey: ['admin-user-history', user.id],
    queryFn: () => usersApi.history(user.id),
  });

  const [grantRole, setGrantRole] = useState<string>('team_captain');
  const [grantCompetition, setGrantCompetition] = useState(competitionId ?? '');
  const [suspendReason, setSuspendReason] = useState('');
  const [sessionReason, setSessionReason] = useState('');
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const needsCompetition = SCOPED_ROLES.has(grantRole);

  const competitionsQ = useQuery({
    queryKey: ['competitions'],
    queryFn: () => competitionsApi.list(),
    enabled: needsCompetition,
  });

  const invalidate = () => {
    void rolesQ.refetch();
    void historyQ.refetch();
    void associationsQ.refetch();
    onChanged();
  };

  return (
    <div className={styles.detail}>
      <header className={styles.cardHead}>
        <div>
          <h3>{user.displayName}</h3>
          <p className={styles.muted}>
            {user.email} · created {formatDateTime(user.createdAt, DISPLAY_TIME_ZONE)}
            {user.suspendedAt ? ` · suspended: ${user.suspendedReason ?? 'no reason recorded'}` : ''}
          </p>
        </div>
        <span className="tl-badge">{user.suspendedAt ? 'Suspended' : user.isActive ? 'Active' : 'Inactive'}</span>
      </header>

      <Feedback error={action.error} notice={action.notice} />

      <h4>Role assignments</h4>
      {rolesQ.isLoading ? <p className={styles.muted}>Loading roles…</p> : rolesQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load role assignments.</p>
      ) : (rolesQ.data ?? []).length === 0 ? (
        <p className={styles.muted}>No role assignments are visible in your scope.</p>
      ) : (
        <ul className={styles.list}>
          {rolesQ.data!.map((assignment) => (
            <li key={`${assignment.role}:${assignment.competitionId ?? 'global'}`} className={styles.entryRow}>
              <div className={styles.entryMain}>
                <strong>{roleLabel(assignment.role)}</strong>
                <span className={styles.muted}>
                  {assignment.competitionName ?? (assignment.competitionId ? assignment.competitionId : 'Global')}
                  {' · '}assigned {formatDateTime(assignment.assignedAt, DISPLAY_TIME_ZONE)}
                </span>
              </div>
              {canManageRoles && !(assignment.role === 'super_admin' && !isSuperAdmin) ? (
                <button
                  type="button"
                  className="tl-btn tl-btn-sm tl-btn-danger"
                  disabled={action.pending !== null}
                  onClick={() => void action.run(`revoke-role:${assignment.role}`, async () => {
                    await usersApi.revokeRole(user.id, assignment.role, assignment.competitionId);
                    invalidate();
                    return `${roleLabel(assignment.role)} revoked.`;
                  })}
                >
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManageRoles ? (
        <form
          className={`${styles.form} ${styles.inlineForm}`}
          onSubmit={(event) => {
            event.preventDefault();
            void action.run('grant-role', async () => {
              await usersApi.grantRole(user.id, grantRole, needsCompetition ? grantCompetition : null);
              invalidate();
              return `${roleLabel(grantRole)} granted.`;
            });
          }}
        >
          <Field label="Grant role">
            <select className="tl-select" value={grantRole} onChange={(event) => setGrantRole(event.target.value)}>
              {ROLES.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}
            </select>
          </Field>
          {needsCompetition ? (
            <Field label="Competition scope">
              <select
                className="tl-select"
                value={grantCompetition}
                onChange={(event) => setGrantCompetition(event.target.value)}
                required
              >
                <option value="">Select a competition</option>
                {(competitionsQ.data ?? []).map((competition) => (
                  <option key={competition.id} value={competition.id}>{competition.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <button type="submit" className="tl-btn" disabled={action.pending !== null || (needsCompetition && !grantCompetition)}>
            Grant role
          </button>
        </form>
      ) : null}

      <h4>Captaincies and official assignments</h4>
      {associationsQ.isLoading ? <p className={styles.muted}>Loading associations…</p> : associationsQ.isError ? (
        <p className={styles.muted}>Associations are not available in this scope.</p>
      ) : (
        <div className="tl-grid">
          <div>
            <h5>Captaincies</h5>
            {(associationsQ.data?.captaincies ?? []).length === 0 ? <p className={styles.muted}>None recorded.</p> : (
              <ul className={styles.list}>
                {associationsQ.data!.captaincies.map((entry) => (
                  <li key={entry.teamRegistrationId} className={styles.entry}>
                    {entry.teamName} · {entry.competitionName} · {entry.seasonLabel}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h5>Official assignments</h5>
            {(associationsQ.data?.officialAssignments ?? []).length === 0 ? <p className={styles.muted}>None recorded.</p> : (
              <ul className={styles.list}>
                {associationsQ.data!.officialAssignments.map((entry) => (
                  <li key={`${entry.matchId}:${entry.role}`} className={styles.entry}>
                    {entry.competitionName} · {statusLabel(entry.role)} · {formatDateTime(entry.assignedAt, DISPLAY_TIME_ZONE)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {canManageAccounts ? (
        <div className={styles.accountActions}>
          <h4>Account controls</h4>
          <div className={styles.formActions}>
            {user.suspendedAt ? (
              <button
                type="button"
                className="tl-btn"
                disabled={action.pending !== null}
                onClick={() => void action.run('restore-user', async () => {
                  await usersApi.restore(user.id);
                  invalidate();
                  return 'Account restored.';
                })}
              >
                Restore account
              </button>
            ) : (
              <button type="button" className="tl-btn tl-btn-danger" onClick={() => setSuspendOpen((value) => !value)} aria-expanded={suspendOpen}>
                <Ban size={14} aria-hidden /> Suspend
              </button>
            )}
            <button
              type="button"
              className="tl-btn"
              disabled={action.pending !== null}
              onClick={() => void action.run('toggle-user', async () => {
                if (user.isActive) await usersApi.deactivate(user.id);
                else await usersApi.activate(user.id);
                invalidate();
                return user.isActive ? 'Account deactivated.' : 'Account activated.';
              })}
            >
              {user.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button type="button" className="tl-btn" onClick={() => setSessionOpen((value) => !value)} aria-expanded={sessionOpen}>
              <KeyRound size={14} aria-hidden /> Revoke sessions
            </button>
          </div>

          {suspendOpen ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void action.run('suspend-user', async () => {
                  await usersApi.suspend(user.id, suspendReason.trim());
                  setSuspendOpen(false);
                  setSuspendReason('');
                  invalidate();
                  return 'Account suspended and sessions revoked.';
                });
              }}
            >
              <Field label="Suspension reason">
                <input className="tl-input" value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} minLength={3} maxLength={2000} required />
              </Field>
              <div className={styles.formActions}>
                <button type="submit" className="tl-btn tl-btn-danger" disabled={action.pending !== null || suspendReason.trim().length < 3}>
                  Suspend account
                </button>
              </div>
            </form>
          ) : null}

          {sessionOpen ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void action.run('revoke-sessions', async () => {
                  const result = await usersApi.revokeSessions(user.id, sessionReason.trim() || undefined);
                  setSessionOpen(false);
                  setSessionReason('');
                  invalidate();
                  return `${result.revoked} session(s) revoked.`;
                });
              }}
            >
              <Field label="Reason (optional)">
                <input className="tl-input" value={sessionReason} onChange={(event) => setSessionReason(event.target.value)} maxLength={2000} />
              </Field>
              <div className={styles.formActions}>
                <button type="submit" className="tl-btn" disabled={action.pending !== null}>Revoke every session</button>
              </div>
            </form>
          ) : null}
        </div>
      ) : (
        <p className={styles.muted}>Account suspension and session revocation require the user manage permission.</p>
      )}

      <h4>Administrative history</h4>
      {historyQ.isLoading ? <p className={styles.muted}>Loading history…</p> : historyQ.isError ? (
        <p className={styles.muted}>History is not available in this scope.</p>
      ) : (historyQ.data ?? []).length === 0 ? (
        <p className={styles.muted}>No history entries.</p>
      ) : (
        <ul className={styles.list}>
          {historyQ.data!.slice(0, 20).map((entry) => (
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
    </div>
  );
}

/* ---------------------------- admin accounts ----------------------------- */

function AdminAccountsPanel({ competitionId }: { competitionId?: string }) {
  const action = useAdminAction();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'competition_admin' | 'super_admin'>('competition_admin');
  const [scopes, setScopes] = useState<string[]>(competitionId ? [competitionId] : []);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignment, setAssignment] = useState(competitionId ?? '');

  const accountsQ = useQuery({
    queryKey: ['admin-accounts', competitionId],
    queryFn: () => adminApi.list({ competitionId }),
  });
  const competitionsQ = useQuery({
    queryKey: ['competitions'],
    queryFn: () => competitionsApi.list(),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });

  return (
    <>
      <h3 className={styles.subheading}><ShieldCheck size={16} aria-hidden /> Administrator accounts</h3>
      <Feedback error={action.error} notice={action.notice} />

      {accountsQ.isLoading ? <p className={styles.muted}>Loading administrators…</p> : accountsQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load administrator accounts.</p>
      ) : (
        <ul className={styles.list}>
          {(accountsQ.data ?? []).map((account) => (
            <AdminAccountRow
              key={account.id}
              account={account}
              competitions={competitionsQ.data ?? []}
              assignFor={assignFor}
              onAssignFor={setAssignFor}
              assignment={assignment}
              onAssignment={setAssignment}
              onChanged={invalidate}
              run={action.run}
              pending={action.pending}
            />
          ))}
          {(accountsQ.data ?? []).length === 0 ? <p className={styles.muted}>No administrator accounts are visible.</p> : null}
        </ul>
      )}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void action.run('create-admin', async () => {
            await adminApi.create({
              email: email.trim(),
              password,
              displayName: displayName.trim(),
              role,
              ...(role === 'competition_admin' ? { competitionIds: scopes } : {}),
            });
            setEmail('');
            setPassword('');
            setDisplayName('');
            setScopes(competitionId ? [competitionId] : []);
            invalidate();
            return 'Administrator account created.';
          });
        }}
      >
        <h4>Create an administrator</h4>
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
          <Field label="Role">
            <select className="tl-select" value={role} onChange={(event) => setRole(event.target.value as 'competition_admin' | 'super_admin')}>
              <option value="competition_admin">Competition administrator</option>
              <option value="super_admin">Super administrator</option>
            </select>
          </Field>
        </div>

        {role === 'competition_admin' ? (
          <fieldset className={styles.checkGroup}>
            <legend className="tl-label">Competition scope</legend>
            {(competitionsQ.data ?? []).map((competition) => (
              <label key={competition.id} className="tl-check">
                <input
                  type="checkbox"
                  checked={scopes.includes(competition.id)}
                  onChange={(event) => {
                    setScopes((previous) => event.target.checked
                      ? [...previous, competition.id]
                      : previous.filter((id) => id !== competition.id));
                  }}
                />
                <span>{competition.name}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className={styles.formActions}>
          <button type="submit" className="tl-btn tl-btn-primary" disabled={action.pending !== null || password.length < 8 || (role === 'competition_admin' && scopes.length === 0)}>
            <Plus size={15} aria-hidden /> Create administrator
          </button>
        </div>
      </form>
    </>
  );
}

function AdminAccountRow({
  account,
  competitions,
  assignFor,
  onAssignFor,
  assignment,
  onAssignment,
  onChanged,
  run,
  pending,
}: {
  account: AdminAccountDto;
  competitions: { id: string; name: string }[];
  assignFor: string | null;
  onAssignFor: (id: string | null) => void;
  assignment: string;
  onAssignment: (id: string) => void;
  onChanged: () => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  pending: string | null;
}) {
  return (
    <li className={styles.entryRow}>
      <div className={styles.entryMain}>
        <strong>{account.displayName}</strong>
        <span className={styles.muted}>
          {account.email} · {account.roles.map(roleLabel).join(', ') || 'No admin role'}
          {account.competitionIds.length > 0 ? ` · ${account.competitionIds.length} competition scope(s)` : ''}
          {account.isActive ? '' : ' · inactive'}
        </span>
      </div>
      {!account.roles.includes('super_admin') ? (
        <div className={styles.rowActions}>
          {account.competitionIds.map((id) => (
            <button
              key={id}
              type="button"
              className="tl-btn tl-btn-sm tl-btn-danger"
              disabled={pending !== null}
              onClick={() => void run(`remove-admin-scope:${account.id}:${id}`, async () => {
                await adminApi.removeCompetition(account.id, id);
                onChanged();
                return 'Competition scope removed.';
              })}
            >
              Remove {competitions.find((entry) => entry.id === id)?.name ?? id}
            </button>
          ))}
          <button
            type="button"
            className="tl-btn tl-btn-sm"
            onClick={() => onAssignFor(assignFor === account.id ? null : account.id)}
            aria-expanded={assignFor === account.id}
          >
            Add scope
          </button>
          {assignFor === account.id ? (
            <form
              className={styles.inlineForm}
              onSubmit={(event) => {
                event.preventDefault();
                void run(`assign-admin-scope:${account.id}`, async () => {
                  await adminApi.assignCompetition(account.id, assignment);
                  onAssignFor(null);
                  onChanged();
                  return 'Competition scope assigned.';
                });
              }}
            >
              <select className="tl-select" value={assignment} onChange={(event) => onAssignment(event.target.value)} required>
                <option value="">Competition</option>
                {competitions
                  .filter((competition) => !account.competitionIds.includes(competition.id))
                  .map((competition) => (
                    <option key={competition.id} value={competition.id}>{competition.name}</option>
                  ))}
              </select>
              <button type="submit" className="tl-btn tl-btn-sm" disabled={pending !== null || !assignment}>Assign</button>
            </form>
          ) : null}
        </div>
      ) : (
        <span className="tl-badge">Global</span>
      )}
    </li>
  );
}

/* ----------------------------- announcements ----------------------------- */

function AnnouncementsPanel({ competitionId }: { competitionId?: string }) {
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [status, setStatus] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudience>('public');
  const [scope, setScope] = useState(competitionId ?? '');

  const q = useQuery({
    queryKey: ['admin-announcements', competitionId, status],
    queryFn: () => announcementsApi.manage({ competitionId, status: status || undefined, limit: 50 }),
  });
  const competitionsQ = useQuery({
    queryKey: ['competitions'],
    queryFn: () => competitionsApi.list(),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
    void queryClient.invalidateQueries({ queryKey: ['announcements'] });
  };

  return (
    <>
      <h3 className={styles.subheading}><Megaphone size={16} aria-hidden /> Announcements</h3>
      <Feedback error={action.error} notice={action.notice} />

      <div className={styles.filterRow}>
        <Field label="Status">
          <select className="tl-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
      </div>

      {q.isLoading ? <p className={styles.muted}>Loading announcements…</p> : q.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load announcements.</p>
      ) : (q.data?.items ?? []).length === 0 ? (
        <p className={styles.muted}>No announcements match this filter.</p>
      ) : (
        <div className={styles.list}>
          {q.data!.items.map((announcement) => (
            <AnnouncementRow
              key={announcement.id}
              announcement={announcement}
              onChanged={invalidate}
              run={action.run}
              pending={action.pending}
            />
          ))}
        </div>
      )}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void action.run('create-announcement', async () => {
            await announcementsApi.create({
              competitionId: scope || null,
              title: title.trim(),
              body: body.trim(),
              audience,
            });
            setTitle('');
            setBody('');
            invalidate();
            return 'Announcement saved as a draft.';
          });
        }}
      >
        <h4>New announcement</h4>
        <div className={styles.formGrid}>
          <Field label="Competition">
            <select className="tl-select" value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="">Global (no competition)</option>
              {(competitionsQ.data ?? []).map((competition) => (
                <option key={competition.id} value={competition.id}>{competition.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Audience">
            <select className="tl-select" value={audience} onChange={(event) => setAudience(event.target.value as AnnouncementAudience)}>
              {AUDIENCES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Title">
          <input className="tl-input" value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={200} required />
        </Field>
        <Field label="Body">
          <textarea className="tl-textarea" value={body} onChange={(event) => setBody(event.target.value)} maxLength={20000} required />
        </Field>
        <p className={styles.muted}>
          Publishing is a separate step. Non-public audiences require a competition scope.
        </p>
        <div className={styles.formActions}>
          <button type="submit" className="tl-btn tl-btn-primary" disabled={action.pending !== null || title.trim().length < 3 || body.trim().length === 0}>
            Save draft
          </button>
        </div>
      </form>
    </>
  );
}

function AnnouncementRow({
  announcement,
  onChanged,
  run,
  pending,
}: {
  announcement: AnnouncementDto;
  onChanged: () => void;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  pending: string | null;
}) {
  const state = announcement.archivedAt ? 'archived' : announcement.publishedAt ? 'published' : 'draft';
  return (
    <div className={styles.entryRow}>
      <div className={styles.entryMain}>
        <strong>{announcement.title}</strong>
        <span className={styles.muted}>
          {statusLabel(state)} · {statusLabel(announcement.audience)}
          {announcement.publishedAt ? ` · published ${formatDateTime(announcement.publishedAt, DISPLAY_TIME_ZONE)}` : ''}
        </span>
      </div>
      <div className={styles.rowActions}>
        <span className="tl-badge">{statusLabel(state)}</span>
        {state === 'draft' ? (
          <button
            type="button"
            className="tl-btn tl-btn-sm tl-btn-primary"
            disabled={pending !== null}
            onClick={() => void run(`publish-announcement:${announcement.id}`, async () => {
              await announcementsApi.publish(announcement.id);
              onChanged();
              return 'Announcement published and its audience notified in-app.';
            })}
          >
            Publish
          </button>
        ) : null}
        {state === 'published' ? (
          <button
            type="button"
            className="tl-btn tl-btn-sm"
            disabled={pending !== null}
            onClick={() => void run(`unpublish-announcement:${announcement.id}`, async () => {
              await announcementsApi.unpublish(announcement.id);
              onChanged();
              return 'Announcement returned to draft.';
            })}
          >
            Unpublish
          </button>
        ) : null}
        {state !== 'archived' ? (
          <button
            type="button"
            className="tl-btn tl-btn-sm tl-btn-danger"
            disabled={pending !== null}
            onClick={() => void run(`archive-announcement:${announcement.id}`, async () => {
              await announcementsApi.archive(announcement.id);
              onChanged();
              return 'Announcement archived.';
            })}
          >
            Archive
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------- audit --------------------------------- */

function AuditPanel({ competitionId }: { competitionId?: string }) {
  const [actionFilter, setActionFilter] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const q = useQuery({
    queryKey: ['admin-audit', competitionId, actionFilter, entityType, from, to],
    queryFn: () => auditApi.list({
      competitionId,
      action: actionFilter.trim() || undefined,
      entityType: entityType.trim() || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      limit: 100,
    }),
  });

  const rows = useMemo(() => q.data?.items ?? [], [q.data]);

  return (
    <>
      <h3 className={styles.subheading}><Search size={16} aria-hidden /> Audit log</h3>
      <div className={styles.filterRow}>
        <Field label="Action">
          <input className="tl-input" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} placeholder="e.g. fixture.published" />
        </Field>
        <Field label="Entity type">
          <input className="tl-input" value={entityType} onChange={(event) => setEntityType(event.target.value)} placeholder="e.g. fixture" />
        </Field>
        <Field label="From">
          <input className="tl-input" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label="To">
          <input className="tl-input" type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
      </div>

      {q.isLoading ? <p className={styles.muted}>Loading audit entries…</p> : q.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load audit entries.</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>No audit entries match this filter.</p>
      ) : (
        <div className="tl-scroll">
          <table className="tl-table">
            <caption className="sr-only">Audit log entries</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Entity</th>
                <th scope="col">Actor</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.createdAt, DISPLAY_TIME_ZONE)}</td>
                  <td>{statusLabel(entry.action.replaceAll('.', ' '))}</td>
                  <td>{entry.entityType}{entry.entityId ? ` · ${entry.entityId.slice(0, 8)}…` : ''}</td>
                  <td>{entry.actorUserId ?? 'System'}</td>
                  <td>{entry.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
