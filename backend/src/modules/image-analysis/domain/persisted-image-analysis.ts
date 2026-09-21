import { Prisma, type AiAnalysis } from '../../../generated/prisma/client.js';
import { ImageAmbiguityLevel, type ImageAnalysisResult } from './image-analysis.types.js';

export function toImageAnalysisResult(analysis: AiAnalysis): ImageAnalysisResult {
  const rawResponse = asRawResponse(analysis.rawResponse);

  return {
    detectedSize: analysis.detectedSize,
    sizeConfidence: analysis.sizeConfidence.toNumber(),
    detectedDetail: analysis.detectedDetail,
    detailConfidence: analysis.detailConfidence.toNumber(),
    tattooOnSkin: typeof rawResponse?.tattooOnSkin === 'boolean' ? rawResponse.tattooOnSkin : true,
    tattooOnSkinConfidence: toConfidence(rawResponse?.tattooOnSkinConfidence),
    referenceAnalyzable:
      typeof rawResponse?.referenceAnalyzable === 'boolean'
        ? rawResponse.referenceAnalyzable
        : true,
    analyzabilityConfidence: toConfidence(rawResponse?.analyzabilityConfidence),
    ambiguityLevel: toAmbiguityLevel(rawResponse?.ambiguityLevel),
  };
}

function asRawResponse(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function toAmbiguityLevel(value: unknown): ImageAmbiguityLevel {
  return Object.values(ImageAmbiguityLevel).includes(value as ImageAmbiguityLevel)
    ? (value as ImageAmbiguityLevel)
    : ImageAmbiguityLevel.NONE;
}

function toConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 1;
}
