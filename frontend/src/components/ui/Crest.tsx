import { initials } from '@/lib/format';

const PALETTE = ['#1f5b3a', '#244f7a', '#7a2f3b', '#6a4a1a', '#3f3a78', '#1d6a6a', '#5b5b1f', '#5a2f6a'];

function pick(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Placeholder crest until a team uploads its own: a shield with the team initials. */
export function Crest({ name, size = 32 }: { name: string; size?: number }) {
  const label = initials(name);
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 40 44" role="img" aria-label={`${name} crest`} focusable="false">
      <path d="M20 1.5 37 6v15c0 11-7.6 18.2-17 21.5C10.600 39.200 3 32 3 21V6z" fill={pick(name)} stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />
      <text x="20" y="25.500" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize={label.length > 2 ? 11 : 14} fill="#fff">
        {label}
      </text>
    </svg>
  );
}
