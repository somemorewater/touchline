'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { ROLE_LABEL } from './labels';
import styles from './AccountMenu.module.css';

/**
 * Signed-in identity and role-aware shortcuts. The links are hidden when the
 * account lacks the role, but the API is the authority for every action.
 */
export function AccountMenu() {
  const { status, user, isCaptain, isOfficial, isCompetitionAdmin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status === 'loading') {
    return <span className={styles.placeholder} aria-hidden />;
  }

  if (status === 'anonymous') {
    return (
      <Link className={styles.signIn} href="/login">
        Sign in
      </Link>
    );
  }

  const roles = [...new Set((user?.roles ?? []).map((assignment) => assignment.role))];

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden>
          {user?.displayName?.slice(0, 1).toUpperCase() ?? '?'}
        </span>
        <span className={styles.name}>{user?.displayName}</span>
        <ChevronDown size={14} aria-hidden />
      </button>

      {open ? (
        <div className={styles.panel} id={panelId} role="region" aria-label="Account menu">
          <div className={styles.identity}>
            <strong>{user?.displayName}</strong>
            <span>{user?.email}</span>
            <ul className={styles.roles}>
              {roles.map((role) => (
                <li key={role} className={styles.role}>{ROLE_LABEL[role] ?? role}</li>
              ))}
            </ul>
          </div>
          <nav className={styles.links} aria-label="Account">
            <Link href="/account" onClick={() => setOpen(false)}>Account settings</Link>
            {isCaptain ? <Link href="/captain" onClick={() => setOpen(false)}>Captain workspace</Link> : null}
            {isOfficial ? <Link href="/official" onClick={() => setOpen(false)}>Official workspace</Link> : null}
            {isCompetitionAdmin ? <Link href="/admin" onClick={() => setOpen(false)}>Administration</Link> : null}
          </nav>
          <button
            type="button"
            className={styles.signOut}
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
