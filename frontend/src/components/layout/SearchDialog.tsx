'use client';

import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { services } from '@/services';
import styles from './SearchDialog.module.css';

const KIND_LABEL = { competition: 'Competitions', team: 'Teams', player: 'Players', match: 'Matches', article: 'News' } as const;
const KINDS = Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[];

export function SearchButton() {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  const open = () => { ref.current?.showModal(); input.current?.focus(); };
  const close = () => { ref.current?.close(); setQ(''); };

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); open(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useQuery({ queryKey: ['search', debounced], queryFn: () => services.search.search(debounced), enabled: debounced.length > 0 });

  const focusFirst = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); list.current?.querySelector<HTMLAnchorElement>('a')?.focus(); }
  };
  const moveInList = (e: React.KeyboardEvent) => {
    const links = [...(list.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); links[Math.min(i + 1, links.length - 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) input.current?.focus(); else links[i - 1]?.focus(); }
  };

  const data = results.data ?? [];
  return (
    <>
      <button type="button" className={styles.trigger} onClick={open} aria-label="Search" aria-keyshortcuts="Control+K Meta+K /">
        <Search size={16} aria-hidden /><span className={styles.triggerText}>Search</span>
      </button>
      <dialog ref={ref} className={styles.dialog} aria-label="Search TOUCHLINE" onClose={() => setQ('')} onClick={(e) => { if (e.target === ref.current) close(); }}>
        <div className={styles.box}>
          <div className={styles.field}>
            <Search size={18} aria-hidden />
            <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={focusFirst} placeholder="Search teams, players, matches, news" aria-label="Search" autoComplete="off" />
            <button type="button" onClick={close} aria-label="Close search" className={styles.close}><X size={18} aria-hidden /></button>
          </div>
          <div ref={list} onKeyDown={moveInList} className={styles.results} aria-live="polite">
            {debounced.length === 0 ? <p className={styles.hint}>Type a team name, player, or fixture.</p> : null}
            {debounced.length > 0 && !results.isLoading && data.length === 0 ? <p className={styles.hint}>Nothing matches “{debounced}”. Check the spelling or try a shorter name.</p> : null}
            {KINDS.map((k) => {
              const group = data.filter((r) => r.kind === k);
              if (group.length === 0) return null;
              return (
                <section key={k}>
                  <h2>{KIND_LABEL[k]}</h2>
                  <ul>
                    {group.map((r) => (
                      <li key={`${r.kind}-${r.id}`}>
                        <Link href={r.href} onClick={close}><span>{r.title}</span>{r.subtitle ? <small>{r.subtitle}</small> : null}</Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </dialog>
    </>
  );
}
