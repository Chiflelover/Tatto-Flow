import type { Prisma, ScaleReferenceType } from '../../../generated/prisma/client.js';

export interface VisionStyle {
  code: string;
  name: string;
}

export interface ImageAnalysisV2Observation {
  validTattooReference: boolean;
  referenceValidationConfidence: number;
  compositionAspectRatio: number | null;
  compositionFillRatio: number | null;
  style: string | null;
  styleConfidence: number;
  scaleReferenceType: ScaleReferenceType;
  scaleConfidence: number;
  referenceMainDimensionCm: number | null;
  referenceAreaCm2: number | null;
  areaConfidence: number;
  colorCoverage: number | null;
  colorConfidence: number;
  overallConfidence: number;
  referenceEssentiallyBlack: boolean;
  extensiveBodyCoverage: boolean;
}

export interface ImageAnalysisV2Result {
  observations: ImageAnalysisV2Observation;
  provider: 'gemini' | 'openai' | 'mock';
  model: string;
  promptVersion: number;
  schemaVersion: string;
  rawResponse: Prisma.InputJsonValue;
}
