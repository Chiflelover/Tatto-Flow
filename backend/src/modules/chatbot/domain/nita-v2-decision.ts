import { Prisma, type AiAnalysis } from '../../../generated/prisma/client.js';
import { hasCompleteV2Intake, type V2Intake } from '../../conversations/conversation-v2-intake.js';
import type { ImageAnalysisV2Observation } from '../../image-analysis/domain/image-analysis-v2.types.js';

export type V2Decision = 'READY_FOR_PRICING' | 'HUMAN_REVIEW' | 'SPECIAL_REVIEW';
export type SpecialReviewType = 'SPECIAL_REVIEW_COLOR_MODIFICATION' | 'EXTENSIVE_BODY_COVERAGE';
export type V2ReviewReason =
  | 'ANALYSIS_FAILED'
  | 'INVALID_ANALYSIS'
  | 'REFERENCE_UNAVAILABLE'
  | 'INCOMPLETE_INTAKE'
  | 'LOW_OVERALL_CONFIDENCE'
  | 'BODY_CONTEXT_SCALE'
  | 'INSUFFICIENT_SCALE'
  | 'MISSING_REFERENCE_MEASUREMENTS'
  | 'INVALID_TARGET_MEASUREMENTS'
  | 'STYLE_UNKNOWN'
  | 'STYLE_NOT_ENABLED'
  | 'MISSING_COLOR_COVERAGE'
  | 'INVALID_COLOR_COVERAGE'
  | 'INCONSISTENT_COLOR_OBSERVATIONS'
  | 'INVALID_PREPARATION'
  | 'PRICING_MODEL_NOT_AVAILABLE'
  | 'MODEL_NOT_APPLICABLE';

export interface V2Preparation {
  version: 1;
  analysisId: string | null;
  decision: V2Decision;
  reviewReasons: V2ReviewReason[];
  specialReviewTypes: SpecialReviewType[];
  targetMainDimensionCm: string | null;
  scaleFactor: string | null;
  targetAreaCm2: string | null;
  targetColorCoverage: number | null;
  clientReferenceMatch: 'CONSISTENT' | 'MODIFIED' | 'UNKNOWN';
}

export interface V2StyleAvailability {
  exists: boolean;
  enabled: boolean;
}

export function v2PreparationFromJson(value: Prisma.JsonValue | null): V2Preparation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (
    value.version !== 1 ||
    typeof value.decision !== 'string' ||
    !['READY_FOR_PRICING', 'HUMAN_REVIEW', 'SPECIAL_REVIEW'].includes(value.decision) ||
    !Array.isArray(value.reviewReasons) ||
    !value.reviewReasons.every((item) => typeof item === 'string') ||
    !Array.isArray(value.specialReviewTypes) ||
    !value.specialReviewTypes.every(
      (item) => item === 'SPECIAL_REVIEW_COLOR_MODIFICATION' || item === 'EXTENSIVE_BODY_COVERAGE',
    ) ||
    typeof value.clientReferenceMatch !== 'string' ||
    !['CONSISTENT', 'MODIFIED', 'UNKNOWN'].includes(value.clientReferenceMatch) ||
    !['analysisId', 'targetMainDimensionCm', 'scaleFactor', 'targetAreaCm2'].every(
      (key) => value[key] === null || typeof value[key] === 'string',
    ) ||
    !(
      value.targetColorCoverage === null ||
      (typeof value.targetColorCoverage === 'number' && Number.isFinite(value.targetColorCoverage))
    )
  )
    return null;
  return value as unknown as V2Preparation;
}

