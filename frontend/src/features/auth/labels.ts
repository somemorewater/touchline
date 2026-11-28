/** Human labels for the backend's exact role names. */
export const ROLE_LABEL: Record<string, string> = {
  visitor: 'Visitor',
  registered_user: 'Registered user',
  team_captain: 'Team captain',
  match_official: 'Match official',
  commentary_operator: 'Match operator',
  competition_admin: 'Competition administrator',
  super_admin: 'Super administrator',
};

/** Human labels for the permissions the UI gates on. */
export const PERMISSION_LABEL: Record<string, string> = {
  'users.read': 'View users',
  'users.manage': 'Manage users',
  'roles.manage': 'Manage roles',
  'competitions.read': 'View competitions',
  'competitions.create': 'Create competitions',
  'competitions.update': 'Edit competitions',
  'competitions.publish': 'Publish competitions',
  'teams.read': 'View teams',
  'teams.manage': 'Manage teams',
  'captains.manage': 'Assign captains',
  'players.read': 'View players',
  'players.manage': 'Manage players',
  'registrations.review': 'Review registrations',
  'fixtures.read': 'View fixtures',
  'fixtures.manage': 'Manage fixtures',
  'matches.read': 'View matches',
  'matches.report': 'Report match results',
  'matches.manage': 'Manage matches',
  'lineups.read': 'View lineups',
  'lineups.manage': 'Manage lineups',
  'standings.read': 'View standings',
  'standings.manage': 'Manage standings snapshots',
  'disciplinary.manage': 'Manage disciplinary cases',
  'disputes.manage': 'Manage disputes',
  'disputes.submit': 'Submit disputes',
  'announcements.manage': 'Manage announcements',
  'audit.read': 'Read audit logs',
  'notifications.read': 'Read notifications',
};

export const permissionLabel = (key: string): string => PERMISSION_LABEL[key] ?? key;
export const roleLabel = (role: string): string => ROLE_LABEL[role] ?? role;
