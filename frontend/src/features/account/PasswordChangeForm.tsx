'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api/client';
import { useAuth } from '@/features/auth/AuthProvider';
import styles from './Account.module.css';

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

type Field = 'currentPassword' | 'newPassword' | 'confirmPassword';
type FieldErrors = Partial<Record<Field, string>>;

const EMPTY_VALUES: Record<Field, string> = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

function validate(values: Record<Field, string>): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.currentPassword) {
    errors.currentPassword = 'Enter your current password.';
  }
  if (!values.newPassword) {
    errors.newPassword = 'Enter a new password.';
  } else if (values.newPassword.length < MIN_PASSWORD) {
    errors.newPassword = `Use at least ${MIN_PASSWORD} characters.`;
  } else if (values.newPassword.length > MAX_PASSWORD) {
    errors.newPassword = `Use at most ${MAX_PASSWORD} characters.`;
  } else if (values.newPassword === values.currentPassword) {
    errors.newPassword = 'Choose a password different from your current one.';
  }
  if (!values.confirmPassword) {
    errors.confirmPassword = 'Confirm your new password.';
  } else if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return errors;
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error?: string;
  visible: boolean;
  disabled: boolean;
  onChange(value: string): void;
  onToggle(): void;
}

function PasswordField({
  id,
  label,
  value,
  autoComplete,
  hint,
  error,
  visible,
  disabled,
  onChange,
  onToggle,
}: PasswordFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="tl-field">
      <label className="tl-label" htmlFor={id}>{label}</label>
      <div className={styles.passwordControl}>
        <input
          id={id}
          className={`tl-input ${styles.passwordInput}`}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          minLength={MIN_PASSWORD}
          maxLength={MAX_PASSWORD}
          required
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        <button
          type="button"
          className={`tl-btn tl-btn-ghost tl-btn-sm ${styles.reveal}`}
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={visible}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
      {hint ? <span id={hintId} className="tl-muted">{hint}</span> : null}
      {error ? <span id={errorId} className={styles.fieldError}>{error}</span> : null}
    </div>
  );
}

/**
 * Password change form.
 *
 * Passwords stay in component state only. Nothing is written to browser
 * storage or logged, and the whole form is discarded after a successful
 * change because the auth provider clears the session.
 */
export function PasswordChangeForm() {
  const router = useRouter();
  const { changePassword } = useAuth();
  const baseId = useId();
  const [values, setValues] = useState<Record<Field, string>>(EMPTY_VALUES);
  const [visible, setVisible] = useState<Record<Field, boolean>>({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const update = (field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setError(null);
  };

  const toggle = (field: Field) => {
    setVisible((current) => ({ ...current, [field]: !current[field] }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const nextErrors = validate(values);
    setErrors(nextErrors);
    setError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);
    try {
      await changePassword(values);
      router.replace('/login?returnTo=%2Faccount&passwordChanged=1');
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <form className={styles.passwordForm} onSubmit={onSubmit} noValidate>
      <p className="tl-muted">
        Use at least {MIN_PASSWORD} characters. Changing your password signs you out of every device.
      </p>

      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}

      <PasswordField
        id={`${baseId}-current`}
        label="Current password"
        value={values.currentPassword}
        autoComplete="current-password"
        error={errors.currentPassword}
        visible={visible.currentPassword}
        disabled={pending}
        onChange={(value) => update('currentPassword', value)}
        onToggle={() => toggle('currentPassword')}
      />
      <PasswordField
        id={`${baseId}-new`}
        label="New password"
        value={values.newPassword}
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD} characters.`}
        error={errors.newPassword}
        visible={visible.newPassword}
        disabled={pending}
        onChange={(value) => update('newPassword', value)}
        onToggle={() => toggle('newPassword')}
      />
      <PasswordField
        id={`${baseId}-confirm`}
        label="Confirm new password"
        value={values.confirmPassword}
        autoComplete="new-password"
        error={errors.confirmPassword}
        visible={visible.confirmPassword}
        disabled={pending}
        onChange={(value) => update('confirmPassword', value)}
        onToggle={() => toggle('confirmPassword')}
      />

      <div className={styles.formActions}>
        <button type="submit" className="tl-btn tl-btn-primary" disabled={pending}>
          {pending ? 'Changing password…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
