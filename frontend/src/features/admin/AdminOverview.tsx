'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Database, Flag, Users } from 'lucide-react';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { adminApi } from '@/lib/api/endpoints';
import { AdminSection, statusLabel } from './ui';
import styles from './Admin.module.css';

function Counts({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <p className={styles.muted}>Nothing recorded yet.</p>;
  return (
    <ul className={styles.countList}>
      {entries.map(([key, value]) => (
        <li key={key}>
          <span>{statusLabel(key)}</span>
          <strong className="num">{value}</strong>
        </li>
      ))}
    </ul>
  );
}

export function AdminOverview() {
  const { competition, season } = useActiveCompetition();
  const q = useQuery({
    queryKey: ['admin-overview', competition?.id, season?.id],
    queryFn: () => adminApi.overview(competition!.id, season?.id),
    enabled: Boolean(competition),
  });

  if (!competition) {
    return <p className={styles.muted}>Select a competition to see its operational overview.</p>;
  }
  if (q.isLoading) return <Skeleton lines={3} height={90} />;
  if (q.isError || !q.data) {
    return <ErrorState title="Could not load the overview" onRetry={() => void q.refetch()} />;
  }

  const overview = q.data;

  return (
    <AdminSection
      title="Operational overview"
      description={`${overview.competition.name}${season ? ` · ${season.label}` : ''}. Counts come from the server; nothing here is estimated.`}
    >
      {overview.warnings.length > 0 ? (
        <div className={styles.warnings}>
          {overview.warnings.map((warning) => (
            <p key={warning} className={styles.warning}>
              <AlertTriangle size={15} aria-hidden /> {warning}
            </p>
          ))}
        </div>
      ) : (
        <p className="tl-alert tl-alert-success">No operational warnings are reported for this scope.</p>
      )}

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span>Pending player registrations</span>
          <strong className="num">{overview.operational.pendingRegistrations}</strong>
        </div>
        <div className={styles.metric}>
          <span>Unconfirmed full-time results</span>
          <strong className="num">{overview.operational.fullTimeUnconfirmed}</strong>
        </div>
        <div className={styles.metric}>
          <span>Overdue scheduled fixtures</span>
          <strong className="num">{overview.operational.overdueScheduledFixtures}</strong>
        </div>
        <div className={styles.metric}>
          <span>Upcoming matches without lineups</span>
          <strong className="num">{overview.operational.upcomingMatchesWithoutLineups}</strong>
        </div>
        <div className={styles.metric}>
          <span>Current standings snapshots</span>
          <strong className="num">{overview.standings.currentSnapshots}</strong>
        </div>
      </div>

      <div className="tl-grid">
        <div className={styles.detail}>
          <h3><Users size={15} aria-hidden /> Team entries</h3>
          <Counts counts={overview.teams} />
        </div>
        <div className={styles.detail}>
          <h3><Users size={15} aria-hidden /> Player registrations</h3>
          <Counts counts={overview.playerRegistrations} />
        </div>
        <div className={styles.detail}>
          <h3><Flag size={15} aria-hidden /> Fixtures</h3>
          <Counts counts={overview.fixtures} />
        </div>
        <div className={styles.detail}>
          <h3><Database size={15} aria-hidden /> Matches</h3>
          <Counts counts={overview.matches} />
        </div>
        <div className={styles.detail}>
          <h3><Database size={15} aria-hidden /> Lineups</h3>
          <Counts counts={overview.lineups} />
        </div>
      </div>
    </AdminSection>
  );
}
