import type { LeaderboardRow } from '@/components/ui/Leaderboard';
import type { Player, PlayerStatistics, Team } from '@/types';

export type PlayerMetric =
  | 'goals'
  | 'appearances'
  | 'yellowCards'
  | 'redCards'
  | 'cleanSheets';

export function buildLeaderboard(
  statistics: PlayerStatistics[],
  players: Map<string, Player>,
  teams: Map<string, Team>,
  metric: PlayerMetric,
  limit = 5,
): LeaderboardRow[] {
  const rows: LeaderboardRow[] = [];
  for (const stats of statistics) {
    const measured = stats[metric];
    if (!measured || measured.state !== 'known' || measured.value <= 0) continue;
    const player = players.get(stats.playerId);
    if (!player) continue;
    rows.push({
      id: player.id,
      name: player.fullName,
      detail: teams.get(player.teamId)?.name,
      value: measured.value,
      href: `/players/${player.id}`,
    });
  }
  return rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, limit);
}
