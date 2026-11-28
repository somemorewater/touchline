'use client';

import { useEffect, useState } from 'react';

export interface ClockSource {
  status: string;
  clockRunningAt?: string | null;
  clockAccumulatedSeconds?: number;
  addedMinutes?: number | null;
  currentMinute?: number | null;
}

/** Derives elapsed seconds from authoritative server timestamps, not local counting. */
export function clockSeconds(source: ClockSource, now: number): number {
  const base = source.clockAccumulatedSeconds ?? (source.currentMinute ?? 0) * 60;
  const running = source.clockRunningAt
    ? Math.max(0, Math.floor((now - Date.parse(source.clockRunningAt)) / 1000))
    : 0;
  const added = (source.addedMinutes ?? 0) * 60;
  return base + running + added;
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** Animates the display once a second; the source of truth stays on the server. */
export function useMatchClock(source: ClockSource): number {
  const [now, setNow] = useState(() => Date.now());
  const runningAt = source.clockRunningAt ?? null;
  const accumulated = source.clockAccumulatedSeconds;

  useEffect(() => {
    setNow(Date.now());
    if (!runningAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runningAt, accumulated]);

  return clockSeconds(source, now);
}