// Numerical precision is a technical choice, independent of confidence or commercial thresholds.
const Decimal = Prisma.Decimal.clone({ precision: 40 });
function positive(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function fraction(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isValidV2Analysis(
  analysis: Pick<AiAnalysis, 'analysisVersion' | keyof ImageAnalysisV2Observation>,
): boolean {
  return (
    analysis.analysisVersion === 'V2' &&
    [
      analysis.styleConfidence,
      analysis.areaConfidence,
      analysis.colorConfidence,
      analysis.scaleConfidence,
      analysis.overallConfidence,
    ].every(fraction) &&
    ['EXPLICIT_REFERENCE', 'BODY_CONTEXT', 'NONE'].some(
      (type) => type === analysis.scaleReferenceType,
    ) &&
    (analysis.referenceMainDimensionCm === null || positive(analysis.referenceMainDimensionCm)) &&
    (analysis.referenceAreaCm2 === null || positive(analysis.referenceAreaCm2)) &&
    (analysis.colorCoverage === null || fraction(analysis.colorCoverage)) &&
    typeof analysis.referenceEssentiallyBlack === 'boolean' &&
    typeof analysis.extensiveBodyCoverage === 'boolean'
  );
}

export function prepareV2Case(
  intake: V2Intake,
  analysis: AiAnalysis | null,
  style: V2StyleAvailability,
  failure: V2ReviewReason = 'ANALYSIS_FAILED',
): V2Preparation {
  const result: V2Preparation = {
    version: 1,
    analysisId: analysis?.id ?? null,
    decision: 'HUMAN_REVIEW',
    reviewReasons: [],
    specialReviewTypes: [],
    targetMainDimensionCm: null,
    scaleFactor: null,
    targetAreaCm2: null,
    targetColorCoverage: null,
    clientReferenceMatch: 'UNKNOWN',
  };
  if (!hasCompleteV2Intake(intake)) result.reviewReasons.push('INCOMPLETE_INTAKE');
  if (intake.sameSizeAsReference === false && positive(intake.targetSizeCm))
    result.targetMainDimensionCm = new Decimal(intake.targetSizeCm).toString();
  if (!analysis) {
    result.reviewReasons.push(failure);
    return result;
  }
  if (analysis.analysisVersion !== 'V2') {
    result.reviewReasons.push('INVALID_ANALYSIS');
    return result;
  }

  const wantsBlack = intake.colorDeclaration === 'BLACK_ONLY';
  const wantsColor =
    intake.colorDeclaration === 'BLACK_WITH_SOME_COLOR' ||
    intake.colorDeclaration === 'MOSTLY_COLOR';
  if (analysis.extensiveBodyCoverage === true)
    result.specialReviewTypes.push('EXTENSIVE_BODY_COVERAGE');
  if (analysis.referenceEssentiallyBlack === true && wantsColor)
    result.specialReviewTypes.push('SPECIAL_REVIEW_COLOR_MODIFICATION');

  if (wantsBlack) {
    result.targetColorCoverage = 0;
    if (typeof analysis.referenceEssentiallyBlack === 'boolean')
      result.clientReferenceMatch = analysis.referenceEssentiallyBlack ? 'CONSISTENT' : 'MODIFIED';
  } else if (wantsColor && analysis.referenceEssentiallyBlack === true) {
    result.clientReferenceMatch = 'MODIFIED';
  } else if (
    wantsColor &&
    analysis.referenceEssentiallyBlack === false &&
    fraction(analysis.colorCoverage)
  ) {
    result.targetColorCoverage = analysis.colorCoverage;
    result.clientReferenceMatch = 'CONSISTENT';
    if (analysis.colorCoverage === 0) result.reviewReasons.push('INCONSISTENT_COLOR_OBSERVATIONS');
  }

  if (!isValidV2Analysis(analysis)) result.reviewReasons.push('INVALID_ANALYSIS');
  if (fraction(analysis.overallConfidence) && analysis.overallConfidence < 0.9)
    result.reviewReasons.push('LOW_OVERALL_CONFIDENCE');
  if (analysis.scaleReferenceType === 'BODY_CONTEXT')
    result.reviewReasons.push('BODY_CONTEXT_SCALE');
  if (
    analysis.scaleReferenceType !== 'EXPLICIT_REFERENCE' &&
    analysis.scaleReferenceType !== 'BODY_CONTEXT'
  )
    result.reviewReasons.push('INSUFFICIENT_SCALE');

  if (
    analysis.scaleReferenceType === 'EXPLICIT_REFERENCE' ||
    analysis.scaleReferenceType === 'BODY_CONTEXT'
  ) {
    if (positive(analysis.referenceMainDimensionCm) && positive(analysis.referenceAreaCm2)) {
      const referenceDimension = new Decimal(analysis.referenceMainDimensionCm);
      const targetDimension =
        intake.sameSizeAsReference === true
          ? referenceDimension
          : positive(intake.targetSizeCm)
            ? new Decimal(intake.targetSizeCm)
            : null;
      if (targetDimension) {
        const scale = targetDimension.div(referenceDimension);
        const area = new Decimal(analysis.referenceAreaCm2).mul(scale.pow(2));
        if (scale.isFinite() && area.isFinite() && area.gt(0)) {
          result.targetMainDimensionCm = targetDimension.toString();
          result.scaleFactor = scale.toString();
          result.targetAreaCm2 = area.toString();
        } else result.reviewReasons.push('INVALID_TARGET_MEASUREMENTS');
      } else result.reviewReasons.push('INVALID_TARGET_MEASUREMENTS');
    } else result.reviewReasons.push('MISSING_REFERENCE_MEASUREMENTS');
  }
  if (!analysis.style || !style.exists) result.reviewReasons.push('STYLE_UNKNOWN');
  else if (!style.enabled) result.reviewReasons.push('STYLE_NOT_ENABLED');
  if (analysis.colorCoverage === null) result.reviewReasons.push('MISSING_COLOR_COVERAGE');
  else if (!fraction(analysis.colorCoverage)) result.reviewReasons.push('INVALID_COLOR_COVERAGE');

  result.decision = result.specialReviewTypes.length
    ? 'SPECIAL_REVIEW'
    : result.reviewReasons.length ||
        result.targetAreaCm2 === null ||
        result.targetColorCoverage === null
      ? 'HUMAN_REVIEW'
      : 'READY_FOR_PRICING';
  return result;
}

export const V2_ANALYSIS_STATES = ['READY_FOR_ANALYSIS', 'ANALYZING'] as const;
export const V2_DECISION_STATES = ['READY_FOR_PRICING', 'HUMAN_REVIEW', 'SPECIAL_REVIEW'] as const;
