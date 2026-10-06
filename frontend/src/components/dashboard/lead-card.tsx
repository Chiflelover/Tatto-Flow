import Link from 'next/link';
import type { LeadStatus, LeadSummary } from '@/lib/dashboard-api';
import { leadPriceLabel } from '@/lib/lead-price';
import styles from '@/styles/dashboard.module.css';

const STATUS_CLASS: Record<LeadStatus, string> = {
  ANALYZING: styles.statusAnalyzing,
  REQUIRES_REVIEW: styles.statusReview,
  HANDOFF_TO_TATTOO_ARTIST: styles.statusAttention,
  COMPLETED: styles.statusCompleted,
  AUTO_QUOTED: styles.statusVerified,
  SPECIAL_REVIEW: styles.statusReview,
  READY_TO_COORDINATE: styles.statusAttention,
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
  const price = leadPriceLabel(lead);

  return (
    <article className={styles.leadCard}>
      <Link href={`/dashboard/leads/${lead.id}`} className={styles.leadLink}>
        <div className={styles.leadTopline}>
          <strong>{lead.customerPhoneNumber}</strong>
          <StatusBadge status={lead.status} label={lead.statusLabel} />
        </div>
        <p className={styles.leadDescription}>
          {`${lead.v2.style ?? 'Estilo pendiente'} · ${lead.v2.targetAreaCm2 ?? 'Área pendiente'}${lead.v2.targetAreaCm2 ? ' cm²' : ''}`}{' '}
          · {lead.bodyPart ?? 'Zona pendiente'}
        </p>
        {lead.v2?.bookingIntent && (
          <p className={styles.leadDescription}>
            {lead.v2.bookingIntent === 'DIRECT_BOOKING'
              ? 'Solicita coordinar una cita'
              : 'Solicita contacto del tatuador'}
          </p>
        )}
        <div className={styles.leadBottomline}>
          <span>{DATE_FORMATTER.format(new Date(lead.createdAt))}</span>
          <strong>{price === '—' ? 'Precio pendiente' : price}</strong>
        </div>
      </Link>
    </article>
  );
}
