import { VISION_RESPONSE, VISION_STYLES } from '../../../test/fixtures/vision-v2.js';
import { InvalidImageAnalysisResponseError } from './image-analysis-response.js';
import {
  createImageAnalysisV2Schema,
  parseImageAnalysisV2Response,
} from './image-analysis-v2.contract.js';
import { createImageAnalysisV2Prompt } from './image-analysis-v2.prompt.js';

const parse = (overrides: Record<string, unknown> = {}) =>
  parseImageAnalysisV2Response(JSON.stringify({ ...VISION_RESPONSE, ...overrides }), VISION_STYLES);

describe('AI Vision V2 contract', () => {
  it('uses the available catalog and supports extensions and insufficient classification', () => {
    expect(parse().style).toBe('FINE_LINE');
    expect(parse({ style: 'DOTWORK' }).style).toBe('DOTWORK');
    expect(parse({ style: null }).style).toBeNull();
    expect(() => parse({ style: 'INVENTED' })).toThrow(InvalidImageAnalysisResponseError);
    expect(createImageAnalysisV2Schema(VISION_STYLES, 'openai').properties.style).toEqual({
      anyOf: [{ type: 'string', enum: ['FINE_LINE', 'BLACKWORK', 'DOTWORK'] }, { type: 'null' }],
    });
    expect(
      parseImageAnalysisV2Response(JSON.stringify({ ...VISION_RESPONSE, style: null }), []).style,
    ).toBeNull();
  });

  it.each([
    'style_confidence',
    'scale_confidence',
    'area_confidence',
    'color_confidence',
    'overall_confidence',
  ])(
    'accepts the full confidence range for %s without individual commercial thresholds',
    (field) => {
      for (const value of [0, 0.01, 0.89999, 1])
        expect(() => parse({ [field]: value })).not.toThrow();
      for (const value of [-0.01, 1.01, null, '0.95'])
        expect(() => parse({ [field]: value })).toThrow();
    },
  );

  it('normalizes NONE to null dimensions and area even when the provider sends positive measurements', () => {
    for (const measures of [
      { reference_main_dimension_cm: null, reference_area_cm2: null },
      { reference_main_dimension_cm: 12, reference_area_cm2: 54 },
    ]) {
      expect(
        parse({ ...measures, scale_reference_type: 'NONE', scale_confidence: 0 }),
      ).toMatchObject({
        scaleReferenceType: 'NONE',
        scaleConfidence: 0,
        referenceMainDimensionCm: null,
        referenceAreaCm2: null,
      });
    }
    expect(() => parse({ scale_reference_type: 'NONE', reference_area_cm2: -1 })).toThrow();
  });

  it('keeps BODY_CONTEXT separate from EXPLICIT_REFERENCE and preserves low scale confidence without a commercial gate', () => {
    const observed = parse({ scale_reference_type: 'BODY_CONTEXT', scale_confidence: 0.05 });
    expect(observed).toMatchObject({
      scaleReferenceType: 'BODY_CONTEXT',
      scaleConfidence: 0.05,
      referenceMainDimensionCm: 12,
      referenceAreaCm2: 54,
      areaConfidence: 0.92,
      overallConfidence: 0.91,
    });
    expect(observed).not.toHaveProperty('physicalScaleValidated');
    expect(observed).not.toHaveProperty('autoQuote');
  });

  it('allows positive measurements with an explicit reference', () => {
    expect(
      parse({ scale_reference_type: 'EXPLICIT_REFERENCE', scale_confidence: 1 }),
    ).toMatchObject({
      scaleReferenceType: 'EXPLICIT_REFERENCE',
      scaleConfidence: 1,
      referenceMainDimensionCm: 12,
      referenceAreaCm2: 54,
    });
    expect(
      createImageAnalysisV2Schema(VISION_STYLES, 'gemini').properties.scale_reference_type.enum,
    ).toEqual(['EXPLICIT_REFERENCE', 'BODY_CONTEXT', 'NONE']);
  });

  it('rejects missing, null or unknown scale origins', () => {
    for (const scale_reference_type of [undefined, null, 'ANATOMY', 1])
      expect(() => parse({ scale_reference_type })).toThrow();
  });

  it('keeps overall confidence independent of the smallest individual confidence', () => {
    const result = parse({ style_confidence: 0.1, area_confidence: 0.2, overall_confidence: 0.91 });
    expect(result.overallConfidence).toBe(0.91);
    expect(result).not.toHaveProperty('readinessScore');
    expect(result).not.toHaveProperty('leadScore');
  });

  it.each(['reference_main_dimension_cm', 'reference_area_cm2'])(
    'allows missing scale but rejects zero, negative and nonnumeric %s',
    (field) => {
      expect(() => parse({ [field]: null })).not.toThrow();
      expect(() => parse({ [field]: 0.001 })).not.toThrow();
      for (const value of [0, -1, '12']) expect(() => parse({ [field]: value })).toThrow();
    },
  );

  it.each([0, 0.25, 1, null])(
    'allows observed coverage %s without color rules',
    (color_coverage) => {
      expect(parse({ color_coverage }).colorCoverage).toBe(color_coverage);
    },
  );

  it.each([-0.01, 1.01, '0.25'])('rejects invalid color coverage %s', (color_coverage) => {
    expect(() => parse({ color_coverage })).toThrow();
  });

  it('preserves Black & Grey and chromatic observations without a universal percentage threshold', () => {
    expect(
      parse({ color_coverage: 0, reference_essentially_black: true }).referenceEssentiallyBlack,
    ).toBe(true);
    expect(
      parse({ color_coverage: 0.02, reference_essentially_black: false }).referenceEssentiallyBlack,
    ).toBe(false);
    expect(parse({ extensive_body_coverage: true }).extensiveBodyCoverage).toBe(true);
    expect(parse({ extensive_body_coverage: false }).extensiveBodyCoverage).toBe(false);
    expect(() => parse({ extensive_body_coverage: null })).toThrow();
  });

  it('rejects extra commercial fields, missing fields and malformed JSON', () => {
    for (const field of ['price', 'AUTO_QUOTE', 'booking_intent', 'lead_score'])
      expect(() => parse({ [field]: 1 })).toThrow();
    for (const text of [
      '{broken',
      '{}',
      '[]',
      '',
      JSON.stringify({ ...VISION_RESPONSE, style_confidence: undefined }),
    ])
      expect(() => parseImageAnalysisV2Response(text, VISION_STYLES)).toThrow();
  });

  it('asks for compositional area, missing scale and independent visual observations', () => {
    const prompt = createImageAnalysisV2Prompt(VISION_STYLES);
    expect(prompt).toContain('No confundas área compositiva con área de tinta ni con bounding box');
    expect(prompt).toContain('Si falta escala, usa null');
    expect(prompt).toContain('Nunca clasifiques BODY_CONTEXT como EXPLICIT_REFERENCE');
    expect(prompt).toContain('reference_main_dimension_cm=null y reference_area_cm2=null');
    expect(prompt).toContain('Es independiente de area_confidence, overall_confidence');
    expect(prompt).toContain('Black & Grey = BLACK_ONLY');
    expect(prompt).toContain('Ver un brazo o una espalda no basta');
    expect(prompt).toContain('No calcules ni sugieras precio');
    expect(prompt).toContain(
      'No alteres lo observado para coincidir con declaraciones del cliente',
    );
    expect(prompt).not.toContain('detectedDetail');
    expect(prompt).not.toContain('selectedSize');
  });
});
