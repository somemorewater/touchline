'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Info, X } from 'lucide-react';
import { Crest } from '@/components/ui/Crest';
import { EmptyState } from '@/components/ui/States';
import { usePlayerStatistics } from '@/features/players/hooks';
import { statusLabel } from '@/lib/match';
import type {
  LineupPlayer,
  MatchEvent,
  MatchLineup,
  MatchStatus,
  Measured,
  Player,
  PlayerStatistics,
  Team,
} from '@/types';
import { EventBadges, EventLegend } from './LineupEventBadges';
import { LineupPitch, type PitchTeam } from './LineupPitch';
import { positionLabel } from '@/lib/positions';
import { buildLineupEventMap, type LineupEvent } from './lib/lineupEvents';
import styles from './Lineups.module.css';

interface MatchLineupsProps {
  lineups: MatchLineup[];
  events: MatchEvent[];
  teams: Map<string, Team>;
  players: Map<string, Player>;
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  seasonId: string;
  matchStatus: MatchStatus;
}

type StatKey =
  | 'appearances'
  | 'starts'
  | 'substituteAppearances'
  | 'goals'
  | 'yellowCards'
  | 'redCards'
  | 'cleanSheets';

const STAT_FIELDS: { key: StatKey; label: string }[] = [
  { key: 'appearances', label: 'Appearances' },
  { key: 'starts', label: 'Starts' },
  { key: 'substituteAppearances', label: 'Sub appearances' },
  { key: 'goals', label: 'Goals' },
  { key: 'yellowCards', label: 'Yellow cards' },
  { key: 'redCards', label: 'Red cards' },
  { key: 'cleanSheets', label: 'Clean sheets' },
];

const startersOf = (lineup: MatchLineup) => lineup.players.filter((player) => player.role === 'starter');

const LINEUP_STATUS_LABEL: Record<NonNullable<MatchLineup['status']>, string> = {
  draft: 'Draft, not submitted',
  submitted: 'Submitted, awaiting confirmation',
  confirmed: 'Confirmed',
  returned: 'Returned for changes',
  published: 'Published',
};

function measured(value: Measured<number> | undefined): string {
  return value?.state === 'known' ? String(value.value) : '—';
}

function TeamHeader({ team, lineup, side }: { team?: Team; lineup: MatchLineup | null; side: 'home' | 'away' }) {
  const count = lineup ? startersOf(lineup).length : 0;
  const xiStatus = !lineup
    ? 'Lineup not announced'
    : count === 11
      ? 'Starting XI confirmed'
      : count === 0
        ? 'Starting XI not recorded'
        : `Starting XI ${count}/11`;

  return (
    <div className={`${styles.teamHeader} ${styles[side]}`}>
      <Crest name={team?.name ?? 'Team'} size={34} />
      <div className={styles.teamHeaderText}>
        <span className={styles.sideLabel}>{side === 'home' ? 'Home' : 'Away'}</span>
        <strong>{team?.name ?? 'Team'}</strong>
        <small>
          <span className={styles.formation}>{lineup?.formation ?? 'Formation not recorded'}</span>
          <span className={styles.xiStatus}>{xiStatus}</span>
          {lineup?.status ? <span className={styles.statusText}>{LINEUP_STATUS_LABEL[lineup.status]}</span> : null}
        </small>
      </div>
    </div>
  );
}

