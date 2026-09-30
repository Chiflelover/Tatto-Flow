import { persistedVision, visionResult } from '../../../../test/fixtures/vision-v2.js';
import { toImageAnalysisResult, toImageAnalysisV2Observation } from './persisted-image-analysis.js';

describe('versioned persisted observations', () => {
  it('does not backfill reference validity in historical V2 analyses', () => {
    const stored = {
      ...persistedVision(),
      schemaVersion: 'VISION_V2_2',
      validTattooReference: null,
      referenceValidationConfidence: null,
    };
    const before = { ...stored };
    expect(toImageAnalysisV2Observation(stored)).toBeNull();
    expect(stored).toEqual(before);
  });
  it('keeps earlier V2 geometry null without backfilling observations', () => {
    const stored = {
      ...persistedVision(),
      schemaVersion: 'VISION_V2_2',
      compositionAspectRatio: null,
      compositionFillRatio: null,
    };
    expect(toImageAnalysisV2Observation(stored)).toMatchObject({
      compositionAspectRatio: null,
      compositionFillRatio: null,
    });
    expect(stored.schemaVersion).toBe('VISION_V2_2');
  });
  it('keeps a historical V1 observation readable without fabricating V2 values', () => {
    const stored = persistedVision('V1');
    expect(toImageAnalysisResult(stored)).toMatchObject({
      detectedSize: 'MEDIUM',
      sizeConfidence: 0.951,
      detectedDetail: 'LIGHT',
      detailConfidence: 0.963,
    });
    expect(toImageAnalysisV2Observation(stored)).toBeNull();
    expect(stored.promptVersion).toBeNull();
    expect(stored.rawResponse).toEqual({ tattooOnSkin: true, ambiguityLevel: 'NONE' });
  });

  it('reads every V2 observation and never interprets it as V1 size or detail', () => {
    const stored = persistedVision();
    expect(toImageAnalysisV2Observation(stored)).toEqual(visionResult().observations);
    expect(toImageAnalysisResult(stored)).toBeNull();
    expect(stored.rawResponse).toEqual({
      outputText: JSON.stringify({
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
      }),
    });
  });

  it('does not fabricate scale provenance for an earlier V2 schema', () => {
    const stored = persistedVision();
    stored.schemaVersion = 'VISION_V2_1';
    stored.scaleReferenceType = null;
    stored.scaleConfidence = null;
    expect(toImageAnalysisV2Observation(stored)).toBeNull();
    expect(stored.referenceMainDimensionCm).toBe(12);
    expect(stored.referenceAreaCm2).toBe(54);
  });
});
