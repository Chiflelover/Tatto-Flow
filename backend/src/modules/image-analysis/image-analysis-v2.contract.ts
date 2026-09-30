import { ScaleReferenceType, type Prisma } from '../../generated/prisma/client.js';
import type { ImageAnalysisV2Observation, VisionStyle } from './domain/image-analysis-v2.types.js';
import { InvalidImageAnalysisResponseError } from './image-analysis-response.js';

export const IMAGE_ANALYSIS_V2_SCHEMA_VERSION = 'VISION_V2_2';

const confidenceSchema = { type: 'number', minimum: 0, maximum: 1 } as const;

export function createImageAnalysisV2Schema(
  styles: readonly VisionStyle[],
  provider: 'gemini' | 'openai',
) {
  const positiveMeasurement = {
    anyOf: [
      {
        type: 'number',
        // Gemini supports inclusive bounds; the backend enforces strictly positive values.
        ...(provider === 'openai' ? { exclusiveMinimum: 0 } : { minimum: 0 }),
        description: 'Medida estrictamente positiva, sustentada por escala visual suficiente.',
      },
      { type: 'null' },
    ],
  };
  const properties = {
    style: styles.length
      ? { anyOf: [{ type: 'string', enum: styles.map((style) => style.code) }, { type: 'null' }] }
      : { type: 'null' },
    style_confidence: confidenceSchema,
    scale_reference_type: { type: 'string', enum: Object.values(ScaleReferenceType) },
    scale_confidence: confidenceSchema,
    reference_main_dimension_cm: positiveMeasurement,
    reference_area_cm2: positiveMeasurement,
    area_confidence: confidenceSchema,
    color_coverage: {
      anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }],
    },
    color_confidence: confidenceSchema,
    overall_confidence: confidenceSchema,
    reference_essentially_black: { type: 'boolean' },
    extensive_body_coverage: { type: 'boolean' },
  };
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

export function parseImageAnalysisV2Response(
  text: string | undefined,
  styles: readonly VisionStyle[],
): ImageAnalysisV2Observation {
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    throw new InvalidImageAnalysisResponseError();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InvalidImageAnalysisResponseError();
  const candidate = value as Record<string, unknown>;
  const expectedKeys = createImageAnalysisV2Schema(styles, 'openai').required;
  if (
    Object.keys(candidate).length !== expectedKeys.length ||
    !Object.keys(candidate).every((key) => expectedKeys.includes(key)) ||
    !(candidate.style === null || styles.some((style) => style.code === candidate.style)) ||
    !isFraction(candidate.style_confidence) ||
    !isScaleReferenceType(candidate.scale_reference_type) ||
    !isFraction(candidate.scale_confidence) ||
    !isPositiveOrNull(candidate.reference_main_dimension_cm) ||
    !isPositiveOrNull(candidate.reference_area_cm2) ||
    !isFraction(candidate.area_confidence) ||
    !(candidate.color_coverage === null || isFraction(candidate.color_coverage)) ||
    !isFraction(candidate.color_confidence) ||
    !isFraction(candidate.overall_confidence) ||
    typeof candidate.reference_essentially_black !== 'boolean' ||
    typeof candidate.extensive_body_coverage !== 'boolean'
  )
    throw new InvalidImageAnalysisResponseError();
  return normalizeImageAnalysisV2Observation({
    style: candidate.style as string | null,
    styleConfidence: candidate.style_confidence,
    scaleReferenceType: candidate.scale_reference_type,
    scaleConfidence: candidate.scale_confidence,
    referenceMainDimensionCm: candidate.reference_main_dimension_cm,
    referenceAreaCm2: candidate.reference_area_cm2,
    areaConfidence: candidate.area_confidence,
    colorCoverage: candidate.color_coverage,
    colorConfidence: candidate.color_confidence,
    overallConfidence: candidate.overall_confidence,
    referenceEssentiallyBlack: candidate.reference_essentially_black,
    extensiveBodyCoverage: candidate.extensive_body_coverage,
  });
}

export function normalizeImageAnalysisV2Observation(
  observation: ImageAnalysisV2Observation,
): ImageAnalysisV2Observation {
  if (observation.scaleReferenceType !== ScaleReferenceType.NONE) return observation;
  return { ...observation, referenceMainDimensionCm: null, referenceAreaCm2: null };
}

function isScaleReferenceType(value: unknown): value is ScaleReferenceType {
  return Object.values(ScaleReferenceType).some((type) => type === value);
}

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

export function serializeProviderResponse(response: unknown, outputText: string | undefined) {
  return JSON.parse(
    JSON.stringify({ response, outputText: outputText ?? null }),
  ) as Prisma.InputJsonValue;
}
