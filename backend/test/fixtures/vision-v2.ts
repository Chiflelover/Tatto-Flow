import {
  AnalysisVersion,
  DetailLevel,
  Prisma,
  TattooSize,
  type AiAnalysis,
} from '../../src/generated/prisma/client.js';
import type {
  ImageAnalysisV2Result,
  VisionStyle,
} from '../../src/modules/image-analysis/domain/image-analysis-v2.types.js';
import {
  parseImageAnalysisV2Response,
  IMAGE_ANALYSIS_V2_SCHEMA_VERSION,
} from '../../src/modules/image-analysis/image-analysis-v2.contract.js';
import { IMAGE_ANALYSIS_V2_PROMPT_VERSION } from '../../src/modules/image-analysis/image-analysis-v2.prompt.js';

export const VISION_STYLES: VisionStyle[] = [
  { code: 'FINE_LINE', name: 'Fine Line' },
  { code: 'BLACKWORK', name: 'Blackwork' },
  { code: 'DOTWORK', name: 'Dotwork (catalog extension)' },
];

export const VISION_RESPONSE = {
  valid_tattoo_reference: true,
  reference_validation_confidence: 0.99,
  composition_aspect_ratio: 0.5,
  composition_fill_ratio: 0.75,
  style: 'FINE_LINE',
  style_confidence: 0.94,
  scale_reference_type: 'EXPLICIT_REFERENCE',
  scale_confidence: 0.92,
  reference_main_dimension_cm: 12,
  reference_area_cm2: 54,
  area_confidence: 0.92,
  color_coverage: 0.02,
  color_confidence: 0.97,
  overall_confidence: 0.91,
  reference_essentially_black: true,
  extensive_body_coverage: false,
};

export const VISION_IMAGE = {
  content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  mimeType: 'image/png',
};

export function visionResult(
  provider: 'gemini' | 'openai' | 'mock' = 'gemini',
): ImageAnalysisV2Result {
  return {
    observations: parseImageAnalysisV2Response(JSON.stringify(VISION_RESPONSE), VISION_STYLES),
    provider,
    model: `${provider}-test-model`,
    promptVersion: IMAGE_ANALYSIS_V2_PROMPT_VERSION,
    schemaVersion: IMAGE_ANALYSIS_V2_SCHEMA_VERSION,
    rawResponse: {
      outputText: JSON.stringify(VISION_RESPONSE),
      providerResponse: { id: 'request-1' },
    },
  };
}

export function persistedVision(version: AnalysisVersion = AnalysisVersion.V2): AiAnalysis {
  const result = visionResult();
  return {
    id: '00000000-0000-4000-8000-000000000010',
    leadId: '00000000-0000-4000-8000-000000000020',
    analysisVersion: version,
    validTattooReference: version === 'V1' ? null : result.observations.validTattooReference,
    referenceValidationConfidence:
      version === 'V1' ? null : result.observations.referenceValidationConfidence,
    detectedSize: version === 'V1' ? TattooSize.MEDIUM : null,
    sizeConfidence: version === 'V1' ? new Prisma.Decimal('0.951') : null,
    detectedDetail: version === 'V1' ? DetailLevel.LIGHT : null,
    detailConfidence: version === 'V1' ? new Prisma.Decimal('0.963') : null,
    style: version === 'V1' ? null : result.observations.style,
    compositionAspectRatio: version === 'V1' ? null : result.observations.compositionAspectRatio,
    compositionFillRatio: version === 'V1' ? null : result.observations.compositionFillRatio,
    styleConfidence: version === 'V1' ? null : result.observations.styleConfidence,
    scaleReferenceType: version === 'V1' ? null : result.observations.scaleReferenceType,
    scaleConfidence: version === 'V1' ? null : result.observations.scaleConfidence,
    referenceMainDimensionCm:
      version === 'V1' ? null : result.observations.referenceMainDimensionCm,
    referenceAreaCm2: version === 'V1' ? null : result.observations.referenceAreaCm2,
    areaConfidence: version === 'V1' ? null : result.observations.areaConfidence,
    colorCoverage: version === 'V1' ? null : result.observations.colorCoverage,
    colorConfidence: version === 'V1' ? null : result.observations.colorConfidence,
    overallConfidence: version === 'V1' ? null : result.observations.overallConfidence,
    referenceEssentiallyBlack:
      version === 'V1' ? null : result.observations.referenceEssentiallyBlack,
    extensiveBodyCoverage: version === 'V1' ? null : result.observations.extensiveBodyCoverage,
    promptVersion: version === 'V1' ? null : result.promptVersion,
    schemaVersion: version === 'V1' ? null : result.schemaVersion,
    provider: version === 'V1' ? null : result.provider,
    model: version === 'V1' ? null : result.model,
    rawResponse:
      version === 'V1'
        ? { tattooOnSkin: true, ambiguityLevel: 'NONE' }
        : { outputText: JSON.stringify(VISION_RESPONSE) },
    createdAt: new Date('2026-09-29T20:00:00Z'),
  };
}
