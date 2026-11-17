'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MatchList } from '@/components/ui/MatchList';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { useMatches } from '@/features/matches/hooks';
import { usePlayers } from '@/features/players/hooks';
import { useStandingsFor } from '@/features/standings/hooks';
import { LeagueTables, RulesNote } from '@/features/standings/StandingsView';
import { useAnnouncements } from '@/features/news/hooks';
import { useTeamEntries } from '@/features/teams/hooks';
import { byKickoff } from '@/lib/match';
import { DISPLAY_TIME_ZONE } from '@/types';
import { FORMAT_LABEL, STATUS_LABEL } from './CompetitionsView';
import { useCompetition, useLeagues, useSeasons } from './hooks';
import styles from './Competitions.module.css';

export function CompetitionDetail({ idOrSlug }: { idOrSlug: string }) {
  const compQ = useCompetition(idOrSlug);
  const competition = compQ.data ?? undefined;
  const seasonsQ = useSeasons(competition?.id);
  const [pickedSeason, setPickedSeason] = useState<string>();
  const seasons = seasonsQ.data ?? [];
  const seasonId =
    pickedSeason ??
    seasons.find((season) => season.status === 'active')?.id ??
    seasons.find((season) => season.status === 'planned')?.id ??
    seasons[0]?.id;

  const leagues = useLeagues(competition?.id, seasonId);
  const entries = useTeamEntries(competition?.id, seasonId);
  const matchesQ = useMatches({ competitionId: competition?.id, seasonId });
  const standings = useStandingsFor(competition, seasonId);
  const news = useAnnouncements(competition?.id);
  const playersQ = usePlayers({ competitionId: competition?.id });
  const teams = useMemo(() => new Map((entries.data ?? []).map((e) => [e.team.id, e.team])), [entries.data]);

  if (compQ.isLoading) return <Skeleton lines={3} height={80} />;
  if (compQ.isError) return <ErrorState onRetry={() => void compQ.refetch()} />;
  if (!competition) return <EmptyState title="Competition not found" action={<Link href="/competitions">All competitions</Link>}>The link may be wrong, or the competition was removed.</EmptyState>;

  const matches = [...(matchesQ.data ?? [])].sort(byKickoff);

  return (
    <>
      <PageHeader
        title={competition.name}
        lead={competition.description}
        aside={seasons.length > 0 ? (
          <label className={styles.seasonPick}>Season
            <select value={seasonId} onChange={(e) => setPickedSeason(e.target.value)} disabled={seasons.length < 2}>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        ) : undefined}
      />
      <Tabs
        label="Competition sections"
        tabs={[
          {
            id: 'overview', label: 'Overview',
            content: (
              <ul className={styles.rules}>
                <li><strong>Format</strong><small>{FORMAT_LABEL[competition.format]}</small></li>
                <li><strong>Status</strong><small>{STATUS_LABEL[competition.status]}</small></li>
                <li><strong>Teams</strong><small>{entries.data?.length ?? 0} registered</small></li>
                <li><strong>Leagues</strong><small>{(leagues.data ?? []).map((l) => l.name).join(', ') || 'None'}</small></li>
              </ul>
            ),
          },
          { id: 'matches', label: 'Matches', content: matches.length ? <MatchList matches={matches} teams={teams} tz={DISPLAY_TIME_ZONE} /> : <EmptyState title="No matches yet">The fixture list has not been published.</EmptyState> },
          { id: 'standings', label: 'Standings', content: standings.isLoading ? <Skeleton lines={2} height={200} /> : <><LeagueTables tables={standings.tables} /><RulesNote metas={standings.metas} /></> },
          {
            id: 'teams', label: 'Teams',
            content: (entries.data ?? []).length ? (
              <ul className={styles.rules}>{entries.data!.map(({ team }) => <li key={team.id}><Link href={`/teams/${team.id}`}>{team.name}</Link></li>)}</ul>
            ) : <EmptyState title="No teams yet">Approved teams are listed here.</EmptyState>,
          },
          {
            id: 'players', label: 'Players',
            content: (playersQ.data ?? []).length ? (
              <ul className={styles.rules}>{playersQ.data!.map((p) => <li key={p.id}><Link href={`/players/${p.id}`}>{p.fullName}</Link><small>{teams.get(p.teamId)?.name}</small></li>)}</ul>
            ) : (
              <EmptyState title="No players registered yet">Approved players appear once captains submit squads. <Link href="/players">Player list</Link></EmptyState>
            ),
          },
          { id: 'stats', label: 'Statistics', content: <p><Link href="/statistics">Open competition statistics</Link></p> },
          { id: 'bracket', label: 'Bracket', content: <EmptyState title="No knockout stage">{FORMAT_LABEL[competition.format]} competitions have no bracket unless a knockout stage is configured by the administrators.</EmptyState> },
          {
            id: 'rules', label: 'Rules',
            content: (
              <ul className={styles.rules}>
                <li>
                  <strong>Points and tie-breakers</strong>
                  <small>
                    The competition server supplies the points system and tie-break order with each standings response.
                    Open <Link href="/standings">standings</Link> to see the exact rules applied.
                  </small>
                </li>
                <li>
                  <strong>Format</strong>
                  <small>{FORMAT_LABEL[competition.format]}. Times are shown in UTC because the competition record carries no time zone.</small>
                </li>
              </ul>
            ),
          },
          {
            id: 'news', label: 'News',
            content: (news.data ?? []).length ? <ul className={styles.rules}>{news.data!.map((a) => <li key={a.id}><Link href={`/news/${a.id}`}>{a.title}</Link></li>)}</ul> : <EmptyState title="No news yet">Announcements for this competition will be posted here.</EmptyState>,
          },
        ]}
      />
    </>
  );
}
