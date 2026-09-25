import { DetailLevel, TattooSize } from '../../generated/prisma/client.js';
import { ImageAmbiguityLevel, type ImageAnalysisResult } from './domain/image-analysis.types.js';

const RESPONSE_KEYS = Object.freeze([
  'detectedSize',
  'sizeConfidence',
  'detectedDetail',
  'detailConfidence',
  'tattooOnSkin',
  'tattooOnSkinConfidence',
  'referenceAnalyzable',
  'analyzabilityConfidence',
  'ambiguityLevel',
]);

export class InvalidImageAnalysisResponseError extends Error {
  constructor() {
    super('The image analysis provider returned an invalid structured response.');
    this.name = InvalidImageAnalysisResponseError.name;
  }
}

export function parseImageAnalysisResponse(text: string | undefined): ImageAnalysisResult {
  let value: unknown;

  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    throw new InvalidImageAnalysisResponseError();
  }

  if (!isImageAnalysisResult(value)) {
    throw new InvalidImageAnalysisResponseError();
  }

  return value;
}

export function isImageAnalysisResult(value: unknown): value is ImageAnalysisResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);

  return (
    keys.length === RESPONSE_KEYS.length &&
    keys.every((key) => RESPONSE_KEYS.includes(key)) &&
    Object.values(TattooSize).includes(candidate.detectedSize as TattooSize) &&
    isConfidence(candidate.sizeConfidence) &&
    Object.values(DetailLevel).includes(candidate.detectedDetail as DetailLevel) &&
    isConfidence(candidate.detailConfidence) &&
    typeof candidate.tattooOnSkin === 'boolean' &&
    isConfidence(candidate.tattooOnSkinConfidence) &&
    typeof candidate.referenceAnalyzable === 'boolean' &&
    isConfidence(candidate.analyzabilityConfidence) &&
    Object.values(ImageAmbiguityLevel).includes(candidate.ambiguityLevel as ImageAmbiguityLevel)
  );
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
