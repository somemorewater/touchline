import type {
  Announcement, AuditLog, Competition, DisciplinaryCase, Id, League, Match, MatchEvent, MatchLineup,
  MatchReport, MatchStatistics, Player, PlayerStatistics, Protest, Season, Suspension, Team,
  TeamRegistration, TeamStatistics, User,
} from '@/types';

export interface TeamEntry {
  team: Team;
  registration: TeamRegistration;
}

export interface MatchDetail {
  match: Match;
  events: MatchEvent[];
  lineups: MatchLineup[];
  statistics?: MatchStatistics;
  report?: MatchReport;
}

export interface SearchResult {
  kind: 'competition' | 'team' | 'player' | 'match' | 'article';
  id: Id;
  title: string;
  subtitle?: string;
  href: string;
}

/* ---------- Implemented against mock data in this phase ---------- */

export interface CompetitionService {
  list(): Promise<Competition[]>;
  get(idOrSlug: string): Promise<Competition | null>;
  listSeasons(competitionId: Id): Promise<Season[]>;
  listLeagues(competitionId: Id, seasonId: Id): Promise<League[]>;
}

export interface TeamService {
  listEntries(q: { competitionId: Id; seasonId: Id }): Promise<TeamEntry[]>;
  get(teamId: Id): Promise<TeamEntry | null>;
  statistics(q: { competitionId: Id; seasonId: Id }): Promise<TeamStatistics[]>;
}

export interface PlayerService {
  list(q: { teamId?: Id; competitionId?: Id }): Promise<Player[]>;
  get(playerId: Id): Promise<Player | null>;
  statistics(q: { competitionId: Id; seasonId: Id }): Promise<PlayerStatistics[]>;
}

export interface MatchService {
  list(q: { competitionId: Id; seasonId: Id; teamId?: Id; leagueId?: Id }): Promise<Match[]>;
  get(matchId: Id): Promise<MatchDetail | null>;
}

export interface AnnouncementService {
  list(q: { competitionId?: Id }): Promise<Announcement[]>;
  get(id: Id): Promise<Announcement | null>;
}

export interface SearchService {
  search(query: string): Promise<SearchResult[]>;
}

/* ---------- Contracts only: no implementation yet (later phases) ---------- */

export interface AuthService {
  currentUser(): Promise<User | null>;
  signIn(email: string, password: string): Promise<User>;
  signOut(): Promise<void>;
}

export interface RegistrationService {
  submitTeam(input: unknown): Promise<TeamRegistration>;
  submitPlayer(input: unknown): Promise<void>;
}

export interface FixtureService {
  preview(input: { competitionId: Id; leagueId: Id; doubleRound: boolean }): Promise<Match[]>;
  publish(fixtureIds: Id[]): Promise<void>;
}

export interface DisciplinaryService {
  listCases(q: { competitionId: Id }): Promise<DisciplinaryCase[]>;
  listSuspensions(q: { competitionId: Id }): Promise<Suspension[]>;
}

export interface DisputeService {
  list(q: { competitionId: Id; teamId?: Id }): Promise<Protest[]>;
}

export interface AuditService {
  list(q: { competitionId?: Id }): Promise<AuditLog[]>;
}

export interface Services {
  competitions: CompetitionService;
  teams: TeamService;
  players: PlayerService;
  matches: MatchService;
  announcements: AnnouncementService;
  search: SearchService;
}
