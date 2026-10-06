import { LeadStatus } from '../../../generated/prisma/client.js';

const STATUS_LABELS: Record<LeadStatus, string> = {
  [LeadStatus.ANALYZING]: 'Analizando',
  [LeadStatus.REQUIRES_REVIEW]: 'Requiere revisión',
  [LeadStatus.HANDOFF_TO_TATTOO_ARTIST]: 'En atención',
  [LeadStatus.COMPLETED]: 'Finalizado',
  [LeadStatus.AUTO_QUOTED]: 'Cotización automática lista',
  [LeadStatus.SPECIAL_REVIEW]: 'Revisión especial',
  [LeadStatus.READY_TO_COORDINATE]: 'Listo para coordinar',
};

export function statusLabel(status: LeadStatus): string {
  return STATUS_LABELS[status];
}

export function formatMoney(value: { toFixed(decimalPlaces: number): string }): string {
  return value
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

export function buildWhatsappUrl(phoneNumber: string): string | null {
  const digits = phoneNumber.replace(/\D/g, '');

  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}
