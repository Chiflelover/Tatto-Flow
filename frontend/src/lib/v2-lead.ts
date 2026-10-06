import type { BookingIntent } from './dashboard-api';

export function bookingIntentLabel(intent: BookingIntent | null): string {
  return intent === 'DIRECT_BOOKING'
    ? 'Quiere coordinar una cita'
    : intent === 'ARTIST_CONTACT'
      ? 'Prefiere contacto del tatuador'
      : 'Sin elección de cita';
}

const REVIEW_LABELS: Record<string, string> = {
  ANALYSIS_FAILED: 'No se pudo completar el análisis',
  INVALID_ANALYSIS: 'El análisis no contiene datos válidos',
  REFERENCE_UNAVAILABLE: 'La referencia no está disponible para análisis',
  INCOMPLETE_INTAKE: 'Faltan respuestas del cliente',
  LOW_OVERALL_CONFIDENCE: 'El análisis requiere confirmación del tatuador',
  BODY_CONTEXT_SCALE: 'Las medidas se estimaron mediante anatomía',
  INSUFFICIENT_SCALE: 'La referencia no ofrece escala física suficiente',
  MISSING_REFERENCE_MEASUREMENTS: 'Faltan medidas de la referencia',
  MISSING_COMPOSITION_GEOMETRY: 'No se pudo estimar la geometría de la composición',
  INVALID_TARGET_MEASUREMENTS: 'No fue posible calcular medidas objetivo válidas',
  STYLE_UNKNOWN: 'El estilo no pudo identificarse',
  STYLE_NOT_ENABLED: 'El estilo no está habilitado para tu cuenta',
  MISSING_COLOR_COVERAGE: 'Falta información sobre cobertura de color',
  INVALID_COLOR_COVERAGE: 'La cobertura de color no es válida',
  INCONSISTENT_COLOR_OBSERVATIONS: 'La información sobre el color necesita revisión',
  TARGET_COLOR_NOT_DECLARED: 'Falta una elección explícita del nivel de color del cliente',
  INVALID_PREPARATION: 'Los datos preparados necesitan revisión',
  PRICING_MODEL_NOT_AVAILABLE: 'No hay modelo de precios activo para este estilo',
  MODEL_NOT_APPLICABLE: 'El modelo no puede cotizar estas entradas sin extrapolar',
  SPECIAL_REVIEW_COLOR_MODIFICATION: 'El cliente desea añadir color a una referencia negra',
  EXTENSIVE_BODY_COVERAGE: 'La referencia muestra cobertura corporal extensa',
};

export function v2ReviewLabel(code: string): string {
  return REVIEW_LABELS[code] ?? 'Requiere revisión del tatuador';
}
