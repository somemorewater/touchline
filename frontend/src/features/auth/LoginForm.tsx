'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api/client';
import { useAuth } from './AuthProvider';
import styles from './AuthForms.module.css';

/** Only allow same-site paths so the login redirect can't be abused. */
function safeReturnTo(value: string | null): string {
  if (!value) return '/';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const returnTo = safeReturnTo(params.get('returnTo'));
  const passwordChanged = params.get('passwordChanged') === '1';

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await login(email.trim(), password);
      router.replace(returnTo);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={styles.card}>
      <h1>Sign in</h1>
      <p className={styles.lead}>
        Sign in to manage your team, report matches or administer a competition.
        Public pages stay available without an account.
      </p>
      {passwordChanged ? (
        <p className="tl-alert tl-alert-success" role="status">
          Your password was changed. Sign in again with your new password.
        </p>
      ) : null}
      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <label className="tl-field">
          <span className="tl-label">Email address</span>
          <input
            className="tl-input"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="tl-field">
          <span className="tl-label">Password</span>
          <input
            className="tl-input"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" className="tl-btn tl-btn-primary" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className={styles.foot}>
        No account yet? <Link href={`/register?returnTo=${encodeURIComponent(returnTo)}`}>Create one</Link>.
      </p>
    </div>
  );
}
