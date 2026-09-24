import {
  ConversationStatus,
  DetailLevel,
  Prisma,
  ReadinessStatus,
  TattooSize,
} from '../../generated/prisma/client.js';
import { ImageAmbiguityLevel } from '../image-analysis/domain/image-analysis.types.js';
import type { LeadScoringConfig, LeadScoringInput } from './domain/lead-scoring.types.js';
import { LEAD_SCORING_CONFIG_V1 } from './lead-scoring.config.js';
import { LeadScoringService } from './lead-scoring.service.js';

const PERFECT_INPUT: LeadScoringInput = {
  selectedSize: TattooSize.MEDIUM,
  selectedDetail: DetailLevel.DETAILED,
  bodyPart: 'Brazo',
  referenceReceived: true,
  conversationStatus: ConversationStatus.ACTIVE,
  analysisFailed: false,
  analysis: {
    detectedSize: TattooSize.MEDIUM,
    sizeConfidence: 0.95,
    detectedDetail: DetailLevel.DETAILED,
    detailConfidence: 0.95,
    tattooOnSkin: true,
    tattooOnSkinConfidence: 0.98,
    referenceAnalyzable: true,
    analyzabilityConfidence: 0.97,
    ambiguityLevel: ImageAmbiguityLevel.NONE,
  },
};

function createService(config: LeadScoringConfig = LEAD_SCORING_CONFIG_V1) {
  return new LeadScoringService(config);
}

function inputWith(
  input: Partial<Omit<LeadScoringInput, 'analysis'>> = {},
  analysis: Partial<NonNullable<LeadScoringInput['analysis']>> = {},
): LeadScoringInput {
  return {
    ...PERFECT_INPUT,
    ...input,
    analysis: PERFECT_INPUT.analysis ? { ...PERFECT_INPUT.analysis, ...analysis } : null,
  };
}

function configWith(
  overrides: Partial<Pick<LeadScoringConfig, 'maxPositiveScore' | 'rulesVersion'>> & {
    weights?: Partial<LeadScoringConfig['weights']>;
  },
): LeadScoringConfig {
  return {
    ...LEAD_SCORING_CONFIG_V1,
    ...overrides,
    thresholds: { ...LEAD_SCORING_CONFIG_V1.thresholds },
    weights: {
      ...LEAD_SCORING_CONFIG_V1.weights,
      ...overrides.weights,
    },
  };
}

