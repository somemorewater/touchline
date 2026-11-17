'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Save, Send, Undo2 } from 'lucide-react';
import { errorMessage } from '@/lib/api/client';
import {
  lineupsApi,
  registrationsApi,
  type LineupPlayerInput,
} from '@/lib/api/endpoints';
import type { FormationDto, LineupDto, PlayerRegistrationDto } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';
import styles from './LineupEditor.module.css';

type Position = 'GK' | 'DF' | 'MF' | 'FW';

interface SlotDef {
  position: Position;
  x: number;
  y: number;
}

interface Assignment {
  playerRegistrationId: string;
  shirtNumber: number;
  isCaptain: boolean;
}

interface SubstituteSelection {
  shirtNumber: number;
  position: '' | Position;
}

interface Props {
  matchId: string;
  teamRegistrationId: string;
  teamName: string;
  competitionId: string;
  existing: LineupDto | null;
}

const POSITIONS: Position[] = ['GK', 'DF', 'MF', 'FW'];

const STATUS_LABEL: Record<LineupDto['status'], string> = {
  draft: 'Draft',
  submitted: 'Submitted for confirmation',
  confirmed: 'Confirmed',
  returned: 'Returned for changes',
  published: 'Published',
};

function slotsFor(formation: FormationDto | undefined): SlotDef[] {
  if (!formation) return [];
  return [
    { position: 'GK', x: formation.goalkeeper.x, y: formation.goalkeeper.y },
    ...formation.outfieldSlots.map((slot) => ({ position: slot.position, x: slot.x, y: slot.y })),
  ];
}

function slotLabel(position: Position, index: number): string {
  if (position === 'GK') return 'Goalkeeper';
  return `${position} ${index}`;
}

function shirtFor(registration: PlayerRegistrationDto | undefined, existing: number | null | undefined): number {
  if (existing !== null && existing !== undefined && existing > 0) return existing;
  if (registration?.shirtNumber) return registration.shirtNumber;
  return 0;
}

