import type { Services, SearchResult } from '../contracts';
import { store } from './store';

const norm = (s: string) => s.toLowerCase();

export const mockServices: Services = {
  competitions: {
    list: async () => store.competitions,
    get: async (k) => store.competitions.find((c) => c.id === k || c.slug === k) ?? null,
    listSeasons: async (id) => store.seasons.filter((s) => s.competitionId === id),
    listLeagues: async (id, seasonId) => store.leagues.filter((l) => l.competitionId === id && l.seasonId === seasonId),
  },
  teams: {
    listEntries: async ({ competitionId, seasonId }) =>
      store.registrations
        .filter((r) => r.competitionId === competitionId && r.seasonId === seasonId)
        .flatMap((registration) => {
          const team = store.teams.find((t) => t.id === registration.teamId);
          return team ? [{ team, registration }] : [];
        }),
    get: async (teamId) => {
      const team = store.teams.find((t) => t.id === teamId);
      const registration = store.registrations.find((r) => r.teamId === teamId);
      return team && registration ? { team, registration } : null;
    },
    statistics: async ({ competitionId, seasonId }) =>
      store.teamStatistics.filter((s) => s.competitionId === competitionId && s.seasonId === seasonId),
  },
  players: {
    list: async ({ teamId }) => store.players.filter((p) => !teamId || p.teamId === teamId),
    get: async (id) => store.players.find((p) => p.id === id) ?? null,
    statistics: async ({ competitionId, seasonId }) =>
      store.playerStatistics.filter((s) => s.competitionId === competitionId && s.seasonId === seasonId),
  },
  matches: {
    list: async ({ competitionId, seasonId, teamId, leagueId }) =>
      store.matches.filter(
        (m) =>
          m.competitionId === competitionId &&
          m.seasonId === seasonId &&
          (!leagueId || m.leagueId === leagueId) &&
          (!teamId || m.homeTeamId === teamId || m.awayTeamId === teamId),
      ),
    get: async (id) => {
      const match = store.matches.find((m) => m.id === id);
      if (!match) return null;
      return {
        match,
        events: store.events.filter((e) => e.matchId === id),
        lineups: store.lineups.filter((l) => l.matchId === id),
        statistics: store.matchStatistics.find((s) => s.matchId === id),
        report: store.reports.find((r) => r.matchId === id),
      };
    },
  },
  announcements: {
    list: async ({ competitionId }) =>
      store.announcements.filter((a) => a.status === 'published' && (!competitionId || a.competitionId === competitionId)),
    get: async (id) => store.announcements.find((a) => a.id === id && a.status === 'published') ?? null,
  },
  search: {
    search: async (query) => {
      const q = norm(query.trim());
      if (!q) return [];
      const teamName = (id: string) => store.teams.find((t) => t.id === id)?.name ?? id;
      const out: SearchResult[] = [];
      for (const c of store.competitions)
        if (norm(c.name).includes(q)) out.push({ kind: 'competition', id: c.id, title: c.name, subtitle: 'Competition', href: `/competitions/${c.slug}` });
      for (const t of store.teams)
        if (norm(t.name).includes(q)) out.push({ kind: 'team', id: t.id, title: t.name, subtitle: 'Team', href: `/teams/${t.id}` });
      for (const p of store.players)
        if (norm(p.fullName).includes(q)) out.push({ kind: 'player', id: p.id, title: p.fullName, subtitle: teamName(p.teamId), href: `/players/${p.id}` });
      for (const m of store.matches) {
        const title = `${teamName(m.homeTeamId)} v ${teamName(m.awayTeamId)}`;
        if (norm(title).includes(q)) out.push({ kind: 'match', id: m.id, title, subtitle: 'Match', href: `/matches/${m.id}` });
      }
      for (const a of store.announcements)
        if (a.status === 'published' && norm(a.title).includes(q)) out.push({ kind: 'article', id: a.id, title: a.title, subtitle: 'News', href: `/news/${a.id}` });
      return out.slice(0, 20);
    },
  },
};
