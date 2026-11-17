const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, ...opts });
    cache.set(key, f);
  }
  return f;
}

/** Fixed time zone so server and client render identical text (no hydration mismatch). */
export function formatDay(iso: string | undefined, tz: string): string {
  if (!iso) return 'Date to be confirmed';
  return fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function formatTime(iso: string | undefined, tz: string): string {
  if (!iso) return 'Time to be confirmed';
  return fmt(tz, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function formatDateTime(iso: string | undefined, tz: string): string {
  if (!iso) return 'Date to be confirmed';
  return `${formatDay(iso, tz)}, ${formatTime(iso, tz)}`;
}

export function dayKey(iso: string | undefined, tz: string): string {
  if (!iso) return 'tbc';
  return fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9/ ]/g, '').split(/[ /]+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