export function LineupEditor({ matchId, teamRegistrationId, teamName, competitionId, existing }: Props) {
  const queryClient = useQueryClient();
  const { canIn } = useAuth();
  const canReview = canIn('matches.manage', competitionId) || canIn('fixtures.manage', competitionId);

  const formationsQ = useQuery({
    queryKey: ['lineup-formations'],
    queryFn: () => lineupsApi.formations(),
    staleTime: 10 * 60_000,
  });
  const squadQ = useQuery({
    queryKey: ['lineup-squad', teamRegistrationId],
    queryFn: () => registrationsApi.list({ teamRegistrationId, status: 'approved' }),
  });

  const formations = useMemo(() => formationsQ.data ?? [], [formationsQ.data]);
  const squad = useMemo(() => squadQ.data ?? [], [squadQ.data]);
  const byRegistration = useMemo(() => new Map(squad.map((entry) => [entry.id, entry])), [squad]);

  const [current, setCurrent] = useState<LineupDto | null>(existing);
  const [formationId, setFormationId] = useState(existing?.formation ?? '');
  const [slots, setSlots] = useState<Record<number, Assignment>>({});
  const [subs, setSubs] = useState<Record<string, SubstituteSelection>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'save' | 'submit' | 'withdraw' | 'confirm' | 'return' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const initialised = useRef(false);

  const formation = formations.find((entry) => entry.id === formationId);
  const slotDefs = useMemo(() => slotsFor(formation), [formation]);

  // Seed the editable state once the squad and formations are available.
  useEffect(() => {
    if (initialised.current) return;
    if (squadQ.isLoading || formationsQ.isLoading) return;
    initialised.current = true;

    if (!existing) return;
    const definition = formations.find((entry) => entry.id === existing.formation);
    const defs = slotsFor(definition);
    const nextSlots: Record<number, Assignment> = {};
    const used = new Set<number>();

    for (const player of existing.players.filter((entry) => entry.role === 'starter')) {
      const exact = defs.findIndex(
        (slot, index) =>
          !used.has(index) &&
          slot.position === player.position &&
          slot.x === player.x &&
          slot.y === player.y,
      );
      const samePosition = defs.findIndex((slot, index) => !used.has(index) && slot.position === player.position);
      const any = defs.findIndex((_slot, index) => !used.has(index));
      const index = exact >= 0 ? exact : samePosition >= 0 ? samePosition : any;
      if (index < 0) continue;
      used.add(index);
      nextSlots[index] = {
        playerRegistrationId: player.playerRegistrationId,
        shirtNumber: player.shirtNumber ?? shirtFor(byRegistration.get(player.playerRegistrationId), null),
        isCaptain: player.isCaptain,
      };
    }
    setSlots(nextSlots);

    const nextSubs: Record<string, SubstituteSelection> = {};
    for (const player of existing.players.filter((entry) => entry.role === 'substitute')) {
      const registration = byRegistration.get(player.playerRegistrationId);
      nextSubs[player.playerRegistrationId] = {
        shirtNumber: player.shirtNumber ?? shirtFor(registration, null),
        position: (player.position ?? registration?.player.position ?? '') as Position | '',
      };
    }
    setSubs(nextSubs);
  }, [existing, formations, byRegistration, squadQ.isLoading, formationsQ.isLoading]);

  const assignedIds = useMemo(
    () => new Set([
      ...Object.values(slots).map((slot) => slot.playerRegistrationId),
      ...Object.keys(subs),
    ]),
    [slots, subs],
  );

  const availableForSlot = (index: number): PlayerRegistrationDto[] => {
    const currentId = slots[index]?.playerRegistrationId;
    return squad.filter((entry) => entry.id === currentId || !assignedIds.has(entry.id));
  };

  const unassigned = squad.filter((entry) => !assignedIds.has(entry.id));
  const filledSlots = slotDefs
    .map((_slot, index) => slots[index])
    .filter((assignment): assignment is Assignment => Boolean(assignment));
  const captainSlot = Object.entries(slots).find(([, assignment]) => assignment.isCaptain)?.[0];

  const changeFormation = (nextId: string) => {
    const previous = slotsFor(formations.find((entry) => entry.id === formationId));
    const next = slotsFor(formations.find((entry) => entry.id === nextId));
    const carried = previous
      .map((slot, index) => ({ slot, assignment: slots[index] }))
      .filter((entry): entry is { slot: SlotDef; assignment: Assignment } => Boolean(entry.assignment));

    const used = new Set<number>();
    const nextSlots: Record<number, Assignment> = {};
    for (const { slot, assignment } of carried) {
      const exact = next.findIndex((candidate, index) => !used.has(index) && candidate.position === slot.position && candidate.x === slot.x && candidate.y === slot.y);
      const samePosition = next.findIndex((candidate, index) => !used.has(index) && candidate.position === slot.position);
      const any = next.findIndex((_candidate, index) => !used.has(index));
      const index = exact >= 0 ? exact : samePosition >= 0 ? samePosition : any;
      if (index < 0) continue;
      used.add(index);
      nextSlots[index] = assignment;
    }

    setFormationId(nextId);
    setSlots(nextSlots);
    setNotice(null);
    setError(null);
  };

  const assignSlot = (index: number, playerRegistrationId: string) => {
    const next: Record<number, Assignment> = {};
    for (const [key, assignment] of Object.entries(slots)) {
      if (assignment.playerRegistrationId === playerRegistrationId) continue;
      next[Number(key)] = assignment;
    }
    if (!playerRegistrationId) {
      setSlots(next);
      return;
    }
    const registration = byRegistration.get(playerRegistrationId);
    next[index] = {
      playerRegistrationId,
      shirtNumber: shirtFor(registration, next[index]?.shirtNumber),
      isCaptain: next[index]?.isCaptain ?? false,
    };
    setSubs((previous) => {
      if (!(playerRegistrationId in previous)) return previous;
      const copy = { ...previous };
      delete copy[playerRegistrationId];
      return copy;
    });
    setSlots(next);
  };

  const setCaptain = (index: number | null) => {
    setSlots((previous) => {
      const next: Record<number, Assignment> = {};
      for (const [key, assignment] of Object.entries(previous)) {
        next[Number(key)] = { ...assignment, isCaptain: index !== null && Number(key) === index };
      }
      return next;
    });
  };

  const toggleSubstitute = (registration: PlayerRegistrationDto, checked: boolean) => {
    setSubs((previous) => {
      if (!checked) {
        const copy = { ...previous };
        delete copy[registration.id];
        return copy;
      }
      return {
        ...previous,
        [registration.id]: {
          shirtNumber: shirtFor(registration, null),
          position: (registration.player.position ?? '') as Position | '',
        },
      };
    });
  };

  const buildPlayers = (): LineupPlayerInput[] => {
    const starters: LineupPlayerInput[] = slotDefs.flatMap((slot, index) => {
      const assignment = slots[index];
      if (!assignment) return [];
      return [{
        playerRegistrationId: assignment.playerRegistrationId,
        role: 'starter' as const,
        position: slot.position,
        shirtNumber: assignment.shirtNumber,
        x: slot.x,
        y: slot.y,
        isCaptain: assignment.isCaptain,
      }];
    });

    const substitutes: LineupPlayerInput[] = Object.entries(subs).map(([playerRegistrationId, selection]) => {
      const registration = byRegistration.get(playerRegistrationId);
      const position = (selection.position || registration?.player.position || 'MF') as Position;
      return {
        playerRegistrationId,
        role: 'substitute' as const,
        position,
        shirtNumber: selection.shirtNumber,
      };
    });

    return [...starters, ...substitutes];
  };

  const validate = (complete: boolean): string | null => {
    if (filledSlots.length === 0 && Object.keys(subs).length === 0) {
      return 'Select at least one player.';
    }
    if (complete) {
      if (!formation) return 'Choose a supported formation.';
      if (filledSlots.length !== 11) return `A complete starting XI needs eleven players, currently ${filledSlots.length}.`;
      if (!captainSlot) return 'Choose a captain from the starting XI.';
    }
    const numbers = [
      ...filledSlots.map((assignment) => assignment.shirtNumber),
      ...Object.values(subs).map((selection) => selection.shirtNumber),
    ];
    if (numbers.some((number) => number < 1 || number > 99)) {
      return 'Every selected player needs a shirt number between 1 and 99.';
    }
    if (new Set(numbers).size !== numbers.length) {
      return 'Shirt numbers must be unique within the lineup.';
    }
    if (Object.entries(subs).some(([id, selection]) => !selection.position && !byRegistration.get(id)?.player.position)) {
      return 'Choose a position for each substitute whose profile has none recorded.';
    }
    return null;
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
    void queryClient.invalidateQueries({ queryKey: ['lineups', matchId] });
  };

  const persist = async (): Promise<LineupDto> => {
    const players = buildPlayers();
    const formationValue = formationId || null;
    const trimmedReason = reason.trim();
    if (current) {
      const saved = await lineupsApi.update(current.id, {
        formation: formationValue,
        players,
        ...(trimmedReason ? { reason: trimmedReason } : {}),
      });
      setCurrent(saved);
      refresh();
      return saved;
    }
    const created = await lineupsApi.create(matchId, {
      teamRegistrationId,
      formation: formationValue,
      players,
    });
    setCurrent(created);
    setReason('');
    refresh();
    return created;
  };

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = () => run('save', async () => {
    const issue = validate(false);
    if (issue) throw new Error(issue);
    if (canReview && current && current.status !== 'draft' && current.status !== 'returned' && !reason.trim()) {
      throw new Error('Administrative corrections need a reason.');
    }
    await persist();
    setNotice('Saved. The lineup is still a draft until it is submitted.');
  });

  const submit = () => run('submit', async () => {
    const issue = validate(true);
    if (issue) throw new Error(issue);
    const saved = await persist();
    const submitted = await lineupsApi.submit(saved.id);
    setCurrent(submitted);
    setReason('');
    refresh();
    setNotice('Lineup submitted. A competition administrator will review it.');
  });

  const withdraw = () => run('withdraw', async () => {
    if (!current) return;
    const updated = await lineupsApi.withdraw(current.id);
    setCurrent(updated);
    refresh();
    setNotice('Lineup withdrawn and returned to draft.');
  });

  const confirm = () => run('confirm', async () => {
    if (!current) return;
    const updated = await lineupsApi.confirm(current.id, reason.trim() || undefined);
    setCurrent(updated);
    setReason('');
    refresh();
    setNotice('Lineup confirmed.');
  });

  const returnToTeam = () => run('return', async () => {
    if (!current) return;
    if (!reason.trim()) throw new Error('Give the team a reason for returning the lineup.');
    const updated = await lineupsApi.returnLineup(current.id, reason.trim());
    setCurrent(updated);
    setReason('');
    refresh();
    setNotice('Lineup returned to the team.');
  });

  const editable = !current || current.status === 'draft' || current.status === 'returned' || canReview;
  const canSubmit = current && (current.status === 'draft' || current.status === 'returned');
  const canWithdraw = current && current.status !== 'draft';
  const canConfirm = canReview && current && (current.status === 'submitted' || current.status === 'published');
  const canReturn = canReview && current && (current.status === 'submitted' || current.status === 'confirmed');

  if (squadQ.isError || formationsQ.isError) {
    return <p className="tl-alert tl-alert-error" role="alert">Could not load the formations or the approved squad for this team.</p>;
  }
  if (squadQ.isLoading || formationsQ.isLoading) {
    return <p className="tl-muted" role="status">Loading squad and formations…</p>;
  }
  if (squad.length === 0) {
    return (
      <p className="tl-alert tl-alert-info">
        No approved player registrations are available for {teamName}. A lineup can only be selected from approved, eligible players.
      </p>
    );
  }

  return (
    <section className={styles.editor} aria-label={`Lineup editor for ${teamName}`}>
      <header className={styles.head}>
        <div>
          <h3>{teamName}</h3>
          <p className={styles.status}>
            <span className="tl-badge">{current ? STATUS_LABEL[current.status] : 'New lineup'}</span>
            {current?.submittedAt ? <span className="tl-muted">Submitted {new Date(current.submittedAt).toLocaleString('en-GB')}</span> : null}
          </p>
        </div>
        <label className="tl-field">
          <span className="tl-label">Formation</span>
          <select
            className="tl-select"
            value={formationId}
            onChange={(event) => changeFormation(event.target.value)}
            disabled={!editable || busy !== null}
          >
            <option value="">Select a formation</option>
            {formations.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id} ({entry.segments.join('-')})
              </option>
            ))}
          </select>
        </label>
      </header>

      {current?.status === 'returned' && current.returnReason ? (
        <p className="tl-alert tl-alert-info" role="status">
          This lineup was returned: {current.returnReason}
        </p>
      ) : null}

      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}
      {notice ? <p className="tl-alert tl-alert-success" role="status">{notice}</p> : null}

      <div className={styles.workspace}>
        <div className={styles.pitchWrap}>
          <div className={styles.pitch} role="img" aria-label="Formation preview with assigned players">
            <span className={styles.halfway} aria-hidden />
            {slotDefs.length === 0 ? (
              <p className={styles.pitchEmpty}>{formationId ? 'No slots recorded for this formation.' : 'Choose a formation to place the starting XI.'}</p>
            ) : slotDefs.map((slot, index) => {
              const assignment = slots[index];
              const registration = assignment ? byRegistration.get(assignment.playerRegistrationId) : undefined;
              return (
                <span
                  key={`${slot.position}-${index}`}
                  className={`${styles.marker} ${assignment ? styles.markerFilled : ''}`}
                  style={{ left: `${slot.x}%`, top: `${92 - slot.y * 0.84}%` }}
                  title={assignment ? `${registration?.player.fullName ?? assignment.playerRegistrationId}, ${slot.position}` : `${slotLabel(slot.position, index)} empty`}
                >
                  <b>{assignment ? assignment.shirtNumber || '–' : '+'}</b>
                  <small>{assignment ? (registration?.player.fullName ?? 'Player') : slot.position}</small>
                  {assignment?.isCaptain ? <i aria-label="Captain">C</i> : null}
                </span>
              );
            })}
          </div>
          <p className="tl-muted">
            Coordinates come from the selected formation. The server accepts only the exact slots it publishes for that formation.
          </p>
        </div>

        <div className="tl-stack">
          {formation ? (
            <div className="tl-card">
              <h4>Starting XI ({filledSlots.length}/11)</h4>
              <div className={styles.slotList}>
                {slotDefs.map((slot, index) => {
                  const assignment = slots[index];
                  const registration = assignment ? byRegistration.get(assignment.playerRegistrationId) : undefined;
                  const fixedShirt = registration?.shirtNumber ?? null;
                  return (
                    <div key={`${slot.position}-${index}`} className={styles.slotRow}>
                      <span className={styles.slotTag}>{slotLabel(slot.position, index)}</span>
                      <select
                        className="tl-select"
                        aria-label={`${slotLabel(slot.position, index)} player`}
                        value={assignment?.playerRegistrationId ?? ''}
                        onChange={(event) => assignSlot(index, event.target.value)}
                        disabled={!editable || busy !== null}
                      >
                        <option value="">Unassigned</option>
                        {availableForSlot(index).map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.player.fullName}{entry.shirtNumber ? ` (#${entry.shirtNumber})` : ''}
                          </option>
                        ))}
                      </select>
                      <input
                        className={`tl-input ${styles.shirtInput}`}
                        type="number"
                        min={1}
                        max={99}
                        inputMode="numeric"
                        aria-label={`${slotLabel(slot.position, index)} shirt number`}
                        value={assignment?.shirtNumber ?? ''}
                        readOnly={fixedShirt !== null}
                        title={fixedShirt !== null ? 'The approved registration fixes this shirt number.' : undefined}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setSlots((previous) => ({ ...previous, [index]: { ...previous[index]!, shirtNumber: value } }));
                        }}
                        disabled={!editable || !assignment || busy !== null}
                      />
                      {assignment ? (
                        <button
                          type="button"
                          className={styles.remove}
                          onClick={() => assignSlot(index, '')}
                          disabled={!editable || busy !== null}
                          aria-label={`Remove player from ${slotLabel(slot.position, index)}`}
                        >
                          Remove
                        </button>
                      ) : <span />}
                    </div>
                  );
                })}
              </div>

              <label className="tl-field">
                <span className="tl-label">Captain</span>
                <select
                  className="tl-select"
                  value={captainSlot ?? ''}
                  onChange={(event) => setCaptain(event.target.value === '' ? null : Number(event.target.value))}
                  disabled={!editable || busy !== null}
                >
                  <option value="">No captain selected</option>
                  {Object.entries(slots).map(([index, assignment]) => (
                    <option key={index} value={index}>
                      {byRegistration.get(assignment.playerRegistrationId)?.player.fullName ?? assignment.playerRegistrationId}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <div className="tl-card">
            <h4>Substitutes ({Object.keys(subs).length})</h4>
            {unassigned.length === 0 ? (
              <p className="tl-muted">Every available player is already in the starting XI or on the bench.</p>
            ) : (
              <ul className={styles.squadList}>
                {unassigned.map((entry) => {
                  const checked = entry.id in subs;
                  return (
                    <li key={entry.id} className={styles.squadRow}>
                      <label className="tl-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => toggleSubstitute(entry, event.target.checked)}
                          disabled={!editable || busy !== null}
                        />
                        <span>
                          <strong>{entry.player.fullName}</strong>
                          <small className="tl-muted">
                            {' '}{entry.player.position ?? 'Position not recorded'}
                            {entry.shirtNumber ? ` · #${entry.shirtNumber}` : ''}
                          </small>
                        </span>
                      </label>
                      {checked ? (
                        <span className={styles.subFields}>
                          {(!entry.player.position || !entry.shirtNumber) ? (
                            <>
                              {!entry.player.position ? (
                                <select
                                  className="tl-select"
                                  aria-label={`${entry.player.fullName} substitute position`}
                                  value={subs[entry.id]!.position}
                                  onChange={(event) => setSubs((previous) => ({
                                    ...previous,
                                    [entry.id]: { ...previous[entry.id]!, position: event.target.value as Position | '' },
                                  }))}
                                  disabled={busy !== null}
                                >
                                  <option value="">Position</option>
                                  {POSITIONS.map((position) => <option key={position} value={position}>{position}</option>)}
                                </select>
                              ) : null}
                              {!entry.shirtNumber ? (
                                <input
                                  className={`tl-input ${styles.shirtInput}`}
                                  type="number"
                                  min={1}
                                  max={99}
                                  aria-label={`${entry.player.fullName} shirt number`}
                                  value={subs[entry.id]!.shirtNumber || ''}
                                  onChange={(event) => setSubs((previous) => ({
                                    ...previous,
                                    [entry.id]: { ...previous[entry.id]!, shirtNumber: Number(event.target.value) },
                                  }))}
                                  disabled={busy !== null}
                                />
                              ) : null}
                            </>
                          ) : <span className="tl-muted">Shirt #{entry.shirtNumber}</span>}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="tl-muted">The server enforces the season&apos;s substitute limit and eligibility rules.</p>
          </div>
        </div>
      </div>

      {editable ? (
        <div className={styles.reasonRow}>
          <label className="tl-field">
            <span className="tl-label">
              Reason {canReview && current && current.status !== 'draft' && current.status !== 'returned' ? '(required for corrective edits)' : '(optional, recorded in the audit trail)'}
            </span>
            <textarea
              className="tl-textarea"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={2000}
              disabled={busy !== null}
            />
          </label>
        </div>
      ) : null}

      <div className={styles.actions}>
        {editable ? (
          <button type="button" className="tl-btn" onClick={() => void saveDraft()} disabled={busy !== null}>
            <Save size={16} aria-hidden /> {busy === 'save' ? 'Saving…' : current ? 'Save changes' : 'Save draft'}
          </button>
        ) : null}
        {canSubmit ? (
          <button type="button" className="tl-btn tl-btn-primary" onClick={() => void submit()} disabled={busy !== null}>
            <Send size={16} aria-hidden /> {busy === 'submit' ? 'Submitting…' : 'Submit lineup'}
          </button>
        ) : null}
        {canWithdraw ? (
          <button type="button" className="tl-btn" onClick={() => void withdraw()} disabled={busy !== null}>
            <Undo2 size={16} aria-hidden /> {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
          </button>
        ) : null}
        {canConfirm ? (
          <button type="button" className="tl-btn tl-btn-primary" onClick={() => void confirm()} disabled={busy !== null}>
            <CheckCircle2 size={16} aria-hidden /> {busy === 'confirm' ? 'Confirming…' : 'Confirm lineup'}
          </button>
        ) : null}
        {canReturn ? (
          <button type="button" className="tl-btn tl-btn-danger" onClick={() => void returnToTeam()} disabled={busy !== null}>
            <AlertTriangle size={16} aria-hidden /> {busy === 'return' ? 'Returning…' : 'Return to team'}
          </button>
        ) : null}
      </div>
    </section>
  );
}
