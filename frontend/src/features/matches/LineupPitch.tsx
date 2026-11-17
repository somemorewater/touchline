import { Info } from 'lucide-react';
import { orientSlot, placeStarters } from '@/lib/formation';
import type { LineupPlayer, MatchLineup, Player } from '@/types';
import { EventBadges } from './LineupEventBadges';
import type { LineupEvent } from './lib/lineupEvents';
import styles from './Lineups.module.css';

export interface PitchTeam {
  teamId: string;
  teamName: string;
  lineup: MatchLineup | null;
}

interface LineupPitchProps {
  home: PitchTeam;
  away: PitchTeam;
  players: Map<string, Player>;
  eventMap: Map<string, LineupEvent[]>;
  onSelectPlayer: (playerId: string) => void;
}

interface PlacedMarker {
  player: LineupPlayer;
  x: number;
  y: number;
}

function sideNotice(team: PitchTeam, starterCount: number): string {
  if (!team.lineup) return 'Lineup not announced';
  if (starterCount === 0) return 'Starting XI not recorded';
  if (starterCount < 11) return `Starting XI incomplete (${starterCount}/11)`;
  if (starterCount > 11) return `Starting XI has ${starterCount} players`;
  return 'Positions unavailable — no formation recorded';
}

function placeSide(team: PitchTeam, side: 'home' | 'away'): PlacedMarker[] {
  const starters = team.lineup?.players.filter((player) => player.role === 'starter') ?? [];
  if (!team.lineup) return [];

  return placeStarters(team.lineup.formation, starters).map(({ player, slot }) => {
    const point = orientSlot(slot, side);
    return { player, x: point.x, y: point.y };
  });
}

function PlayerMarker({
  marker,
  side,
  teamName,
  players,
  eventMap,
  onSelectPlayer,
}: {
  marker: PlacedMarker;
  side: 'home' | 'away';
  teamName: string;
  players: Map<string, Player>;
  eventMap: Map<string, LineupEvent[]>;
  onSelectPlayer: (playerId: string) => void;
}) {
  const { player } = marker;
  const info = players.get(player.playerId);
  const name = info?.fullName ?? player.playerId;
  const playerEvents = eventMap.get(player.playerId) ?? [];
  const kinds = new Set(playerEvents.map((event) => event.kind));

  const tone = kinds.has('red')
    ? styles.markerCard
    : kinds.has('own-goal')
      ? styles.markerOwnGoal
      : kinds.has('goal')
        ? styles.markerGoal
        : kinds.has('yellow')
          ? styles.markerCard
          : kinds.has('sub-on') || kinds.has('sub-off')
            ? styles.markerSub
            : '';

  const label = [
    player.shirtNumber ? `Number ${player.shirtNumber}` : null,
    name,
    player.position ?? 'position not set',
    player.isCaptain ? 'captain' : null,
    `${teamName} starting XI`,
    ...playerEvents.map((event) => `${event.label} ${event.minute}'`),
  ].filter(Boolean).join(', ');

  return (
    <button
      type="button"
      className={`${styles.player} ${styles[side]}`}
      style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
      onClick={() => onSelectPlayer(player.playerId)}
      aria-label={label}
      title={label}
    >
      <span className={`${styles.marker} ${tone}`}>
        <span className={styles.shirtNumber}>{player.shirtNumber ?? '–'}</span>
        {info?.photoUrl ? (
          <span
            className={styles.avatar}
            style={{ backgroundImage: `url(${JSON.stringify(info.photoUrl)})` }}
            aria-hidden
          />
        ) : null}
        {player.isCaptain ? <span className={styles.captain}>C</span> : null}
      </span>
      <span className={styles.playerName}>{name}</span>
      <EventBadges events={playerEvents} compact />
    </button>
  );
}

/** Both starting XIs on one vertical pitch: home in the top half, away in the bottom half. */
export function LineupPitch({ home, away, players, eventMap, onSelectPlayer }: LineupPitchProps) {
  const sides = [
    { side: 'home' as const, team: home },
    { side: 'away' as const, team: away },
  ].map(({ side, team }) => {
    const starterCount = team.lineup?.players.filter((player) => player.role === 'starter').length ?? 0;
    const markers = placeSide(team, side);
    return {
      side,
      team,
      markers,
      notice: markers.length === 0 ? sideNotice(team, starterCount) : null,
    };
  });

  return (
    <div className={styles.pitchWrap}>
      <div className={styles.pitchStage} role="group" aria-label="Starting lineups for both teams">
        <svg className={styles.pitchSvg} viewBox="0 0 68 105" aria-hidden="true" focusable="false">
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="0.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="0.2" y="0.2" width="67.6" height="104.6" rx="0.4" />
            <line x1="0.2" y1="52.5" x2="67.8" y2="52.5" />
            <circle cx="34" cy="52.5" r="9.15" />
            <rect x="13.84" y="0.2" width="40.32" height="16.5" />
            <rect x="13.84" y="88.3" width="40.32" height="16.5" />
            <rect x="24.84" y="0.2" width="18.32" height="5.5" />
            <rect x="24.84" y="99.3" width="18.32" height="5.5" />
            <path d="M 26.688 16.7 A 9.15 9.15 0 0 0 41.312 16.7" />
            <path d="M 26.688 88.3 A 9.15 9.15 0 0 1 41.312 88.3" />
            <path d="M 0.2 1.2 A 1 1 0 0 1 1.2 0.2" />
            <path d="M 66.8 0.2 A 1 1 0 0 1 67.8 1.2" />
            <path d="M 0.2 103.8 A 1 1 0 0 0 1.2 104.8" />
            <path d="M 66.8 104.8 A 1 1 0 0 0 67.8 103.8" />
            <rect x="30.34" y="0.2" width="7.32" height="1.8" fill="rgba(0, 0, 0, 0.18)" />
            <rect x="30.34" y="103" width="7.32" height="1.8" fill="rgba(0, 0, 0, 0.18)" />
          </g>
          <g fill="currentColor">
            <circle cx="34" cy="52.5" r="0.55" />
            <circle cx="34" cy="11.2" r="0.4" />
            <circle cx="34" cy="93.8" r="0.4" />
          </g>
        </svg>

        {sides.map(({ side, team, markers, notice }) => (
          <div key={side}>
            {markers.map((marker) => (
              <PlayerMarker
                key={marker.player.playerId}
                marker={marker}
                side={side}
                teamName={team.teamName}
                players={players}
                eventMap={eventMap}
                onSelectPlayer={onSelectPlayer}
              />
            ))}
            {notice ? (
              <p className={`${styles.halfNotice} ${styles[`${side}Notice`]}`}>
                <Info size={13} aria-hidden />
                {notice}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
