import styles from './SiteFooter.module.css';

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <strong>TOUCHLINE</strong>
        <span>Competition coverage for departmental football.</span>
      </div>
    </footer>
  );
}
