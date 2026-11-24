'use client';

import { useRef, useEffect } from 'react';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  busy = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [open]);

  const handleClose = () => {
    if (!busy) onClose();
  };

  const handleConfirm = () => {
    if (!busy) onConfirm();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) handleClose();
      }}
    >
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); handleConfirm(); }}>
        <header className={styles.header}>
          <h3>{title}</h3>
          <button
            type="button"
            className={styles.closeButton}
            onClick={handleClose}
            disabled={busy}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <p className={styles.message}>{message}</p>
        <footer className={styles.actions}>
          <button type="button" className="tl-btn" onClick={handleClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={`tl-btn ${isDestructive ? 'tl-btn-danger' : 'tl-btn-primary'}`}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}