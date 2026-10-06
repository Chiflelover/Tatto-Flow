import type { AiAnalysis } from '../../../generated/prisma/client.js';
import type { ImageAnalysisV2Observation } from './image-analysis-v2.types.js';
import { isEstimatedDensity } from '../image-analysis-v2.contract.js';

export function toImageAnalysisV2Observation(
  analysis: AiAnalysis,
): ImageAnalysisV2Observation | null {
  if (
    analysis.validTattooReference === null ||
    analysis.referenceValidationConfidence === null ||
    analysis.styleConfidence === null ||
    analysis.scaleReferenceType === null ||
    analysis.scaleConfidence === null ||
    analysis.areaConfidence === null ||
    analysis.colorConfidence === null ||
    analysis.overallConfidence === null ||
    analysis.referenceEssentiallyBlack === null ||
    analysis.extensiveBodyCoverage === null ||
    (analysis.estimatedDensity !== null && !isEstimatedDensity(analysis.estimatedDensity))
  )
    return null;
  return {
    validTattooReference: analysis.validTattooReference,
    referenceValidationConfidence: analysis.referenceValidationConfidence,
    style: analysis.style,
    compositionAspectRatio: analysis.compositionAspectRatio,
    compositionFillRatio: analysis.compositionFillRatio,
    estimatedDensity: analysis.estimatedDensity,
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
