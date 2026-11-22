'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { LineupEditor, LineupReadView } from '@/features/lineups/LineupEditor';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage } from '@/lib/api/client';
import { fixturesApi, lineupsApi, registrationsApi, teamsApi } from '@/lib/api/endpoints';
import type { CaptainTeamDto, PlayerRegistrationDto } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { statusLabel } from '@/lib/match';
import { PLAYER_POSITION_OPTIONS, positionLabel, type PlayerPosition } from '@/lib/positions';
import { DISPLAY_TIME_ZONE, type MatchStatus } from '@/types';
import styles from '@/components/layout/Workspace.module.css';

const REG_STATUS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

const registrationLabel = (status: string) => REG_STATUS[status] ?? status.replaceAll('_', ' ');

const viewStatus = (status: string) => status.replaceAll('_', '-') as MatchStatus;

export function CaptainWorkspace() {
  const { status, isCaptain } = useAuth();
  const teamsQ = useQuery({
    queryKey: ['captain-teams'],
    queryFn: () => teamsApi.myCaptainTeams(),
    enabled: isCaptain,
  });

  if (status === 'loading') return <Skeleton lines={3} height={120} />;
  if (!isCaptain) {
    return (
      <EmptyState title="Captain workspace is not available to your account">
        A competition administrator assigns team captains. Only a captain can see this workspace.
      </EmptyState>
    );
  }

  return (
    <>
      <PageHeader
        title="Captain workspace"
        lead="Your teams, squad registrations and matchday lineups. Only your own team entries are listed."
      />
      {teamsQ.isLoading ? <Skeleton lines={3} height={120} /> : teamsQ.isError ? (
        <ErrorState title="Could not load your teams" onRetry={() => void teamsQ.refetch()} />
      ) : (teamsQ.data ?? []).length === 0 ? (
        <EmptyState title="No captaincies">
          Your account is not the captain of any team entry. A competition administrator assigns captains.
        </EmptyState>
      ) : (
        <div className="tl-stack">
          {teamsQ.data!.map((entry) => (
            <CaptainTeamCard key={`${entry.registration.id}`} entry={entry} />
          ))}
        </div>
      )}
    </>
  );
}

