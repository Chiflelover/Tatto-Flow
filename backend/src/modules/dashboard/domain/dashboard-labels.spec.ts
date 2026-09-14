import { ReviewReason } from '../../../generated/prisma/client.js';
import { buildWhatsappUrl, reviewReasonMessage } from './dashboard-labels.js';

describe('dashboard labels', () => {
  it.each([
    [ReviewReason.SIZE_MISMATCH, 'El tamaño detectado no coincide con lo indicado por el cliente.'],
    [
      ReviewReason.DETAIL_MISMATCH,
      'El nivel de detalle detectado no coincide con lo indicado por el cliente.',
    ],
    [
      ReviewReason.LOW_SIZE_CONFIDENCE,
      'La IA no tuvo suficiente confianza al identificar el tamaño.',
    ],
    [
      ReviewReason.LOW_DETAIL_CONFIDENCE,
      'La IA no tuvo suficiente confianza al identificar el nivel de detalle.',
    ],
    [ReviewReason.AI_ERROR, 'No se pudo analizar la referencia automáticamente.'],
  ])('translates %s without exposing the internal code', (reason, expected) => {
    expect(reviewReasonMessage(reason)).toBe(expected);
    expect(reviewReasonMessage(reason)).not.toContain(reason);
  });

  it('builds a WhatsApp URL using only the normalized customer number', () => {
    expect(buildWhatsappUrl('+51 999-999-999')).toBe('https://wa.me/51999999999');
    expect(buildWhatsappUrl('not-a-phone')).toBeNull();
  });
});
