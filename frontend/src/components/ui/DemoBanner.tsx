'use client';

import { IS_DEMO_DATA } from '@/config/data-mode';
import styles from './DemoBanner.module.css';

/** Shown whenever invented sample matches are loaded, so nobody mistakes them for results. */
export function DemoBanner() {
  if (!IS_DEMO_DATA) return null;
  return (
    <div className={styles.banner} role="note">
      <strong>Demo data.</strong> Fixtures and scores on this site are invented for development. Teams and leagues are the real entries.
    </div>
  );
}
