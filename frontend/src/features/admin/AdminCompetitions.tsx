'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, Send, Undo2 } from 'lucide-react';
import { useActiveCompetition } from '@/features/competitions/CompetitionContext';
import { useAuth } from '@/features/auth/AuthProvider';
import { competitionsApi } from '@/lib/api/endpoints';
import type { CompetitionDto, GroupDto } from '@/lib/api/types';
import { AdminSection, Feedback, Field, statusLabel, useAdminAction } from './ui';
import styles from './Admin.module.css';

const FORMATS: CompetitionDto['format'][] = [
  'single-league',
  'multiple-leagues',
  'group-stage',
  'knockout',
  'league-then-knockout',
];

export function AdminCompetitions() {
  const { competitions, competition, seasons, season, selectCompetition, selectSeason } = useActiveCompetition();
  const { can, canIn } = useAuth();
  const queryClient = useQueryClient();
  const action = useAdminAction();

  const canUpdate = competition ? canIn('competitions.update', competition.id) : false;

  const invalidateCompetitions = (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['competitions'] });
    if (id) void queryClient.invalidateQueries({ queryKey: ['competition', id] });
  };
  const invalidateSeasons = () => {
    if (competition) {
      void queryClient.invalidateQueries({ queryKey: ['seasons', competition.id] });
      void queryClient.invalidateQueries({ queryKey: ['competition', competition.id] });
    }
  };
  const invalidateGroups = () => {
    if (season) void queryClient.invalidateQueries({ queryKey: ['admin-groups', season.id] });
  };

  const run = (key: string, task: () => Promise<string | void>) => {
    void action.run(key, task);
  };

  return (
    <AdminSection
      title="Competitions, seasons and groups"
      description="Competitions are created globally, then administered inside their own scope. The backend still checks each transition."
    >
      <Feedback error={action.error} notice={action.notice} />

      <div className={styles.list}>
        {competitions.map((entry) => {
          const active = entry.id === competition?.id;
          const entryCanUpdate = canIn('competitions.update', entry.id);
          const entryCanPublish = canIn('competitions.publish', entry.id);
          return (
            <div key={entry.id} className={`${styles.entryRow} ${active ? styles.entryActive : ''}`}>
              <div className={styles.entryMain}>
                <strong>{entry.name}</strong>
                <span className={styles.muted}>
                  {entry.slug} · {entry.format.replaceAll('-', ' ')} · {entry.visibility}
                </span>
              </div>
              <div className={styles.rowActions}>
                <span className="tl-badge">{statusLabel(entry.status)}</span>
                {active ? (
                  <span className="tl-badge">Selected</span>
                ) : (
                  <button type="button" className="tl-btn tl-btn-sm" onClick={() => selectCompetition(entry.id)}>
                    Select
                  </button>
                )}
                {entryCanPublish && entry.status === 'draft' ? (
                  <button
                    type="button"
                    className="tl-btn tl-btn-sm tl-btn-primary"
                    disabled={action.pending !== null}
                    onClick={() => run(`publish:${entry.id}`, async () => {
                      await competitionsApi.publish(entry.id);
                      invalidateCompetitions(entry.id);
                      return `${entry.name} published.`;
                    })}
                  >
                    <Send size={13} aria-hidden /> Publish
                  </button>
                ) : null}
                {entryCanPublish && entry.status === 'published' ? (
                  <button
                    type="button"
                    className="tl-btn tl-btn-sm"
                    disabled={action.pending !== null}
                    onClick={() => run(`unpublish:${entry.id}`, async () => {
                      await competitionsApi.unpublish(entry.id);
                      invalidateCompetitions(entry.id);
                      return `${entry.name} returned to draft.`;
                    })}
                  >
                    <Undo2 size={13} aria-hidden /> Unpublish
                  </button>
                ) : null}
                {entryCanUpdate && entry.status !== 'archived' ? (
                  <button
                    type="button"
                    className="tl-btn tl-btn-sm tl-btn-danger"
                    disabled={action.pending !== null}
                    onClick={() => run(`archive:${entry.id}`, async () => {
                      await competitionsApi.archive(entry.id);
                      invalidateCompetitions(entry.id);
                      invalidateSeasons();
                      return `${entry.name} archived.`;
                    })}
                  >
                    <Archive size={13} aria-hidden /> Archive
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {competitions.length === 0 ? <p className={styles.muted}>No competitions are visible to your account.</p> : null}
      </div>

      {can('competitions.create') ? (
        <CreateCompetition
          pending={action.pending === 'create-competition'}
          onCreate={async (input) => {
            const created = await competitionsApi.create(input);
            invalidateCompetitions(created.id);
            selectCompetition(created.id);
            return `${created.name} created as a draft.`;
          }}
          run={run}
        />
      ) : (
        <p className={styles.muted}>Only a super administrator can create a competition.</p>
      )}

      {competition ? (
        <>
          <div className={styles.divider} />

          <h3 className={styles.subheading}>Seasons in {competition.name}</h3>
          <div className={styles.list}>
            {seasons.map((entry) => (
              <div key={entry.id} className={`${styles.entryRow} ${entry.id === season?.id ? styles.entryActive : ''}`}>
                <div className={styles.entryMain}>
                  <strong>{entry.label}</strong>
                  <span className={styles.muted}>
                    {entry.startsOn ?? 'Start not set'} → {entry.endsOn ?? 'End not set'}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  <span className="tl-badge">{statusLabel(entry.status)}</span>
                  {entry.id === season?.id ? <span className="tl-badge">Selected</span> : (
                    <button type="button" className="tl-btn tl-btn-sm" onClick={() => selectSeason(entry.id)}>Select</button>
                  )}
                  {canUpdate && entry.status === 'planned' ? (
                    <button
                      type="button"
                      className="tl-btn tl-btn-sm tl-btn-primary"
                      disabled={action.pending !== null}
                      onClick={() => run(`activate-season:${entry.id}`, async () => {
                        await competitionsApi.activateSeason(entry.id);
                        invalidateSeasons();
                        return `${entry.label} activated.`;
                      })}
                    >
                      Activate
                    </button>
                  ) : null}
                  {canUpdate && (entry.status === 'planned' || entry.status === 'active') ? (
                    <button
                      type="button"
                      className="tl-btn tl-btn-sm"
                      disabled={action.pending !== null}
                      onClick={() => run(`close-season:${entry.id}`, async () => {
                        await competitionsApi.closeSeason(entry.id);
                        invalidateSeasons();
                        return `${entry.label} completed.`;
                      })}
                    >
                      Close
                    </button>
                  ) : null}
                  {canUpdate && entry.status !== 'archived' ? (
                    <button
                      type="button"
                      className="tl-btn tl-btn-sm tl-btn-danger"
                      disabled={action.pending !== null}
                      onClick={() => run(`archive-season:${entry.id}`, async () => {
                        await competitionsApi.archiveSeason(entry.id);
                        invalidateSeasons();
                        return `${entry.label} archived.`;
                      })}
                    >
                      Archive
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {seasons.length === 0 ? <p className={styles.muted}>No seasons have been created for this competition.</p> : null}
          </div>

          {canUpdate ? (
            <CreateSeason
              pending={action.pending === 'create-season'}
              competitionId={competition.id}
              onCreate={async (input) => {
                const created = await competitionsApi.createSeason(competition.id, input);
                invalidateSeasons();
                return `${created.label} created as planned.`;
              }}
              run={run}
            />
          ) : null}

          {season ? (
            <>
              <div className={styles.divider} />
              <h3 className={styles.subheading}>Groups in {season.label}</h3>
              <GroupsPanel
                season={season}
                canManage={canUpdate && (season.status === 'planned' || season.status === 'active')}
                onChanged={invalidateGroups}
                run={run}
                pending={action.pending}
              />
            </>
          ) : null}
        </>
      ) : null}
    </AdminSection>
  );
}

function CreateCompetition({
  pending,
  onCreate,
  run,
}: {
  pending: boolean;
  onCreate: (input: { slug: string; name: string; description: string | null; format: string; visibility: string }) => Promise<string>;
  run: (key: string, task: () => Promise<string | void>) => void;
}) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<CompetitionDto['format']>('single-league');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        run('create-competition', async () => {
          const message = await onCreate({
            slug: slug.trim(),
            name: name.trim(),
            description: description.trim() || null,
            format,
            visibility,
          });
          setSlug('');
          setName('');
          setDescription('');
          return message;
        });
      }}
    >
      <h3>Create a competition</h3>
      <div className={styles.formGrid}>
        <Field label="Name">
          <input className="tl-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required />
        </Field>
        <Field label="Slug" hint="Lowercase letters, numbers and single hyphens.">
          <input
            className="tl-input"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={120}
            required
          />
        </Field>
        <Field label="Format">
          <select className="tl-select" value={format} onChange={(event) => setFormat(event.target.value as CompetitionDto['format'])}>
            {FORMATS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </Field>
        <Field label="Visibility">
          <select className="tl-select" value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'private')}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </Field>
      </div>
      <Field label="Description">
        <textarea className="tl-textarea" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} />
      </Field>
      <div className={styles.formActions}>
        <button type="submit" className="tl-btn tl-btn-primary" disabled={pending}>
          <Plus size={15} aria-hidden /> {pending ? 'Creating…' : 'Create competition'}
        </button>
      </div>
    </form>
  );
}

function CreateSeason({
  pending,
  competitionId,
  onCreate,
  run,
}: {
  pending: boolean;
  competitionId: string;
  onCreate: (input: { label: string; startsOn?: string | null; endsOn?: string | null }) => Promise<string>;
  run: (key: string, task: () => Promise<string | void>) => void;
}) {
  const [label, setLabel] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        run(`create-season:${competitionId}`, async () => {
          const message = await onCreate({
            label: label.trim(),
            startsOn: startsOn || null,
            endsOn: endsOn || null,
          });
          setLabel('');
          setStartsOn('');
          setEndsOn('');
          return message;
        });
      }}
    >
      <h3>Create a season</h3>
      <div className={styles.formGrid}>
        <Field label="Label">
          <input className="tl-input" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} required />
        </Field>
        <Field label="Starts on">
          <input className="tl-input" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
        </Field>
        <Field label="Ends on">
          <input className="tl-input" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
        </Field>
      </div>
      <div className={styles.formActions}>
        <button type="submit" className="tl-btn tl-btn-primary" disabled={pending}>
          <Plus size={15} aria-hidden /> {pending ? 'Creating…' : 'Create season'}
        </button>
      </div>
    </form>
  );
}

