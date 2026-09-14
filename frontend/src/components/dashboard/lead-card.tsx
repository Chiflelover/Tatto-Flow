import Link from 'next/link';
import type { LeadStatus, LeadSummary } from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

const STATUS_CLASS: Record<LeadStatus, string> = {
  ANALYZING: styles.statusAnalyzing,
  VERIFIED: styles.statusVerified,
  REQUIRES_REVIEW: styles.statusReview,
  HANDOFF_TO_TATTOO_ARTIST: styles.statusAttention,
  COMPLETED: styles.statusCompleted,
};

const DATE_FORMATTER = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function StatusBadge({ status, label }: { status: LeadStatus; label: string }) {
  return <span className={`${styles.statusBadge} ${STATUS_CLASS[status]}`}>{label}</span>;
}

export function LeadCard({ lead }: { lead: LeadSummary }) {
  return (
    <article className={styles.leadCard}>
      <Link href={`/dashboard/leads/${lead.id}`} className={styles.leadLink}>
        <div className={styles.leadTopline}>
          <strong>{lead.customerPhoneNumber}</strong>
          <StatusBadge status={lead.status} label={lead.statusLabel} />
        </div>
        <p className={styles.leadDescription}>
          {lead.selectedSizeLabel} · {lead.selectedDetailLabel} · {lead.bodyPart}
        </p>
        <div className={styles.leadBottomline}>
          <span>{DATE_FORMATTER.format(new Date(lead.createdAt))}</span>
          <strong>
            {lead.price ? `S/${lead.price.minimum} – S/${lead.price.maximum}` : 'Precio pendiente'}
          </strong>
        </div>
      </Link>
    </article>
  );
}
