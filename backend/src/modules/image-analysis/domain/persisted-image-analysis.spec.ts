import { persistedVision, visionResult } from '../../../../test/fixtures/vision-v2.js';
import { toImageAnalysisV2Observation } from './persisted-image-analysis.js';

describe('versioned persisted observations', () => {
  it.each(['VISION_V2_2', 'VISION_V2_3', 'VISION_V2_4'])(
    'reads historical %s with null density without changing the record',
    (schemaVersion) => {
      const stored = { ...persistedVision(), schemaVersion, estimatedDensity: null };
      const before = { ...stored };
      expect(toImageAnalysisV2Observation(stored)).toMatchObject({ estimatedDensity: null });
      expect(stored).toEqual(before);
    },
  );
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

  it('reads every current Vision observation', () => {
    const stored = persistedVision();
    expect(toImageAnalysisV2Observation(stored)).toEqual(visionResult().observations);
    expect(stored.rawResponse).toEqual({
      outputText: JSON.stringify({
        valid_tattoo_reference: true,
        reference_validation_confidence: 0.99,
        composition_aspect_ratio: 0.5,
        composition_fill_ratio: 0.75,
        estimated_density: 34.5,
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