function CaptainTeamCard({ entry }: { entry: CaptainTeamDto }) {
  const { registration, team, season, competition } = entry;
  const queryClient = useQueryClient();
  const [openFixture, setOpenFixture] = useState<string | null>(null);

  const fixturesQ = useQuery({
    queryKey: ['captain-fixtures', season.id, team.id],
    queryFn: () => fixturesApi.list({ seasonId: season.id, teamId: team.id }),
  });
  const registrationsQ = useQuery({
    queryKey: ['captain-registrations', registration.id],
    queryFn: () => registrationsApi.list({ teamRegistrationId: registration.id }),
  });

  const fixtures = [...(fixturesQ.data ?? [])].sort(
    (a, b) => Date.parse(a.scheduledAt ?? '9999') - Date.parse(b.scheduledAt ?? '9999'),
  );

  return (
    <section className="tl-card">
      <header className={styles.cardHead}>
        <div>
          <h2>{team.name}</h2>
          <p className="tl-muted">
            {competition.name} · {season.label} · Entry {registrationLabel(registration.status)}
          </p>
        </div>
        <span className="tl-badge">Captain</span>
      </header>

      <h3 className={styles.sectionTitle}><Users size={16} aria-hidden /> Squad registrations</h3>
      {registrationsQ.isLoading ? <Skeleton lines={1} height={40} /> : registrationsQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load the squad.</p>
      ) : (
        <RegistrationSection
          registration={registration}
          players={registrationsQ.data ?? []}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ['captain-registrations', registration.id] })}
        />
      )}

      <h3 className={styles.sectionTitle}><CalendarDays size={16} aria-hidden /> Fixtures</h3>
      {fixturesQ.isLoading ? <Skeleton lines={2} height={48} /> : fixturesQ.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load fixtures.</p>
      ) : fixtures.length === 0 ? (
        <p className="tl-muted">No fixtures have been published for this team yet.</p>
      ) : (
        <ul className={styles.list}>
          {fixtures.map((fixture) => {
            const matchId = fixture.match?.id;
            const editable = Boolean(matchId) && (fixture.match?.status === 'scheduled' || fixture.match?.status === 'postponed');
            const open = openFixture === fixture.id;
            return (
              <li key={fixture.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <strong>{fixture.homeTeam.name} v {fixture.awayTeam.name}</strong>
                  <span className="tl-muted">
                    {formatDateTime(fixture.scheduledAt ?? undefined, DISPLAY_TIME_ZONE)}
                    {fixture.venue ? ` · ${fixture.venue}` : ''}
                    {fixture.round ? ` · Round ${fixture.round}` : ''}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  <span className="tl-badge">{fixture.match ? statusLabel(viewStatus(fixture.match.status)) : 'No match yet'}</span>
                  {matchId ? (
                    <button
                      type="button"
                      className="tl-btn tl-btn-sm"
                      onClick={() => setOpenFixture(open ? null : fixture.id)}
                      aria-expanded={open}
                      disabled={!editable}
                      title={editable ? undefined : 'A lineup cannot be edited after kick-off or for a cancelled fixture.'}
                    >
                      <ClipboardList size={14} aria-hidden /> {open ? 'Close lineup' : 'Lineup'}
                    </button>
                  ) : null}
                </div>
                {open && matchId ? (
                  <CaptainLineupPanel
                    matchId={matchId}
                    teamRegistrationId={registration.id}
                    teamName={team.name}
                    competitionId={competition.id}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CaptainLineupPanel({
  matchId,
  teamRegistrationId,
  teamName,
  competitionId,
}: {
  matchId: string;
  teamRegistrationId: string;
  teamName: string;
  competitionId: string;
}) {
  const [editing, setEditing] = useState(false);
  const lineupsQ = useQuery({
    queryKey: ['lineups', matchId],
    queryFn: () => lineupsApi.forMatch(matchId),
  });

  if (lineupsQ.isLoading) return <Skeleton lines={2} height={60} />;
  if (lineupsQ.isError) return <p className="tl-alert tl-alert-error" role="alert">Could not load the lineup for this match.</p>;

  const existing = lineupsQ.data?.find((lineup) => lineup.teamRegistrationId === teamRegistrationId) ?? null;
  if (existing && !editing) {
    return <div className={styles.editorWrap}><LineupReadView lineup={existing} teamRegistrationId={teamRegistrationId} teamName={teamName} onEdit={() => setEditing(true)} /></div>;
  }
  if (!existing && !editing) {
    return <div className={styles.editorWrap}><section className="tl-card"><h3>{teamName}</h3><p className="tl-muted">No lineup has been saved for this match.</p><button type="button" className="tl-btn tl-btn-primary" onClick={() => setEditing(true)}>Create Lineup</button></section></div>;
  }
  return (
    <div className={styles.editorWrap}>
      <LineupEditor
        key={`${matchId}:${existing?.id ?? 'new'}`}
        matchId={matchId}
        teamRegistrationId={teamRegistrationId}
        teamName={teamName}
        competitionId={competitionId}
        existing={existing}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    </div>
  );
}

function RegistrationSection({
  registration,
  players,
  onChanged,
}: {
  registration: CaptainTeamDto['registration'];
  players: PlayerRegistrationDto[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<PlayerRegistrationDto | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);

  return (
    <div className="tl-stack-sm">
      {players.length === 0 ? (
        <p className="tl-muted">No players have been registered for this team entry yet.</p>
      ) : (
        <div className="tl-scroll">
          <table className="tl-table">
            <caption className="sr-only">Squad registrations</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Position</th>
                <th scope="col" className="num">No.</th>
                <th scope="col">Status</th>
                <th scope="col">Note</th>
                <th scope="col">Changes</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id}>
                  <th scope="row">{player.player.fullName}</th>
                  <td>{positionLabel(player.player.position) ?? 'Not recorded'}</td>
                  <td className="num">{player.shirtNumber ?? '–'}</td>
                  <td><span className="tl-badge">{registrationLabel(player.status)}</span></td>
                  <td>{player.reviewNote ?? '—'}</td>
                  <td>{player.pendingEdit ? <span className="tl-badge">Edit pending review</span> : player.status === 'approved' ? <button type="button" className="tl-btn tl-btn-sm" onClick={() => setEditingPlayer(player)}>Edit</button> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <button type="button" className="tl-btn tl-btn-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Close registration form' : 'Register a player'}
        </button>
      </div>

      {open ? (
        <RegisterPlayerForm
          registration={registration}
          onDone={() => {
            setOpen(false);
            onChanged();
          }}
        />
      ) : null}
      {editNotice ? <p className="tl-alert tl-alert-success" role="status">{editNotice}</p> : null}
      {editingPlayer ? <EditPlayerRegistrationDialog player={editingPlayer} onCancel={() => setEditingPlayer(null)} onDone={() => { setEditingPlayer(null); setEditNotice(`${editingPlayer.player.fullName}: changes submitted for administrator review.`); onChanged(); }} /> : null}
    </div>
  );
}

function EditPlayerRegistrationDialog({ player, onCancel, onDone }: { player: PlayerRegistrationDto; onCancel: () => void; onDone: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialFocus = useRef<HTMLElement | null>(null);
  const [fullName, setFullName] = useState(player.player.fullName);
  const [department, setDepartment] = useState(player.player.department ?? '');
  const [position, setPosition] = useState(player.player.position ?? '');
  const [shirtNumber, setShirtNumber] = useState(player.shirtNumber?.toString() ?? '');
  const [matriculationNumber, setMatriculationNumber] = useState(player.matriculationNumber ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState(player.player.dateOfBirth ?? '');
  const [preferredFoot, setPreferredFoot] = useState(player.player.preferredFoot ?? '');
  const [contactEmail, setContactEmail] = useState(player.player.contactEmail ?? '');
  const dirty = fullName !== player.player.fullName || department !== (player.player.department ?? '') || position !== (player.player.position ?? '') || shirtNumber !== (player.shirtNumber?.toString() ?? '') || matriculationNumber !== (player.matriculationNumber ?? '') || dateOfBirth !== (player.player.dateOfBirth ?? '') || preferredFoot !== (player.player.preferredFoot ?? '') || contactEmail !== (player.player.contactEmail ?? '');

  useEffect(() => {
    initialFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
    return () => initialFocus.current?.focus();
  }, []);

  const dismiss = () => {
    if (pending) return;
    if (dirty && !window.confirm('Discard your unsaved player changes?')) return;
    onCancel();
  };
  const submit = async () => {
    const shirt = shirtNumber.trim() ? Number(shirtNumber) : null;
    if (fullName.trim().length < 2 || (shirt !== null && (!Number.isInteger(shirt) || shirt < 1 || shirt > 99))) { setError('Check the player name and shirt number.'); return; }
    setPending(true); setError(null);
    try {
      await registrationsApi.proposeEdit(player.id, { player: { fullName: fullName.trim(), department: department.trim() || null, dateOfBirth: dateOfBirth || null, position: (position || null) as PlayerPosition | null, preferredFoot: preferredFoot ? preferredFoot as 'left' | 'right' | 'both' : null, contactEmail: contactEmail.trim() || null }, matriculationNumber: matriculationNumber.trim() || null, shirtNumber: shirt });
      onDone();
    } catch (cause) { setError(errorMessage(cause)); } finally { setPending(false); }
  };
  return <dialog ref={dialogRef} className={styles.playerDialog} aria-labelledby="player-edit-title" onCancel={event => { event.preventDefault(); dismiss(); }} onClick={event => { if (event.target === dialogRef.current) dismiss(); }}>
    <form className={styles.playerDialogForm} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <header className={styles.playerDialogHead}><div><p className="tl-muted">Edit registered player</p><h2 id="player-edit-title">{player.player.fullName}</h2></div><button type="button" className="tl-btn tl-btn-sm" onClick={dismiss} disabled={pending} aria-label="Close player editor">Close</button></header>
      <p className="tl-muted">Changes stay pending until an administrator reviews them. The approved information remains in use meanwhile.</p>
      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}
      <div className={styles.formGrid}>
        <label className="tl-field"><span className="tl-label">Full name</span><input className="tl-input" autoFocus value={fullName} onChange={e => setFullName(e.target.value)} required maxLength={180} /></label>
        <label className="tl-field"><span className="tl-label">Department</span><input className="tl-input" value={department} onChange={e => setDepartment(e.target.value)} maxLength={120} /></label>
        <label className="tl-field"><span className="tl-label">Date of birth</span><input className="tl-input" type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} /></label>
        <label className="tl-field"><span className="tl-label">Position</span><select className="tl-select" value={position} onChange={e => setPosition(e.target.value)}>{PLAYER_POSITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="tl-field"><span className="tl-label">Preferred foot</span><select className="tl-select" value={preferredFoot} onChange={e => setPreferredFoot(e.target.value)}><option value="">Not recorded</option><option value="left">Left</option><option value="right">Right</option><option value="both">Both</option></select></label>
        <label className="tl-field"><span className="tl-label">Contact email</span><input className="tl-input" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} maxLength={320} /></label>
        <label className="tl-field"><span className="tl-label">Matriculation number</span><input className="tl-input" value={matriculationNumber} onChange={e => setMatriculationNumber(e.target.value)} maxLength={80} /></label>
        <label className="tl-field"><span className="tl-label">Shirt number</span><input className="tl-input" type="number" min={1} max={99} value={shirtNumber} onChange={e => setShirtNumber(e.target.value)} /></label>
      </div>
      <footer className={styles.playerDialogActions}><button type="button" className="tl-btn" onClick={dismiss} disabled={pending}>Cancel</button><button type="submit" className="tl-btn tl-btn-primary" disabled={pending}>{pending ? 'Submitting…' : 'Submit for review'}</button></footer>
    </form>
  </dialog>;
}

function RegisterPlayerForm({
  registration,
  onDone,
}: {
  registration: CaptainTeamDto['registration'];
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [matriculationNumber, setMatriculationNumber] = useState('');
  const [shirtNumber, setShirtNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (pending) return;
    setError(null);
    if (fullName.trim().length < 2) {
      setError('Enter the player’s full name.');
      return;
    }
    const shirt = shirtNumber.trim() === '' ? null : Number(shirtNumber);
    if (shirt !== null && (!Number.isInteger(shirt) || shirt < 1 || shirt > 99)) {
      setError('A shirt number must be a whole number from 1 to 99.');
      return;
    }
    setPending(true);
    try {
      await registrationsApi.submit({
        teamRegistrationId: registration.id,
        player: {
          fullName: fullName.trim(),
          department: department.trim() || null,
          position: (position || null) as PlayerPosition | null,
        },
        matriculationNumber: matriculationNumber.trim() || null,
        shirtNumber: shirt,
      });
      onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error ? <p className="tl-alert tl-alert-error" role="alert">{error}</p> : null}
      <div className={styles.formGrid}>
        <label className="tl-field">
          <span className="tl-label">Full name</span>
          <input className="tl-input" value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={180} required />
        </label>
        <label className="tl-field">
          <span className="tl-label">Department</span>
          <input className="tl-input" value={department} onChange={(event) => setDepartment(event.target.value)} maxLength={120} />
        </label>
        <label className="tl-field">
          <span className="tl-label">Position</span>
          <select className="tl-select" value={position} onChange={(event) => setPosition(event.target.value)}>
            {PLAYER_POSITION_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="tl-field">
          <span className="tl-label">Matriculation number</span>
          <input className="tl-input" value={matriculationNumber} onChange={(event) => setMatriculationNumber(event.target.value)} maxLength={80} />
        </label>
        <label className="tl-field">
          <span className="tl-label">Shirt number</span>
          <input className="tl-input" type="number" min={1} max={99} value={shirtNumber} onChange={(event) => setShirtNumber(event.target.value)} />
        </label>
      </div>
      <button type="submit" className="tl-btn tl-btn-primary" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit registration'}
      </button>
    </form>
  );
}
