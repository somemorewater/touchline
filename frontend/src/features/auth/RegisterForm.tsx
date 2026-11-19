'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api/client';
import { useAuth } from './AuthProvider';
import styles from './AuthForms.module.css';

function safeReturnTo(value: string | null): string {
  if (!value) return '/account';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/account';
}

const MIN_PASSWORD = 8;

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const returnTo = safeReturnTo(params.get('returnTo'));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setPending(true);
    try {
      await register({ email: email.trim(), password, displayName: displayName.trim() });
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
      <h1>Create an account</h1>
      <p className={styles.lead}>
        New accounts start with the registered-user role. Competition roles such as
        captain, official or administrator are granted by the competition staff.
      </p>
      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <label className="tl-field">
          <span className="tl-label">Display name</span>
          <input
            className="tl-input"
            type="text"
            name="displayName"
            autoComplete="name"
            required
            minLength={2}
            maxLength={160}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
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
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="tl-muted">At least {MIN_PASSWORD} characters.</span>
        </label>
        <label className="tl-field">
          <span className="tl-label">Confirm password</span>
          <input
            className="tl-input"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
        <button type="submit" className="tl-btn tl-btn-primary" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className={styles.foot}>
        Already registered? <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link>.
      </p>
    </div>
  );
}
