import { persistedVision } from '../../../../test/fixtures/vision-v2.js';
import type { AiAnalysis } from '../../../generated/prisma/client.js';
import type { V2Intake } from '../../conversations/conversation-v2-intake.js';
import { prepareV2Case } from './nita-v2-decision.js';

const intake: V2Intake = {
  firstTattoo: false,
  sameSizeAsReference: true,
  targetSizeCm: null,
  colorDeclaration: 'BLACK_ONLY',
  bodyPart: 'Antebrazo izquierdo',
};
const enabled = { exists: true, enabled: true };
const observe = (changes: Partial<AiAnalysis> = {}) => ({ ...persistedVision(), ...changes });

describe('Nita V2 backend preparation', () => {
  it('closes an invalid reference before area, confidence, style, color or any review rule', () => {
    const result = prepareV2Case(
      { ...intake, firstTattoo: null, targetSizeCm: 10, colorDeclaration: 'MOSTLY_COLOR' },
      observe({
        validTattooReference: false,
        referenceValidationConfidence: 0.01,
        extensiveBodyCoverage: true,
        referenceEssentiallyBlack: true,
        overallConfidence: 0.01,
      }),
      { exists: false, enabled: false },
    );
    expect(result).toMatchObject({
      decision: 'INVALID_REFERENCE',
      targetMainDimensionCm: null,
      targetAreaCm2: null,
      scaleFactor: null,
      targetColorCoverage: null,
      reviewReasons: [],
      specialReviewTypes: [],
      clientReferenceMatch: 'UNKNOWN',
    });
  });
  it('does not reinterpret historical unknown validation as an invalid reference', () => {
    const analysis = observe({ validTattooReference: null, referenceValidationConfidence: null });
    expect(prepareV2Case(intake, analysis, enabled).decision).toBe('HUMAN_REVIEW');
    expect(analysis.validTattooReference).toBeNull();
  });
  it.each(['NONE', 'BODY_CONTEXT'] as const)(
    'uses client size after SAME_SIZE analysis with %s',
    (scaleReferenceType) => {
      expect(
        prepareV2Case(
          { ...intake, targetSizeCm: 10 },
          observe({ scaleReferenceType, compositionAspectRatio: 0.4, compositionFillRatio: 0.7 }),
          enabled,
        ),
      ).toMatchObject({
        decision: 'READY_FOR_PRICING',
        targetAreaCm2: '28',
        scaleFactor: null,
        reviewReasons: [],
      });
    },
  );
  it.each(['compositionAspectRatio', 'compositionFillRatio'] as const)(
    'reviews missing %s without fabricating geometry',
    (field) => {
      for (const sameSizeAsReference of [true, false]) {
        const result = prepareV2Case(
          { ...intake, sameSizeAsReference, targetSizeCm: sameSizeAsReference ? null : 10 },
          observe({ scaleReferenceType: 'NONE', [field]: null }),
          enabled,
        );
        expect(result).toMatchObject({ decision: 'HUMAN_REVIEW', targetAreaCm2: null });
        expect(result.reviewReasons).toContain('MISSING_COMPOSITION_GEOMETRY');
      }
    },
  );
  it('reviews DIFFERENT_SIZE without a client dimension', () => {
    expect(
      prepareV2Case(
        { ...intake, sameSizeAsReference: false },
        observe({ scaleReferenceType: 'NONE' }),
        enabled,
      ),
    ).toMatchObject({ decision: 'HUMAN_REVIEW', targetAreaCm2: null });
  });
  it('keeps historical explicit-scale analyses valid without newly observed geometry', () => {
    expect(
      prepareV2Case(
        intake,
        observe({
          schemaVersion: 'VISION_V2_2',
          compositionAspectRatio: null,
          compositionFillRatio: null,
        }),
        enabled,
      ),
    ).toMatchObject({ decision: 'READY_FOR_PRICING', targetAreaCm2: '54' });
  });
  it.each(['compositionAspectRatio', 'compositionFillRatio'] as const)(
    'rejects impossible %s',
    (field) => {
      for (const value of [0, -1, 1.01, Number.NaN])
        expect(
          prepareV2Case({ ...intake, targetSizeCm: 10 }, observe({ [field]: value }), enabled),
        ).toMatchObject({ decision: 'HUMAN_REVIEW', targetAreaCm2: null });
    },
  );
  it('keeps SAME_SIZE with explicit scale and the original observations', () => {
    const analysis = observe();
    const before = { ...analysis };
    expect(prepareV2Case(intake, analysis, enabled)).toMatchObject({
      decision: 'READY_FOR_PRICING',
      scaleFactor: '1',
      targetMainDimensionCm: '12',
      targetAreaCm2: '54',
      clientReferenceMatch: 'CONSISTENT',
      targetColorCoverage: 0,
      specialReviewTypes: [],
      reviewReasons: [],
    });
    expect(analysis).toEqual(before);
  });
  it.each(['BODY_CONTEXT', 'NONE'] as const)(
    'asks for client size instead of relying on %s for SAME_SIZE',
    (scaleReferenceType) => {
      const result = prepareV2Case(intake, observe({ scaleReferenceType }), enabled);
      expect(result.decision).toBe('ASK_TARGET_SIZE_AFTER_ANALYSIS');
      expect(result.specialReviewTypes).toEqual([]);
      expect(result.targetAreaCm2).toBeNull();
      expect(result.reviewReasons).toEqual([]);
    },
  );
  it('calculates DIFFERENT_SIZE using relative geometry and Decimal precision', () => {
    const result = prepareV2Case(
      { ...intake, sameSizeAsReference: false, targetSizeCm: 10 },
      observe({ compositionAspectRatio: 0.4, compositionFillRatio: 0.7 }),
      enabled,
    );
    expect(result).toMatchObject({
      decision: 'READY_FOR_PRICING',
      targetMainDimensionCm: '10',
      scaleFactor: null,
      targetAreaCm2: '28',
    });
  });
  it.each(['BODY_CONTEXT', 'NONE'] as const)(
    'permits DIFFERENT_SIZE with client dimensions independently of %s',
    (scaleReferenceType) => {
      const result = prepareV2Case(
        { ...intake, sameSizeAsReference: false, targetSizeCm: 22 },
        observe({ referenceMainDimensionCm: 10, referenceAreaCm2: 42, scaleReferenceType }),
        enabled,
      );
      expect(result).toMatchObject({
        decision: 'READY_FOR_PRICING',
        targetMainDimensionCm: '22',
        specialReviewTypes: [],
      });
      expect(result.targetAreaCm2).toBe('181.5');
      expect(result.reviewReasons).toEqual([]);
      expect(result.scaleFactor).toBeNull();
    },
  );
  it.each([0.9, 0.899999999, 0.899])(
    'uses overall confidence exactly, without rounding %s',
    (overallConfidence) => {
      expect(prepareV2Case(intake, observe({ overallConfidence }), enabled).decision).toBe(
        overallConfidence >= 0.9 ? 'READY_FOR_PRICING' : 'HUMAN_REVIEW',
      );
    },
  );
  it('stores individual confidences without imposing individual thresholds', () => {
    expect(
      prepareV2Case(
        intake,
        observe({
          styleConfidence: 0,
          areaConfidence: 0,
          colorConfidence: 0,
          scaleConfidence: 0,
          overallConfidence: 0.9,
        }),
        enabled,
      ).decision,
    ).toBe('READY_FOR_PRICING');
  });
  it.each([
    { exists: false, enabled: false },
    { exists: true, enabled: false },
  ])('reviews unavailable style %j', (style) => {
    const result = prepareV2Case(intake, observe(), style);
    expect(result).toMatchObject({ decision: 'HUMAN_REVIEW', specialReviewTypes: [] });
    expect(result.reviewReasons).toContain(style.exists ? 'STYLE_NOT_ENABLED' : 'STYLE_UNKNOWN');
  });
  it('reviews a null style', () => {
    expect(prepareV2Case(intake, observe({ style: null }), enabled).reviewReasons).toContain(
      'STYLE_UNKNOWN',
    );
  });
  it('allows colored reference to black, records modification and preserves reference color', () => {
    const analysis = observe({ referenceEssentiallyBlack: false, colorCoverage: 0.73 });
    expect(prepareV2Case(intake, analysis, enabled)).toMatchObject({
      decision: 'READY_FOR_PRICING',
      targetColorCoverage: 0,
      clientReferenceMatch: 'MODIFIED',
      specialReviewTypes: [],
    });
    expect(analysis.colorCoverage).toBe(0.73);
  });
  it.each(['BLACK_WITH_SOME_COLOR', 'MOSTLY_COLOR'] as const)(
    'reviews added color specially without inventing coverage for %s',
    (colorDeclaration) => {
      expect(prepareV2Case({ ...intake, colorDeclaration }, observe(), enabled)).toMatchObject({
        decision: 'SPECIAL_REVIEW',
        targetColorCoverage: null,
        clientReferenceMatch: 'MODIFIED',
        specialReviewTypes: ['SPECIAL_REVIEW_COLOR_MODIFICATION'],
      });
    },
  );
  it.each(['BLACK_WITH_SOME_COLOR', 'MOSTLY_COLOR'] as const)(
    'uses observed colored coverage for %s without fixed percentages',
    (colorDeclaration) => {
      expect(
        prepareV2Case(
          { ...intake, colorDeclaration },
          observe({ referenceEssentiallyBlack: false, colorCoverage: 0.47 }),
          enabled,
        ),
      ).toMatchObject({
        decision: 'READY_FOR_PRICING',
        targetColorCoverage: 0.47,
        clientReferenceMatch: 'CONSISTENT',
      });
    },
  );
  it('prioritizes extensive coverage over low confidence and unusable scale', () => {
    expect(
      prepareV2Case(
        intake,
        observe({
          extensiveBodyCoverage: true,
          overallConfidence: 0.2,
          scaleReferenceType: 'NONE',
        }),
        enabled,
      ),
    ).toMatchObject({
      decision: 'SPECIAL_REVIEW',
      specialReviewTypes: ['EXTENSIVE_BODY_COVERAGE'],
    });
  });
  it('preserves both and only the two special review types', () => {
    const result = prepareV2Case(
      { ...intake, colorDeclaration: 'MOSTLY_COLOR' },
      observe({ extensiveBodyCoverage: true }),
      enabled,
    );
    expect(result.decision).toBe('SPECIAL_REVIEW');
    expect(result.specialReviewTypes).toEqual([
      'EXTENSIVE_BODY_COVERAGE',
      'SPECIAL_REVIEW_COLOR_MODIFICATION',
    ]);
  });
  it.each(['referenceMainDimensionCm', 'referenceAreaCm2'] as const)(
    'reviews missing %s without guessing area',
    (field) => {
      const result = prepareV2Case(intake, observe({ [field]: null }), enabled);
      expect(result).toMatchObject({ decision: 'HUMAN_REVIEW', targetAreaCm2: null });
      expect(result.reviewReasons).toContain('MISSING_REFERENCE_MEASUREMENTS');
    },
  );
  it.each([null, -0.1, 1.1, Number.NaN])(
    'reviews absent or impossible observed color coverage %s',
    (colorCoverage) => {
      expect(prepareV2Case(intake, observe({ colorCoverage }), enabled).decision).toBe(
        'HUMAN_REVIEW',
      );
    },
  );
  it('reviews failed analysis with UNKNOWN match', () => {
    expect(prepareV2Case(intake, null, enabled)).toMatchObject({
      decision: 'HUMAN_REVIEW',
      reviewReasons: ['ANALYSIS_FAILED'],
      clientReferenceMatch: 'UNKNOWN',
    });
  });
  it('never treats V1 analysis as V2', () => {
    expect(prepareV2Case(intake, persistedVision('V1'), enabled)).toMatchObject({
      decision: 'HUMAN_REVIEW',
      reviewReasons: ['INVALID_ANALYSIS'],
    });
  });
  it('reviews incomplete intake and impossible reference dimensions', () => {
    const result = prepareV2Case(
      { ...intake, sameSizeAsReference: false, targetSizeCm: -1 },
      observe({ referenceMainDimensionCm: 0 }),
      enabled,
    );
    expect(result.decision).toBe('HUMAN_REVIEW');
    expect(result.reviewReasons).toContain('INCOMPLETE_INTAKE');
    expect(result.reviewReasons).toContain('INVALID_ANALYSIS');
  });
});
