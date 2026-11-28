/** Soccer-ball icon drawn as SVG so it inherits the badge's current colour. */
export function FootballIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 9.4 14.5 11.2 13.5 14.2 10.5 14.2 9.5 11.2Z" />
      <path d="M12 9.4V4.8M14.5 11.2l3.5-1.4M13.5 14.2l1.8 3M10.5 14.2l-1.8 3M9.5 11.2 6 9.8" />
      <path d="M9.7 6.9 12 4.8l2.3 2.1M17.8 10.1l2 2.6M16.9 17.6l-1.8 2.1M7.1 17.6l1.8 2.1M4.2 12.7l2 2.6" />
    </svg>
  );
}
