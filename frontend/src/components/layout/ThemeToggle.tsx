'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { THEME_KEY } from '@/lib/theme-script';
import styles from './ThemeToggle.module.css';

type Pref = 'light' | 'dark' | 'system';

function apply(p: Pref) {
  const dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [pref, setPref] = useState<Pref>('system');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') setPref(saved);
    } catch { /* preference only */ }
  }, []);

  useEffect(() => {
    if (pref !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const choose = (p: Pref) => {
    setPref(p);
    apply(p);
    try { localStorage.setItem(THEME_KEY, p); } catch { /* preference only */ }
  };

  const opts: { value: Pref; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light theme', icon: <Sun size={16} aria-hidden /> },
    { value: 'dark', label: 'Dark theme', icon: <Moon size={16} aria-hidden /> },
    { value: 'system', label: 'Match system theme', icon: <Monitor size={16} aria-hidden /> },
  ];
  return (
    <div className={styles.group} role="group" aria-label="Theme">
      {opts.map((o) => (
        <button key={o.value} type="button" className={styles.btn} aria-pressed={pref === o.value} aria-label={o.label} title={o.label} onClick={() => choose(o.value)}>
          {o.icon}
        </button>
      ))}
    </div>
  );
}
