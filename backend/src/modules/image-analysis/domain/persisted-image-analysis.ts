import { AnalysisVersion, Prisma, type AiAnalysis } from '../../../generated/prisma/client.js';
import { ImageAmbiguityLevel, type ImageAnalysisResult } from './image-analysis.types.js';
import type { ImageAnalysisV2Observation } from './image-analysis-v2.types.js';

export function toImageAnalysisResult(analysis: AiAnalysis): ImageAnalysisResult | null {
  if (
    analysis.analysisVersion !== AnalysisVersion.V1 ||
    !analysis.detectedSize ||
    !analysis.sizeConfidence ||
    !analysis.detectedDetail ||
    !analysis.detailConfidence
  )
    return null;
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

export function toImageAnalysisV2Observation(
  analysis: AiAnalysis,
): ImageAnalysisV2Observation | null {
  if (
    analysis.analysisVersion !== AnalysisVersion.V2 ||
    analysis.validTattooReference === null ||
    analysis.referenceValidationConfidence === null ||
    analysis.styleConfidence === null ||
    analysis.scaleReferenceType === null ||
    analysis.scaleConfidence === null ||
    analysis.areaConfidence === null ||
    analysis.colorConfidence === null ||
    analysis.overallConfidence === null ||
    analysis.referenceEssentiallyBlack === null ||
    analysis.extensiveBodyCoverage === null
  )
    return null;
  return {
    validTattooReference: analysis.validTattooReference,
    referenceValidationConfidence: analysis.referenceValidationConfidence,
    style: analysis.style,
    compositionAspectRatio: analysis.compositionAspectRatio,
    compositionFillRatio: analysis.compositionFillRatio,
    styleConfidence: analysis.styleConfidence,
    scaleReferenceType: analysis.scaleReferenceType,
    scaleConfidence: analysis.scaleConfidence,
    referenceMainDimensionCm: analysis.referenceMainDimensionCm,
    referenceAreaCm2: analysis.referenceAreaCm2,
    areaConfidence: analysis.areaConfidence,
    colorCoverage: analysis.colorCoverage,
    colorConfidence: analysis.colorConfidence,
    overallConfidence: analysis.overallConfidence,
    referenceEssentiallyBlack: analysis.referenceEssentiallyBlack,
    extensiveBodyCoverage: analysis.extensiveBodyCoverage,
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
