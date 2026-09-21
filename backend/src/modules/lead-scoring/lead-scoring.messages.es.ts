import type { GateRuleId, ScoringRuleId } from './domain/lead-scoring.types.js';

export const SCORING_CONTRIBUTION_MESSAGES_ES: Record<ScoringRuleId, string> = {
  SIZE_PROVIDED: 'El cliente indicó el tamaño',
  DETAIL_PROVIDED: 'El cliente indicó el nivel de detalle',
  BODY_PART_PROVIDED: 'El cliente indicó la zona corporal',
  REFERENCE_RECEIVED: 'El cliente envió una imagen de referencia',
  TATTOO_ON_SKIN: 'La referencia muestra un tatuaje aplicado sobre piel',
  REFERENCE_ANALYZABLE: 'La imagen de referencia puede analizarse',
  SIZE_MATCH: 'El tamaño indicado coincide con el análisis',
  DETAIL_MATCH: 'El detalle indicado coincide con el análisis',
  NO_MAJOR_CONTRADICTIONS: 'No se detectaron contradicciones importantes',
  MINOR_AMBIGUITY: 'La referencia presenta una ambigüedad menor',
  SIZE_MISMATCH: 'El tamaño indicado no coincide con el análisis',
  DETAIL_MISMATCH: 'El detalle indicado no coincide con el análisis',
  HARD_TO_ANALYZE: 'La imagen de referencia es difícil de analizar',
  NOT_ON_SKIN: 'La referencia no muestra un tatuaje aplicado sobre piel',
};

export const SCORING_BLOCKER_MESSAGES_ES: Record<GateRuleId, string> = {
  FLOW_INCOMPLETE: 'La cotización está incompleta o la conversación fue abandonada',
  NOT_ON_SKIN: 'La referencia no corresponde a un tatuaje aplicado sobre piel',
  SIZE_MISMATCH: 'El tamaño indicado no coincide con el análisis',
  DETAIL_MISMATCH: 'El detalle indicado no coincide con el análisis',
  LOW_SIZE_CONFIDENCE: 'La confianza del tamaño detectado es menor al 90%',
  LOW_DETAIL_CONFIDENCE: 'La confianza del detalle detectado es menor al 90%',
};
