import {
  DetailLevel,
  LeadStatus,
  ReviewReason,
  TattooSize,
} from '../../../generated/prisma/client.js';

const SIZE_LABELS: Record<TattooSize, string> = {
  [TattooSize.SMALL]: 'Pequeño',
  [TattooSize.MEDIUM]: 'Mediano',
  [TattooSize.LARGE]: 'Grande',
};

const SIZE_RANGE_LABELS: Record<TattooSize, string> = {
  [TattooSize.SMALL]: '4–6 cm',
  [TattooSize.MEDIUM]: '12–16 cm',
  [TattooSize.LARGE]: '22–28 cm',
};

const DETAIL_LABELS: Record<DetailLevel, string> = {
  [DetailLevel.LIGHT]: 'Ligero',
  [DetailLevel.MEDIUM]: 'Medio',
  [DetailLevel.DETAILED]: 'Detallado',
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  [LeadStatus.ANALYZING]: 'Analizando',
  [LeadStatus.VERIFIED]: 'Verificado',
  [LeadStatus.REQUIRES_REVIEW]: 'Requiere revisión',
  [LeadStatus.HANDOFF_TO_TATTOO_ARTIST]: 'En atención',
  [LeadStatus.COMPLETED]: 'Finalizado',
};

const REVIEW_MESSAGES: Record<ReviewReason, string> = {
  [ReviewReason.SIZE_MISMATCH]: 'El tamaño detectado no coincide con lo indicado por el cliente.',
  [ReviewReason.DETAIL_MISMATCH]:
    'El nivel de detalle detectado no coincide con lo indicado por el cliente.',
  [ReviewReason.LOW_SIZE_CONFIDENCE]:
    'La IA no tuvo suficiente confianza al identificar el tamaño.',
  [ReviewReason.LOW_DETAIL_CONFIDENCE]:
    'La IA no tuvo suficiente confianza al identificar el nivel de detalle.',
  [ReviewReason.AI_ERROR]: 'No se pudo analizar la referencia automáticamente.',
  [ReviewReason.PRICING_RULE_NOT_FOUND]:
    'No hay una regla de precios activa para esta combinación.',
};

export function sizeLabel(size: TattooSize): string {
  return SIZE_LABELS[size];
}

export function sizeRangeLabel(size: TattooSize): string {
  return SIZE_RANGE_LABELS[size];
}

export function detailLabel(detail: DetailLevel): string {
  return DETAIL_LABELS[detail];
}

export function statusLabel(status: LeadStatus): string {
  return STATUS_LABELS[status];
}

export function reviewReasonMessage(reason: ReviewReason): string {
  return REVIEW_MESSAGES[reason];
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
