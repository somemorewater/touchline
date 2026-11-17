'use client';

import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useAuth } from '@/features/auth/AuthProvider';
import { AdminCompetitions } from './AdminCompetitions';
import { AdminGovernance } from './AdminGovernance';
import { AdminMatchOps } from './AdminMatchOps';
import { AdminOverview } from './AdminOverview';
import { AdminPeople } from './AdminPeople';
import { AdminTeams } from './AdminTeams';
import styles from './Admin.module.css';

export function AdminConsole() {
  const { user, isSuperAdmin, hasRole } = useAuth();
  const { competition, season } = useActiveCompetition();

  if (!isSuperAdmin && !hasRole('competition_admin')) {
    return (
      <EmptyState title="Administration is not available to your account">
        Competition administration requires a competition administrator or super administrator role.
        The server enforces the same rule even if this page is opened directly.
      </EmptyState>
    );
  }

  return (
    <>
      <PageHeader
        title="Administration"
        lead={
          competition
            ? `${competition.name}${season ? ` · ${season.label}` : ''}. Every action is checked again by the server against your competition scope.`
            : 'Create or select a competition to administer it. Actions are checked again by the server.'
        }
        aside={<span className="tl-badge">{isSuperAdmin ? 'Super administrator' : 'Competition administrator'}</span>}
      />
      {!competition ? (
        <EmptyState title="No competition selected">
          Use the competition selector in the header, or create the first competition under the Competitions tab.
        </EmptyState>
      ) : null}

      <Tabs
        label="Administration sections"
        tabs={[
          { id: 'overview', label: 'Overview', content: <AdminOverview /> },
          { id: 'competitions', label: 'Competitions', content: <AdminCompetitions /> },
          { id: 'teams', label: 'Teams & players', content: <AdminTeams /> },
          { id: 'fixtures', label: 'Fixtures & matches', content: <AdminMatchOps /> },
          { id: 'governance', label: 'Cases & notices', content: <AdminGovernance /> },
          { id: 'people', label: 'Users & audit', content: <AdminPeople /> },
        ]}
      />
      <p className={styles.muted}>
        Signed in as {user?.displayName}. Competition scope limits what each section can change; the server rejects anything outside it.
      </p>
    </>
  );
}