function BenchList({
  title,
  entries,
  players,
  eventMap,
  emptyLabel,
  onSelectPlayer,
}: {
  title: string;
  entries: LineupPlayer[];
  players: Map<string, Player>;
  eventMap: Map<string, LineupEvent[]>;
  emptyLabel: string;
  onSelectPlayer: (playerId: string) => void;
}) {
  return (
    <section className={styles.benchBlock}>
      <header className={styles.benchHead}>
        <h4>{title}</h4>
        <span>{entries.length}</span>
      </header>
      {entries.length === 0 ? (
        <p className={styles.emptyRow}>{emptyLabel}</p>
      ) : (
        <ul className={styles.benchList}>
          {entries.map((entry) => {
            const info = players.get(entry.playerId);
            const name = info?.fullName ?? entry.playerId;
            const detail = [
              positionLabel(entry.position) ?? 'Position not set',
              entry.role === 'unavailable' ? entry.unavailableReason ?? 'Unavailable' : null,
            ].filter(Boolean).join(' · ');

            return (
              <li key={entry.playerId}>
                <button
                  type="button"
                  className={styles.benchRow}
                  onClick={() => onSelectPlayer(entry.playerId)}
                  aria-label={`${name}, number ${entry.shirtNumber ?? 'not set'}, ${detail}. Show match details.`}
                >
                  <span className={styles.benchNumber}>{entry.shirtNumber ?? '–'}</span>
                  <span className={styles.benchText}>
                    <strong>{name}{entry.isCaptain ? ' (C)' : ''}</strong>
                    <small className={entry.role === 'unavailable' ? styles.reason : undefined}>{detail}</small>
                  </span>
                  <EventBadges events={eventMap.get(entry.playerId) ?? []} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BenchTeam({
  team,
  lineup,
  side,
  players,
  eventMap,
  onSelectPlayer,
}: {
  team?: Team;
  lineup: MatchLineup | null;
  side: 'home' | 'away';
  players: Map<string, Player>;
  eventMap: Map<string, LineupEvent[]>;
  onSelectPlayer: (playerId: string) => void;
}) {
  const name = team?.name ?? (side === 'home' ? 'Home team' : 'Away team');
  const substitutes = lineup?.players.filter((player) => player.role === 'substitute') ?? [];
  const unavailable = lineup?.players.filter((player) => player.role === 'unavailable') ?? [];
  const emptyLabel = lineup ? 'None listed.' : 'Lineup not announced.';

  return (
    <section className={`${styles.benchTeam} ${styles[side]}`} aria-labelledby={`${side}-bench-title`}>
      <div className={styles.benchTeamHead}>
        <Crest name={name} size={28} />
        <div>
          <h3 id={`${side}-bench-title`}>{name}</h3>
          <span>Substitutes and unavailable players</span>
        </div>
      </div>
      <div className={styles.benchColumns}>
        <BenchList title="Substitutes" entries={substitutes} players={players} eventMap={eventMap} emptyLabel={emptyLabel} onSelectPlayer={onSelectPlayer} />
        <BenchList title="Unavailable" entries={unavailable} players={players} eventMap={eventMap} emptyLabel={emptyLabel} onSelectPlayer={onSelectPlayer} />
      </div>
    </section>
  );
}

function PlayerPanel({
  entry,
  info,
  team,
  side,
  events,
  stat,
  onClose,
}: {
  entry: LineupPlayer;
  info?: Player;
  team?: Team;
  side: 'home' | 'away';
  events: LineupEvent[];
  stat?: PlayerStatistics;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const name = info?.fullName ?? entry.playerId;

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className={styles.panelBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.playerPanel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={styles.panelHead}>
          <span className={`${styles.panelAvatar} ${styles[side]}`}>
            {info?.photoUrl ? (
              <span
                className={styles.panelAvatarImage}
                style={{ backgroundImage: `url(${JSON.stringify(info.photoUrl)})` }}
                aria-hidden
              />
            ) : (
              entry.shirtNumber ?? '–'
            )}
          </span>
          <div className={styles.panelHeadText}>
            <span className={styles.panelTeam}>{team?.name ?? 'Team'} · {side === 'home' ? 'Home' : 'Away'}</span>
            <h2 id={titleId}>{name}</h2>
            <p className={styles.panelMeta}>
              {entry.shirtNumber ? `#${entry.shirtNumber}` : 'Number not set'}
              {' · '}
              {positionLabel(entry.position) ?? 'Position not set'}
              {entry.isCaptain ? ' · Captain' : ''}
              {entry.role === 'unavailable' ? ` · ${entry.unavailableReason ?? 'Unavailable'}` : ''}
            </p>
          </div>
          <button ref={closeRef} type="button" className={styles.panelClose} onClick={onClose} aria-label="Close player details">
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className={styles.panelBody}>
          <section className={styles.panelSection} aria-labelledby={`${titleId}-events`}>
            <h3 id={`${titleId}-events`}>Match events</h3>
            {events.length === 0 ? (
              <p className={styles.panelEmpty}>No match events recorded for this player.</p>
            ) : (
              <ul className={styles.panelEvents}>
                {events.map((event, index) => (
                  <li key={`${event.kind}-${event.minute}-${index}`}>
                    <EventBadges events={[event]} compact />
                    <span>{event.label}</span>
                    <span className={`${styles.panelMinute} num`}>{event.minute}&apos;</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.panelSection} aria-labelledby={`${titleId}-stats`}>
            <h3 id={`${titleId}-stats`}>Season statistics</h3>
            {!stat ? (
              <p className={styles.panelEmpty}>No season statistics recorded for this player.</p>
            ) : (
              <dl className={styles.statGrid}>
                {STAT_FIELDS.map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd className="num">{measured(stat[field.key])}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        <footer className={styles.panelFooter}>
          <Link href={`/players/${entry.playerId}`} className={styles.profileLink} onClick={onClose}>
            View full player profile <ArrowUpRight size={15} aria-hidden />
          </Link>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function MatchLineups({
  lineups,
  events,
  teams,
  players,
  homeTeamId,
  awayTeamId,
  competitionId,
  seasonId,
  matchStatus,
}: MatchLineupsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const closePanel = useCallback(() => setSelectedId(null), []);
  const eventMap = useMemo(() => buildLineupEventMap(events), [events]);
  const statsQ = usePlayerStatistics(competitionId, seasonId);

  const homeLineup = lineups.find((lineup) => lineup.teamId === homeTeamId) ?? null;
  const awayLineup = lineups.find((lineup) => lineup.teamId === awayTeamId) ?? null;
  const homeTeam = teams.get(homeTeamId);
  const awayTeam = teams.get(awayTeamId);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    const sides = [
      { teamId: homeTeamId, side: 'home' as const },
      { teamId: awayTeamId, side: 'away' as const },
    ];

    for (const candidate of sides) {
      const lineup = lineups.find((entry) => entry.teamId === candidate.teamId);
      const entry = lineup?.players.find((player) => player.playerId === selectedId);
      if (lineup && entry) return { entry, teamId: candidate.teamId, side: candidate.side };
    }
    return null;
  }, [selectedId, lineups, homeTeamId, awayTeamId]);

  if (!homeLineup && !awayLineup) {
    return <EmptyState title="Lineups not published">Neither team has submitted a lineup for this match yet.</EmptyState>;
  }

  const interrupted = matchStatus === 'postponed' || matchStatus === 'cancelled' || matchStatus === 'abandoned';
  const returned = [
    { lineup: homeLineup, team: homeTeam?.name ?? 'Home team' },
    { lineup: awayLineup, team: awayTeam?.name ?? 'Away team' },
  ].filter((entry) => entry.lineup?.status === 'returned');
  const homePitch: PitchTeam = { teamId: homeTeamId, teamName: homeTeam?.name ?? 'Home team', lineup: homeLineup };
  const awayPitch: PitchTeam = { teamId: awayTeamId, teamName: awayTeam?.name ?? 'Away team', lineup: awayLineup };
  const selectedInfo = selected ? players.get(selected.entry.playerId) : undefined;
  const selectedTeam = selected ? teams.get(selected.teamId) : undefined;
  const selectedStat = selected ? statsQ.data?.find((entry) => entry.playerId === selected.entry.playerId) : undefined;

  return (
    <div className={styles.lineupsWrap}>
      {interrupted ? (
        <p className={styles.statusNotice}>
          <Info size={15} aria-hidden />
          This match is marked {statusLabel(matchStatus).toLowerCase()}. Published lineups are shown as recorded, without inferred players or positions.
        </p>
      ) : null}

      {returned.map(({ lineup, team }) => (
        <p key={team} className={styles.statusNotice}>
          <Info size={15} aria-hidden />
          <span>
            <strong>{team}</strong> lineup was returned for changes
            {lineup?.returnReason ? `: ${lineup.returnReason}` : '.'}
          </span>
        </p>
      ))}

      <div className={styles.teamHeaders}>
        <TeamHeader team={homeTeam} lineup={homeLineup} side="home" />
        <TeamHeader team={awayTeam} lineup={awayLineup} side="away" />
      </div>

      <p className={styles.pitchHint}>Both starting XIs · Tap a player for match details</p>

      <LineupPitch
        home={homePitch}
        away={awayPitch}
        players={players}
        eventMap={eventMap}
        onSelectPlayer={setSelectedId}
      />

      <EventLegend />

      <div className={styles.benchGrid}>
        <BenchTeam team={homeTeam} lineup={homeLineup} side="home" players={players} eventMap={eventMap} onSelectPlayer={setSelectedId} />
        <BenchTeam team={awayTeam} lineup={awayLineup} side="away" players={players} eventMap={eventMap} onSelectPlayer={setSelectedId} />
      </div>

      {selected ? (
        <PlayerPanel
          entry={selected.entry}
          info={selectedInfo}
          team={selectedTeam}
          side={selected.side}
          events={eventMap.get(selected.entry.playerId) ?? []}
          stat={selectedStat}
          onClose={closePanel}
        />
      ) : null}
    </div>
  );
}
