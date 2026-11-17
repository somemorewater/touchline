import Link from 'next/link';
import type { Team } from '@/types';
import type { StandingRow } from '@/features/standings/types';
import { signed } from '@/lib/format';
import { Crest } from './Crest';
import styles from './StandingsTable.module.css';

const FORM_LABEL = { W: 'Win', D: 'Draw', L: 'Loss' } as const;

export function StandingsTable({ caption, rows, teams, compact = false }: { caption: string; rows: StandingRow[]; teams: Map<string, Team>; compact?: boolean }) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.pos}><abbr title="Position">#</abbr></th>
            <th scope="col" className={styles.team}>Team</th>
            <th scope="col"><abbr title="Played">P</abbr></th>
            {compact ? null : (<>
              <th scope="col"><abbr title="Won">W</abbr></th>
              <th scope="col"><abbr title="Drawn">D</abbr></th>
              <th scope="col"><abbr title="Lost">L</abbr></th>
              <th scope="col"><abbr title="Goals for">GF</abbr></th>
              <th scope="col"><abbr title="Goals against">GA</abbr></th>
            </>)}
            <th scope="col"><abbr title="Goal difference">GD</abbr></th>
            <th scope="col"><abbr title="Points">Pts</abbr></th>
            {compact ? null : <th scope="col" className={styles.formCol}>Form</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = teams.get(r.teamId);
            const name = t?.name ?? r.teamId;
            return (
              <tr key={r.teamId}>
                <td className={`${styles.pos} num`}>{r.position}</td>
                <th scope="row" className={styles.team}>
                  <Link href={`/teams/${r.teamId}`}><Crest name={name} size={22} /><span>{name}</span></Link>
                </th>
                <td className="num">{r.played}</td>
                {compact ? null : (<>
                  <td className="num">{r.won}</td><td className="num">{r.drawn}</td><td className="num">{r.lost}</td>
                  <td className="num">{r.goalsFor}</td><td className="num">{r.goalsAgainst}</td>
                </>)}
                <td className="num">{signed(r.goalDifference)}</td>
                <td className={`${styles.pts} num`}>{r.points}</td>
                {compact ? null : (
                  <td className={styles.formCol}>
                    {!r.form || r.form.length === 0 ? <span className={styles.none}>Not recorded</span> : (
                      <span className={styles.form}>
                        {r.form.map((f, i) => <span key={i} className={`${styles.pill} ${styles[f]}`} title={FORM_LABEL[f]}>{f}<span className="sr-only"> {FORM_LABEL[f]}</span></span>)}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
