import styles from '@/styles/dashboard.module.css';

export function DashboardLoading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className={styles.feedbackState} role="status">
      <span className={styles.loader} aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function DashboardError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className={styles.errorState} role="alert">
      <strong>No pudimos cargar esta información</strong>
      <p>{message}</p>
      {retry && (
        <button type="button" onClick={retry}>
          Intentar nuevamente
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className={styles.emptyState}>{children}</div>;
}