describe('LeadScoringService', () => {
  it('classifies a perfect lead as LISTO with the complete explainable score', async () => {
    const result = await createService().evaluate(PERFECT_INPUT);

    expect(result).toMatchObject({
      rawScore: 250,
      maxPositiveScore: 250,
      readinessScore: 100,
      status: ReadinessStatus.LISTO,
      rulesVersion: 1,
      blockers: [],
    });
    expect(result.contributions.map(({ ruleId }) => ruleId)).toEqual([
      'SIZE_PROVIDED',
      'DETAIL_PROVIDED',
      'BODY_PART_PROVIDED',
      'REFERENCE_RECEIVED',
      'TATTOO_ON_SKIN',
      'REFERENCE_ANALYZABLE',
      'SIZE_MATCH',
      'DETAIL_MATCH',
      'NO_MAJOR_CONTRADICTIONS',
    ]);
    expect(result.contributions[0]).toEqual({
      ruleId: 'SIZE_PROVIDED',
      points: 25,
      reason: 'El cliente indicó el tamaño',
    });
  });

  it('classifies a complete lead with an AI failure as REVISAR instead of INCOMPLETO', async () => {
    const result = await createService().evaluate({
      ...PERFECT_INPUT,
      analysis: null,
      analysisFailed: true,
    });

    expect(result).toMatchObject({
      rawScore: 80,
      readinessScore: 32,
      status: ReadinessStatus.REVISAR,
    });
    expect(result.blockers).toEqual([
      {
        ruleId: 'AI_ERROR',
        reason: 'No se pudo analizar la referencia automáticamente',
      },
    ]);
  });

  it.each([
    [
      'only size',
      {
        selectedSize: TattooSize.SMALL,
        selectedDetail: null,
        bodyPart: null,
      },
      25,
      ['SIZE_PROVIDED'],
    ],
    [
      'size and detail',
      {
        selectedSize: TattooSize.SMALL,
        selectedDetail: DetailLevel.LIGHT,
        bodyPart: null,
      },
      45,
      ['SIZE_PROVIDED', 'DETAIL_PROVIDED'],
    ],
    [
      'size, detail and body part',
      {
        selectedSize: TattooSize.SMALL,
        selectedDetail: DetailLevel.LIGHT,
        bodyPart: 'Brazo',
      },
      55,
      ['SIZE_PROVIDED', 'DETAIL_PROVIDED', 'BODY_PART_PROVIDED'],
    ],
  ])(
    'scores partial information with %s without inventing missing facts',
    async (_name, partial, rawScore, ruleIds) => {
      const result = await createService().evaluate({
        ...PERFECT_INPUT,
        ...partial,
        referenceReceived: false,
        analysis: null,
      });

      expect(result.rawScore).toBe(rawScore);
      expect(result.status).toBe(ReadinessStatus.INCOMPLETO);
      expect(result.contributions.map(({ ruleId }) => ruleId)).toEqual(ruleIds);
      expect(result.blockers.map(({ ruleId }) => ruleId)).toEqual(['FLOW_INCOMPLETE']);
    },
  );

  it.each([
    {
      name: 'NOT_ON_SKIN hard gate',
      config: configWith({ weights: { NOT_ON_SKIN: 100 } }),
      analysis: { tattooOnSkin: false },
      expectedStatus: ReadinessStatus.INCOMPLETO,
      expectedBlocker: 'NOT_ON_SKIN',
    },
    {
      name: 'SIZE_MISMATCH review gate',
      config: configWith({ weights: { SIZE_MISMATCH: 15 } }),
      analysis: { detectedSize: TattooSize.LARGE },
      expectedStatus: ReadinessStatus.REVISAR,
      expectedBlocker: 'SIZE_MISMATCH',
    },
    {
      name: 'DETAIL_MISMATCH review gate',
      config: configWith({ weights: { DETAIL_MISMATCH: 15 } }),
      analysis: { detectedDetail: DetailLevel.LIGHT },
      expectedStatus: ReadinessStatus.REVISAR,
      expectedBlocker: 'DETAIL_MISMATCH',
    },
  ])(
    'applies $name even when the normalized score is at least 90',
    async ({ config, analysis, expectedStatus, expectedBlocker }) => {
      const result = await createService(config).evaluate(inputWith({}, analysis));

      expect(result.readinessScore).toBeGreaterThanOrEqual(90);
      expect(result.status).toBe(expectedStatus);
      expect(result.blockers.map(({ ruleId }) => ruleId)).toContain(expectedBlocker);
    },
  );

  it.each([
    ['sizeConfidence', { sizeConfidence: 0.899 }, 'LOW_SIZE_CONFIDENCE'],
    ['detailConfidence', { detailConfidence: 0.899 }, 'LOW_DETAIL_CONFIDENCE'],
  ])('never returns LISTO when %s is below 90%%', async (_field, analysis, blocker) => {
    const result = await createService().evaluate(inputWith({}, analysis));

    expect(result.readinessScore).toBe(100);
    expect(result.status).toBe(ReadinessStatus.REVISAR);
    expect(result.blockers.map(({ ruleId }) => ruleId)).toContain(blocker);
  });

  it('adds all penalties and keeps contributions equal to the raw score', async () => {
    const result = await createService().evaluate(
      inputWith(
        {},
        {
          detectedSize: TattooSize.LARGE,
          detectedDetail: DetailLevel.LIGHT,
          referenceAnalyzable: false,
          ambiguityLevel: ImageAmbiguityLevel.MINOR,
        },
      ),
    );

    expect(result.rawScore).toBe(60);
    expect(result.contributions.reduce((sum, contribution) => sum + contribution.points, 0)).toBe(
      result.rawScore,
    );
    expect(result.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'SIZE_MISMATCH', points: -40 }),
        expect.objectContaining({ ruleId: 'DETAIL_MISMATCH', points: -40 }),
        expect.objectContaining({ ruleId: 'HARD_TO_ANALYZE', points: -50 }),
        expect.objectContaining({ ruleId: 'MINOR_AMBIGUITY', points: -10 }),
      ]),
    );
  });

  it.each([
    ['lower bound', configWith({ weights: { NOT_ON_SKIN: -500 } }), { tattooOnSkin: false }, 0],
    ['upper bound', configWith({ weights: { TATTOO_ON_SKIN: 1_000 } }), {}, 100],
  ])('clamps readiness at the %s', async (_name, config, analysis, expected) => {
    const result = await createService(config).evaluate(inputWith({}, analysis));

    expect(result.readinessScore).toBe(expected);
  });

  it('explains every gate override with the exact matched blockers', async () => {
    const result = await createService().evaluate(
      inputWith({}, { detectedSize: TattooSize.LARGE, sizeConfidence: 0.8 }),
    );

    expect(result.status).toBe(ReadinessStatus.REVISAR);
    expect(result.blockers).toEqual([
      {
        ruleId: 'SIZE_MISMATCH',
        reason: 'El tamaño indicado no coincide con el análisis',
      },
      {
        ruleId: 'LOW_SIZE_CONFIDENCE',
        reason: 'La confianza del tamaño detectado es menor al 90%',
      },
    ]);
  });

  it('gives an incomplete hard gate precedence over review gates', async () => {
    const result = await createService().evaluate({
      ...inputWith({}, { detectedSize: TattooSize.LARGE }),
      bodyPart: null,
    });

    expect(result.status).toBe(ReadinessStatus.INCOMPLETO);
    expect(result.blockers.map(({ ruleId }) => ruleId)).toEqual([
      'FLOW_INCOMPLETE',
      'SIZE_MISMATCH',
    ]);
  });

  it.each([
    [
      'missing reference',
      { referenceReceived: false, conversationStatus: ConversationStatus.ACTIVE },
    ],
    [
      'abandoned conversation',
      { referenceReceived: true, conversationStatus: ConversationStatus.ABANDONED },
    ],
  ])('classifies an incomplete flow caused by %s as INCOMPLETO', async (_name, input) => {
    const result = await createService().evaluate(inputWith(input));

    expect(result.status).toBe(ReadinessStatus.INCOMPLETO);
    expect(result.blockers).toEqual([
      {
        ruleId: 'FLOW_INCOMPLETE',
        reason: 'La cotización está incompleta o la conversación fue abandonada',
      },
    ]);
  });

  it('changes the result by configuration when a weight changes', async () => {
    const input = inputWith({}, { ambiguityLevel: ImageAmbiguityLevel.MINOR });
    const original = await createService().evaluate(input);
    const changed = await createService(configWith({ weights: { MINOR_AMBIGUITY: -30 } })).evaluate(
      input,
    );

    expect(original.rawScore).toBe(240);
    expect(changed.rawScore).toBe(220);
  });

  it('persists rulesVersion and a precise normalized score through an idempotent upsert', async () => {
    const upsert = vi.fn((arguments_: Prisma.LeadEvaluationUpsertArgs) =>
      Promise.resolve({ id: 'evaluation-id', arguments_ }),
    );
    const service = createService();

    const result = await service.evaluateAndPersist(
      '290f2044-e63c-4e49-8847-067cd62426e4',
      inputWith({}, { ambiguityLevel: ImageAmbiguityLevel.MINOR }),
      { leadEvaluation: { upsert } } as unknown as Pick<Prisma.TransactionClient, 'leadEvaluation'>,
    );

    expect(result.rulesVersion).toBe(1);
    expect(upsert).toHaveBeenCalledOnce();
    const persisted = upsert.mock.calls[0]?.[0];
    expect(persisted?.where).toEqual({
      leadId: '290f2044-e63c-4e49-8847-067cd62426e4',
    });
    expect(persisted?.update).toMatchObject({
      rulesVersion: 1,
      readinessScore: new Prisma.Decimal('96.00'),
    });
    expect(persisted?.create).toMatchObject({
      leadId: '290f2044-e63c-4e49-8847-067cd62426e4',
      rulesVersion: 1,
      readinessScore: new Prisma.Decimal('96.00'),
    });
  });
});
