import type { LeadSummary, ReadinessStatus } from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

const READINESS_CLASS: Record<ReadinessStatus, string> = {
  LISTO: styles.readinessReady,
  REVISAR: styles.readinessReview,
  INCOMPLETO: styles.readinessIncomplete,
};

export function ReadinessBadge({ status }: { status: ReadinessStatus | null }) {
  if (!status) {
    return (
      <span className={`${styles.readinessBadge} ${styles.readinessUnrated}`}>SIN EVALUAR</span>
    );
  }

  return <span className={`${styles.readinessBadge} ${READINESS_CLASS[status]}`}>{status}</span>;
}

export function ReadinessScore({
  readiness,
  confidence,
}: {
  readiness: LeadSummary['readiness'];
  confidence?: LeadSummary['confidence'];
}) {
  if (!readiness) {
    return <span className={styles.scoreUnavailable}>—</span>;
  }

  const score = Math.min(100, Math.max(0, readiness.score));
  const confidenceLabel = confidence
    ? `Tamaño IA: ${Math.round(confidence.size * 100)}%. Detalle IA: ${Math.round(
        confidence.detail * 100,
      )}%.`
    : null;

  return (
    <div
      className={styles.readinessScore}
      aria-label={`Confianza ${score}%${confidenceLabel ? `. ${confidenceLabel}` : ''}`}
      title={confidenceLabel ?? undefined}
    >
      <strong>{score}%</strong>
      <span
        className={styles.scoreTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
      >
        <span className={styles.scoreFill} style={{ width: `${score}%` }} />
      </span>
    </div>
  );
}
