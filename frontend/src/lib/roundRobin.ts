export interface Pairing {
  round: number;
  homeId: string;
  awayId: string;
}

/**
 * Circle-method round robin. Home/away alternates by round so no team is stuck at one end.
 * `doubleRound` appends the reverse fixtures after the first half of the season.
 * Never returns a self-pairing or a repeated pairing within one cycle.
 */
export function roundRobin(teamIds: string[], doubleRound = false): Pairing[] {
  const ids = [...new Set(teamIds)];
  if (ids.length < 2) return [];
  const slots: (string | null)[] = ids.length % 2 === 0 ? [...ids] : [...ids, null];
  const n = slots.length;
  const rounds = n - 1;
  const out: Pairing[] = [];

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = slots[i] ?? null;
      const b = slots[n - 1 - i] ?? null;
      if (a === null || b === null) continue;
      const flip = (r + i) % 2 === 1;
      out.push({ round: r + 1, homeId: flip ? b : a, awayId: flip ? a : b });
    }
    // rotate everything except the first slot
    const last = slots.pop() ?? null;
    slots.splice(1, 0, last);
  }

  if (doubleRound) {
    const reverse = out.map((p) => ({ round: p.round + rounds, homeId: p.awayId, awayId: p.homeId }));
    return [...out, ...reverse];
  }
  return out;
}
