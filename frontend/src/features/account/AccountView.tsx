'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/States';
import { useCompetitions } from '@/features/competitions/hooks';
import { errorMessage } from '@/lib/api/client';
import { useAuth } from '@/features/auth/AuthProvider';
import { permissionLabel, roleLabel } from '@/features/auth/labels';
import styles from './Account.module.css';

export function AccountView() {
  const { user, status, logout, logoutAll, isCaptain, isOfficial, isCompetitionAdmin } = useAuth();
  const competitions = useCompetitions();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'logout' | 'logout-all' | null>(null);

  const competitionNames = useMemo(
    () => new Map((competitions.data ?? []).map((competition) => [competition.id, competition.name])),
    [competitions.data],
  );

  if (status === 'loading') return <Skeleton lines={4} height={70} />;
  if (!user) return null;

  const roles = [...new Set(user.roles.map((assignment) => assignment.role))];

  const run = async (kind: 'logout' | 'logout-all') => {
    setError(null);
    setPending(kind);
    try {
      await (kind === 'logout' ? logout() : logoutAll());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Your account"
        lead="Your identity, roles and competition scopes as the server reports them. The server re-checks every permission on each request."
      />

      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}

      <div className="tl-grid">
        <section className="tl-card">
          <h2>Profile</h2>
          <dl className={styles.defs}>
            <div><dt>Display name</dt><dd>{user.displayName}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Session</dt><dd className={styles.mono}>{user.sessionId}</dd></div>
          </dl>
        </section>

        <section className="tl-card">
          <h2>Roles</h2>
          {roles.length === 0 ? <p className="tl-muted">No roles are assigned to this account.</p> : (
            <ul className={styles.tags}>
              {roles.map((role) => <li key={role} className="tl-badge">{roleLabel(role)}</li>)}
            </ul>
          )}
          {user.roles.some((assignment) => assignment.competitionId) ? (
            <ul className={styles.scopeList}>
              {user.roles.filter((assignment) => assignment.competitionId).map((assignment) => (
                <li key={`${assignment.role}:${assignment.competitionId}`}>
                  {roleLabel(assignment.role)} · {competitionNames.get(assignment.competitionId!) ?? assignment.competitionId}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section className={`tl-card ${styles.block}`}>
        <h2>Permissions</h2>
        {user.permissions.length === 0 ? (
          <p className="tl-muted">This account has no account-wide permissions.</p>
        ) : (
          <ul className={styles.tags}>
            {user.permissions.map((permission) => (
              <li key={permission} className="tl-badge">{permissionLabel(permission)}</li>
            ))}
          </ul>
        )}

        {user.scopes.length > 0 ? (
          <>
            <h3 className={styles.sub}>Competition-scoped permissions</h3>
            <div className="tl-stack-sm">
              {user.scopes.map((scope) => (
                <div key={scope.competitionId} className={styles.scopeCard}>
                  <strong>{competitionNames.get(scope.competitionId) ?? scope.competitionId}</strong>
                  <ul className={styles.tags}>
                    {scope.permissions.map((permission) => (
                      <li key={permission} className="tl-badge">{permissionLabel(permission)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className={`tl-card ${styles.block}`}>
        <h2>Workspaces</h2>
        <div className={styles.links}>
          {isCaptain ? <Link className="tl-btn" href="/captain">Captain workspace</Link> : null}
          {isOfficial ? <Link className="tl-btn" href="/official">Official workspace</Link> : null}
          {isCompetitionAdmin ? <Link className="tl-btn" href="/admin">Administration</Link> : null}
          {!isCaptain && !isOfficial && !isCompetitionAdmin ? (
            <p className="tl-muted">
              Public pages are available to every visitor. Captains, officials and administrators
              see their own workspace links here once the role is granted.
            </p>
          ) : null}
        </div>
        <hr className="tl-divider" />
        <div className={styles.danger}>
          <button
            type="button"
            className="tl-btn"
            onClick={() => void run('logout')}
            disabled={pending !== null}
          >
            {pending === 'logout' ? 'Signing out…' : 'Sign out'}
          </button>
          <button
            type="button"
            className="tl-btn tl-btn-danger"
            onClick={() => void run('logout-all')}
            disabled={pending !== null}
          >
            {pending === 'logout-all' ? 'Signing out…' : 'Sign out of every device'}
          </button>
        </div>
      </section>
    </>
  );
}