function GroupsPanel({
  season,
  canManage,
  onChanged,
  run,
  pending,
}: {
  season: { id: string; label: string };
  canManage: boolean;
  onChanged: () => void;
  run: (key: string, task: () => Promise<string | void>) => void;
  pending: string | null;
}) {
  const q = useQuery({ queryKey: ['admin-groups', season.id], queryFn: () => competitionsApi.groups(season.id) });
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GroupDto['kind']>('league');

  return (
    <>
      {q.isLoading ? <p className={styles.muted}>Loading groups…</p> : q.isError ? (
        <p className="tl-alert tl-alert-error" role="alert">Could not load the groups for this season.</p>
      ) : (q.data ?? []).length === 0 ? (
        <p className={styles.muted}>No groups or leagues have been created for this season.</p>
      ) : (
        <div className={styles.list}>
          {q.data!.map((group) => (
            <div key={group.id} className={styles.entryRow}>
              <div className={styles.entryMain}>
                <strong>{group.name}</strong>
                <span className={styles.muted}>{group.kind === 'league' ? 'League' : 'Group'}</span>
              </div>
              <div className={styles.rowActions}>
                {group.archivedAt ? <span className="tl-badge">Archived</span> : null}
                {canManage && !group.archivedAt ? (
                  <button
                    type="button"
                    className="tl-btn tl-btn-sm tl-btn-danger"
                    disabled={pending !== null}
                    onClick={() => run(`archive-group:${group.id}`, async () => {
                      await competitionsApi.archiveGroup(group.id);
                      onChanged();
                      return `${group.name} archived.`;
                    })}
                  >
                    Archive
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <form
          className={`${styles.form} ${styles.inlineForm}`}
          onSubmit={(event) => {
            event.preventDefault();
            run(`create-group:${season.id}`, async () => {
              const created = await competitionsApi.createGroup(season.id, { name: name.trim(), kind });
              setName('');
              onChanged();
              return `${created.name} created.`;
            });
          }}
        >
          <Field label="Group name">
            <input className="tl-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
          </Field>
          <Field label="Kind">
            <select className="tl-select" value={kind} onChange={(event) => setKind(event.target.value as GroupDto['kind'])}>
              <option value="league">League</option>
              <option value="group">Group</option>
            </select>
          </Field>
          <button type="submit" className="tl-btn" disabled={pending !== null}>
            <Plus size={15} aria-hidden /> Add group
          </button>
        </form>
      ) : (
        <p className={styles.muted}>Groups can only be changed while the season is planned or active.</p>
      )}
    </>
  );
}
