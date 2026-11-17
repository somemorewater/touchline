'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/api/client';
import styles from './Admin.module.css';

/** Shared async-action state so every admin form has the same feedback. */
export function useAdminAction() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async (key: string, action: () => Promise<string | void>) => {
    setPending(key);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  }, []);

  return { pending, error, notice, setError, setNotice, run };
}

export function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}
      {notice ? <p className="tl-alert tl-alert-success" role="status">{notice}</p> : null}
    </>
  );
}

export function AdminSection({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <div>
          <h2>{title}</h2>
          {description ? <p className="tl-muted">{description}</p> : null}
        </div>
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="tl-field">
      <span className="tl-label">{label}</span>
      {children}
      {hint ? <span className="tl-muted">{hint}</span> : null}
    </label>
  );
}

export function statusLabel(value: string | null | undefined): string {
  if (!value) return 'Not set';
  return value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}
