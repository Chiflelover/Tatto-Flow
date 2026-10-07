import styles from '@/styles/dashboard.module.css';

export function ActionLabel({
  label,
  pendingLabel,
  pending,
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
}) {
  return (
    <span className={styles.actionLabel}>
      <span className={pending ? styles.hiddenLabel : undefined} aria-hidden={pending}>
        {label}
      </span>
      <span className={!pending ? styles.hiddenLabel : undefined} aria-hidden={!pending}>
        {pendingLabel}
      </span>
    </span>
  );
}
