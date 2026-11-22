'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useTeamMap } from '@/features/teams/hooks';
import { positionLabel } from '@/lib/positions';
import { usePlayers } from './hooks';
import styles from './Players.module.css';

export function PlayersView() {
  const { competition, season } = useActiveCompetition();
  const { teams } = useTeamMap(competition?.id, season?.id);
  const q = usePlayers({ competitionId: competition?.id });
  const [text, setText] = useState('');
  const [teamId, setTeamId] = useState('');
  const rows = useMemo(
    () => (q.data ?? []).filter((p) => (!teamId || p.teamId === teamId) && (!text.trim() || p.fullName.toLowerCase().includes(text.trim().toLowerCase()))),
    [q.data, text, teamId],
  );

  return (
    <>
      <PageHeader title="Players" lead="Approved players in the competition." />
      <div className={styles.controls}>
        <label>Search<input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Player name" /></label>
        <label>Team
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">All teams</option>
            {[...teams.values()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>
      {q.isLoading ? <Skeleton lines={5} /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        (q.data ?? []).length === 0 ? (
          <EmptyState title="No players registered yet">Captains register their squads, and players appear here once an administrator approves them.</EmptyState>
        ) : (
          <EmptyState title="No players match">Try a different name or team.</EmptyState>
        )
      ) : (
        <ul className={styles.list}>
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={`/players/${p.id}`}>
                <span className="num">{p.shirtNumber ?? '–'}</span>
                <strong>{p.fullName}</strong>
                <span>{teams.get(p.teamId)?.name}</span>
                <span>{positionLabel(p.position) ?? 'Position not set'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
