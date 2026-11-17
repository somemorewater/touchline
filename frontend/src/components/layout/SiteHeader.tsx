'use client';

import { CalendarDays, Home, Newspaper, Shield, Trophy } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AccountMenu } from '@/features/auth/AccountMenu';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { NotificationsMenu } from '@/features/notifications/NotificationsMenu';
import { SearchButton } from './SearchDialog';
import { ThemeToggle } from './ThemeToggle';
import styles from './SiteHeader.module.css';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/matches', label: 'Matches' },
  { href: '/competitions', label: 'Competitions' },
  { href: '/teams', label: 'Teams' },
  { href: '/players', label: 'Players' },
  { href: '/standings', label: 'Standings' },
  { href: '/statistics', label: 'Statistics' },
  { href: '/news', label: 'News' },
] as const;

const MOBILE_NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/matches', label: 'Matches', icon: CalendarDays },
  { href: '/teams', label: 'Teams', icon: Shield },
  { href: '/standings', label: 'Standings', icon: Trophy },
  { href: '/news', label: 'News', icon: Newspaper },
] as const;

export function SiteHeader() {
  const path = usePathname();
  const { competitions, competition, seasons, season, selectCompetition, selectSeason } = useActiveCompetition();

  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand} aria-label="TOUCHLINE home">
            <span className={styles.mark} aria-hidden>T</span>
            <span className={styles.word}>TOUCHLINE</span>
          </Link>
          <nav className={styles.nav} aria-label="Main">
            <ul id="main-nav">
              {NAV.map((n) => (
                <li key={n.href}><Link href={n.href} aria-current={isActive(n.href) ? 'page' : undefined}>{n.label}</Link></li>
              ))}
            </ul>
          </nav>
          <div className={styles.tools}>
            <SearchButton />
            <ThemeToggle />
            <NotificationsMenu />
            <AccountMenu />
          </div>
        </div>
      </header>
      {competition ? (
        <div className={styles.context}>
          <div className={styles.contextInner}>
            <label className={styles.sel}>
              <span className="sr-only">Competition</span>
              <select value={competition.id} onChange={(e) => selectCompetition(e.target.value)}>
                {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className={styles.sel}>
              <span className="sr-only">Season</span>
              <select value={season?.id ?? ''} onChange={(e) => selectSeason(e.target.value)} disabled={seasons.length < 2}>
                {seasons.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
        </div>
      ) : null}
      <nav className={styles.mobileDock} aria-label="Quick navigation">
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={styles.dockLink} aria-current={isActive(href) ? 'page' : undefined}>
            <Icon size={21} strokeWidth={1.9} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
