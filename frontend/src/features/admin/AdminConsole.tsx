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
  const { user, isSuperAdmin, hasRole, can, canIn } = useAuth();
  const { competition, season } = useActiveCompetition();

  if (!isSuperAdmin && !hasRole('competition_admin')) {
    return (
      <EmptyState title="Administration is not available to your account">
        Competition administration requires a competition administrator or super administrator role.
        The server enforces the same rule even if this page is opened directly.
      </EmptyState>
    );
  }

  const visibleFor = (...permissions: string[]) =>
    isSuperAdmin || permissions.some((permission) =>
      can(permission) || (competition ? canIn(permission, competition.id) : false),
    );
  const tabs = [
    { id: 'overview', label: 'Overview', content: <AdminOverview /> },
    ...(visibleFor('competitions.read', 'competitions.create', 'competitions.update')
      ? [{ id: 'competitions', label: 'Competition Management', content: <AdminCompetitions /> }]
      : []),
    ...(visibleFor('teams.read', 'teams.manage', 'captains.manage')
      ? [{ id: 'teams', label: 'Team Management', content: <AdminTeams section="teams" /> }]
      : []),
    ...(visibleFor('players.read', 'players.manage', 'registrations.review')
      ? [{ id: 'players', label: 'Player Management', content: <AdminTeams section="players" /> }]
      : []),
    ...(visibleFor('fixtures.read', 'fixtures.manage', 'matches.read', 'matches.manage', 'lineups.read', 'lineups.manage')
      ? [{ id: 'matches', label: 'Match Management', content: <AdminMatchOps /> }]
      : []),
    ...(visibleFor('users.read', 'users.manage', 'roles.manage')
      ? [{ id: 'users', label: 'User Management', content: <AdminPeople section="users" /> }]
      : []),
    ...(visibleFor('announcements.manage')
      ? [{ id: 'announcements', label: 'Announcements', content: <AdminPeople section="announcements" /> }]
      : []),
    ...(visibleFor('audit.read')
      ? [{ id: 'audit', label: 'Audit Logs', content: <AdminPeople section="audit" /> }]
      : []),
    ...(visibleFor('disciplinary.manage', 'disputes.manage')
      ? [{ id: 'governance', label: 'Cases and Disputes', content: <AdminGovernance /> }]
      : []),
  ];

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
        tabs={tabs}
      />
      <p className={styles.muted}>
        Signed in as {user?.displayName}. Competition scope limits what each section can change; the server rejects anything outside it.
      </p>
    </>
  );
}
