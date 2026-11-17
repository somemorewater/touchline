'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { errorMessage } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';
import { DISPLAY_TIME_ZONE } from '@/types';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from './hooks';
import styles from './NotificationsMenu.module.css';

export function NotificationsMenu() {
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  const unread = useUnreadNotificationCount(signedIn);
  const list = useNotifications(signedIn && open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

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

  if (!signedIn) return null;

  const count = unread.data?.unread ?? 0;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bell}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} aria-hidden />
        {count > 0 ? <span className={styles.count} aria-hidden>{count > 99 ? '99+' : count}</span> : null}
      </button>

      {open ? (
        <div className={styles.panel} id={panelId} role="region" aria-label="Notifications">
          <header className={styles.head}>
            <strong>Notifications</strong>
            {count > 0 ? (
              <button
                type="button"
                className="tl-btn tl-btn-sm tl-btn-ghost"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
              >
                <CheckCheck size={14} aria-hidden /> Mark all read
              </button>
            ) : null}
          </header>

          {list.isLoading ? <p className={styles.note}>Loading…</p> : list.isError ? (
            <p className={styles.error}>{errorMessage(list.error)}</p>
          ) : (list.data?.items.length ?? 0) === 0 ? (
            <p className={styles.note}>No notifications yet. In-app notices arrive when an announcement or decision affects you.</p>
          ) : (
            <ul className={styles.list}>
              {list.data!.items.map((item) => (
                <li key={item.id} className={item.readAt ? styles.read : styles.unread}>
                  <div className={styles.itemHead}>
                    <strong>{item.title}</strong>
                    <time dateTime={item.createdAt}>{formatDateTime(item.createdAt, DISPLAY_TIME_ZONE)}</time>
                  </div>
                  <p>{item.body}</p>
                  {!item.readAt ? (
                    <button
                      type="button"
                      className="tl-btn tl-btn-sm tl-btn-ghost"
                      onClick={() => markRead.mutate(item.id)}
                      disabled={markRead.isPending}
                    >
                      Mark read
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {markAll.isError ? <p className={styles.error}>{errorMessage(markAll.error)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
