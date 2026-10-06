import { NotFoundException } from '@nestjs/common';
import { Prisma, type Quote, type ColorDeclaration } from '../../generated/prisma/client.js';
import { ALGORITHM_VERSION, buildModel } from '../calibration/model-interpolation.js';
import { prepareV2Case } from '../chatbot/domain/nita-v2-decision.js';
import { persistedVision } from '../../../test/fixtures/vision-v2.js';
import { QuoteV2Service } from './quote-v2.service.js';
import {
  buildCatalogABModel,
  CATALOG_AB_ALGORITHM_VERSION,
} from '../calibration/catalog-ab-interpolation.js';
import {
  catalogABPricingFixture,
  CATALOG_TEST_STYLE_ID,
} from '../../../test/fixtures/catalog-ab-pricing.js';

function fixture(estimatedDensity: number | null = 34.5) {
  const accountId = crypto.randomUUID(),
    leadId = crypto.randomUUID();
  const observations = persistedVision();
  observations.estimatedDensity = estimatedDensity;
  observations.referenceAreaCm2 = 50;
  observations.compositionFillRatio = 1;
  observations.colorCoverage = 0.5;
  observations.referenceEssentiallyBlack = false;
  const preparation = prepareV2Case(
    {
      firstTattoo: true,
      sameSizeAsReference: true,
      targetSizeCm: 10,
      colorDeclaration: 'MEDIUM_COLOR',
      bodyPart: 'Brazo',
    },
    observations,
    { exists: true, enabled: true },
  );
  const model = {
    id: crypto.randomUUID(),
    version: 1,
    accountId,
    algorithmVersion: ALGORITHM_VERSION,
    adjustmentPercent: new Prisma.Decimal(10),
    caseSnapshot: [],
    modelParameters: buildModel([
      { caseId: 'a', type: 'AREA', areaCm2: 20, colorCoverage: 0, pricePen: '200' },
      { caseId: 'b', type: 'AREA', areaCm2: 100, colorCoverage: 0, pricePen: '1000' },
      { caseId: 'c', type: 'COLOR', areaCm2: 50, colorCoverage: 1, pricePen: '1000' },
    ]),
  };
  const lead = {
    id: leadId,
    accountId,
    targetSizeCm: 10 as number | null,
    colorDeclaration: 'MEDIUM_COLOR' as ColorDeclaration,
    quote: null as Quote | null,
    aiAnalysis: observations,
    conversation: {},
    v2Preparation: preparation,
  };
  const lookup = vi.fn().mockResolvedValue(model);
  const create = vi.fn(({ data }: { data: Omit<Quote, 'id' | 'createdAt'> }) => {
    lead.quote = { ...data, id: crypto.randomUUID(), createdAt: new Date() };
    return Promise.resolve(lead.quote);
  });
  const client = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    lead: {
      findFirst: vi.fn(({ where }: { where: { accountId: string; id: string } }) =>
        Promise.resolve(where.accountId === accountId && where.id === leadId ? lead : null),
      ),
    },
    pricingModelVersion: { findFirst: lookup },
    quote: { create },
  };
  return {
    service: new QuoteV2Service(),
    tx: client as unknown as Prisma.TransactionClient,
    accountId,
    leadId,
    lead,
    model,
    lookup,
    create,
  };
}

describe('Quote V2 pricing and historical snapshot', () => {
  it.each(['BLACK_WITH_SOME_COLOR', 'MOSTLY_COLOR'] as const)(
    'requires an explicit target for new quotes from historical %s even with an AREA/COLOR model',
    async (colorDeclaration) => {
      const f = fixture();
      f.lead.colorDeclaration = colorDeclaration;
      expect(await f.service.getOrCreate(f.tx, f.accountId, f.leadId)).toEqual({
        applicable: false,
        reason: 'INVALID_PREPARATION',
      });
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it.each([null, 0, 34.5, 100])('keeps pricing unchanged for density %s', async (density) => {
    const f = fixture(density);
    expect(f.lead.v2Preparation).toMatchObject({
      decision: 'READY_FOR_PRICING',
      targetAreaCm2: '50',
      targetColorCoverage: 0.5,
    });
    const result = await f.service.getOrCreate(f.tx, f.accountId, f.leadId);
    expect(result.applicable).toBe(true);
    if (!result.applicable) return;
    expect(result.quote.amount.toFixed(2)).toBe('825.00');
    expect(result.quote.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(result.quote.snapshot).not.toHaveProperty('estimatedDensity');
  });
  it('uses the account/style active model, Decimal inputs and incorporated adjustment', async () => {
    const f = fixture();
    const result = await f.service.getOrCreate(f.tx, f.accountId, f.leadId);
    expect(result.applicable).toBe(true);
    if (!result.applicable) return;
    expect(result.quote.amount.toFixed(2)).toBe('825.00');
    expect(result.quote).toMatchObject({
      accountId: f.accountId,
      leadId: f.leadId,
      pricingModelVersionId: f.model.id,
      currency: 'PEN',
      algorithmVersion: ALGORITHM_VERSION,
    });
    expect(result.quote.targetAreaCm2?.toString()).toBe('50');
    expect(result.quote.targetColorCoverage.toString()).toBe('0.5');
    expect(result.quote.snapshot).toMatchObject({
      modelParameters: f.model.modelParameters,
      generalAdjustmentPercent: '10',
      targetAreaCm2: '50',
    });
    expect(f.lookup).toHaveBeenCalledWith({
      where: {
        accountId: f.accountId,
        status: 'ACTIVE',
        style: {
          code: 'FINE_LINE',
          isActive: true,
          artistStyles: { some: { accountId: f.accountId, isEnabled: true } },
        },
      },
    });
  });
  it('reuses a quote after model, adjustment and prepared inputs change', async () => {
    const f = fixture();
    await f.service.getOrCreate(f.tx, f.accountId, f.leadId);
    const original = f.lead.quote;
    f.model.id = crypto.randomUUID();
    f.model.adjustmentPercent = new Prisma.Decimal(50);
    f.lead.v2Preparation.targetAreaCm2 = '99';
    const result = await f.service.getOrCreate(f.tx, f.accountId, f.leadId);
    expect(result).toEqual({ applicable: true, quote: original });
    expect(f.lookup).toHaveBeenCalledOnce();
    expect(f.create).toHaveBeenCalledOnce();
  });
  it('uses ordinary review when no active model is available', async () => {
    const f = fixture();
    f.lookup.mockResolvedValue(null);
    await expect(f.service.getOrCreate(f.tx, f.accountId, f.leadId)).resolves.toEqual({
      applicable: false,
      reason: 'PRICING_MODEL_NOT_AVAILABLE',
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it.each(['100.000000000000000000000000001', '19.99'])(
    'does not extrapolate or lose the Decimal boundary: %s',
    async (area) => {
      const f = fixture();
      f.lead.v2Preparation.targetAreaCm2 = area;
      await expect(f.service.getOrCreate(f.tx, f.accountId, f.leadId)).resolves.toEqual({
        applicable: false,
        reason: 'MODEL_NOT_APPLICABLE',
      });
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it('rejects a model with a historical unsupported algorithm without reinterpreting it', async () => {
    const f = fixture();
    f.model.algorithmVersion = 'HISTORICAL_V0' as typeof ALGORITHM_VERSION;
    await expect(f.service.getOrCreate(f.tx, f.accountId, f.leadId)).resolves.toEqual({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it('does not create or read another account quote', async () => {
    const f = fixture();
    await expect(f.service.getOrCreate(f.tx, crypto.randomUUID(), f.leadId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(f.lookup).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
});

describe('Quote V2 catalog A/B dispatch', () => {
  function catalogFixture() {
    const f = fixture(70);
    const points = catalogABPricingFixture();
    const model = {
      ...f.model,
      styleId: CATALOG_TEST_STYLE_ID,
      algorithmVersion: CATALOG_AB_ALGORITHM_VERSION,
      caseSnapshot: points,
      modelParameters: buildCatalogABModel(points),
    };
    f.lookup.mockResolvedValue(model);
    f.lead.targetSizeCm = 9;
    f.lead.v2Preparation.targetAreaCm2 = null;
    f.lead.v2Preparation.targetColorCoverage = 0.5;
    return { ...f, catalogModel: model };
  }
  it.each([
    [0.75, true],
    [0.749999999, false],
    [0.88, true],
  ] as const)(
    'applies Vision confidence %s before quoting an interpolated Fine Line input',
    async (overallConfidence, applicable) => {
      const f = catalogFixture();
      f.lead.colorDeclaration = 'LOW_COLOR';
      f.lead.aiAnalysis.overallConfidence = overallConfidence;
      f.lead.aiAnalysis.estimatedDensity = 73;
      f.lead.v2Preparation = prepareV2Case(
        {
          firstTattoo: true,
          sameSizeAsReference: true,
          targetSizeCm: 9,
          colorDeclaration: 'LOW_COLOR',
          bodyPart: 'Brazo',
        },
        f.lead.aiAnalysis,
        { exists: true, enabled: true, pricingAlgorithmVersion: CATALOG_AB_ALGORITHM_VERSION },
      );
      const result = await f.service.getOrCreate(f.tx, f.accountId, f.leadId);
      expect(result.applicable).toBe(applicable);
      if (result.applicable) {
        expect(result.quote.amount.toFixed(2)).toBe('318.77');
        expect(result.quote.snapshot).toMatchObject({
          targetSizeCm: 9,
          targetColorCoverage: '0.25',
          estimatedDensity: 73,
          calculation: { basePricePen: '242.5', densityFactor: '1.195' },
        });
        expect(f.create).toHaveBeenCalledOnce();
      } else {
        expect(f.lead.v2Preparation).toMatchObject({
          decision: 'HUMAN_REVIEW',
          reviewReasons: ['LOW_OVERALL_CONFIDENCE'],
        });
        expect(f.create).not.toHaveBeenCalled();
      }
    },
  );
  it('quotes from declared size/color/density and persists the complete computation without requiring area', async () => {
    const f = catalogFixture();
    const result = await f.service.getOrCreate(f.tx, f.accountId, f.leadId);
    expect(result.applicable).toBe(true);
    if (!result.applicable) return;
    expect(result.quote.amount.toFixed(2)).toBe('385.83');
    expect(result.quote.targetAreaCm2).toBeNull();
    expect(result.quote.snapshot).toMatchObject({
      version: 2,
      targetSizeCm: 9,
      estimatedDensity: 70,
      validTattooReference: true,
      modelParameters: f.catalogModel.modelParameters,
      calibrationCases: f.catalogModel.caseSnapshot,
      colorDeclaration: 'MEDIUM_COLOR',
      targetColorSource: 'CLIENT_DECLARATION',
      calculation: { basePricePen: '305', densityFactor: '1.15' },
    });
    f.lead.aiAnalysis.referenceMainDimensionCm = 1000;
    f.lead.aiAnalysis.referenceAreaCm2 = 10000;
    expect(await f.service.getOrCreate(f.tx, f.accountId, f.leadId)).toEqual(result);
    expect(f.create).toHaveBeenCalledOnce();
  });
  it.each([null, 0, 19.99, 100.01, NaN])(
    'does not quote missing or uncalibrated density %s',
    (density) => {
      const f = catalogFixture();
      f.lead.aiAnalysis.estimatedDensity = density;
      return expect(f.service.getOrCreate(f.tx, f.accountId, f.leadId)).resolves.toMatchObject({
        applicable: false,
        reason: 'MODEL_NOT_APPLICABLE',
      });
    },
  );
  it.each([null, 0, 3.99, 30.01, NaN])(
    'does not substitute a reference size for invalid client size %s',
    (size) => {
      const f = catalogFixture();
      f.lead.targetSizeCm = size;
      return expect(f.service.getOrCreate(f.tx, f.accountId, f.leadId)).resolves.toMatchObject({
        applicable: false,
        reason: 'MODEL_NOT_APPLICABLE',
      });
    },
  );
  it('never treats invalid-reference zero density as a real pricing observation', async () => {
    const f = catalogFixture();
    f.lead.aiAnalysis.validTattooReference = false;
    f.lead.aiAnalysis.estimatedDensity = 0;
    expect(await f.service.getOrCreate(f.tx, f.accountId, f.leadId)).toMatchObject({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it.each([null, -0.01, 1.01])(
    'rejects missing or out-of-domain target color %s',
    async (color) => {
      const f = catalogFixture();
      f.lead.v2Preparation.targetColorCoverage = color;
      expect(await f.service.getOrCreate(f.tx, f.accountId, f.leadId)).toMatchObject({
        applicable: false,
        reason: 'MODEL_NOT_APPLICABLE',
      });
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it('refuses parameter/style mismatches instead of using another style calibration', async () => {
    const f = catalogFixture();
    f.catalogModel.modelParameters.styleCode = 'BLACKWORK';
    expect(await f.service.getOrCreate(f.tx, f.accountId, f.leadId)).toMatchObject({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it.each([
    ['BLACK_ONLY', 0, '242.00'],
    ['LOW_COLOR', 0.25, '319.00'],
    ['MEDIUM_COLOR', 0.5, '396.00'],
    ['FULL_COLOR', 1, '528.00'],
  ] as const)(
    'quotes Fine Line with the chosen %s level %s',
    async (colorDeclaration, targetColorCoverage, amount) => {
      const f = catalogFixture();
      f.lead.colorDeclaration = colorDeclaration;
      f.lead.targetSizeCm = 11;
      f.lead.aiAnalysis.estimatedDensity = 60;
      f.lead.aiAnalysis.colorCoverage = 0.73;
      f.lead.v2Preparation.targetColorCoverage = targetColorCoverage;
      const result = await f.service.getOrCreate(f.tx, f.accountId, f.leadId);
      expect(result.applicable).toBe(true);
      if (!result.applicable) return;
      expect(result.quote.amount.toFixed(2)).toBe(amount);
      expect(result.quote.targetColorCoverage.toNumber()).toBe(targetColorCoverage);
      expect(result.quote.snapshot).toMatchObject({
        colorDeclaration,
        targetColorSource: 'CLIENT_DECLARATION',
      });
    },
  );
  it.each(['BLACK_WITH_SOME_COLOR', 'MOSTLY_COLOR'] as const)(
    'does not apply the new algorithm to ambiguous historical %s even with an old prepared coverage',
    async (colorDeclaration) => {
      const f = catalogFixture();
      f.lead.colorDeclaration = colorDeclaration;
      expect(await f.service.getOrCreate(f.tx, f.accountId, f.leadId)).toMatchObject({
        applicable: false,
        reason: 'MODEL_NOT_APPLICABLE',
      });
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it('rejects a stale preparation that reused reference color instead of the declared level', async () => {
    const f = catalogFixture();
    f.lead.colorDeclaration = 'LOW_COLOR';
    f.lead.v2Preparation.targetColorCoverage = 0.73;
    expect(await f.service.getOrCreate(f.tx, f.accountId, f.leadId)).toMatchObject({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it('returns an existing quote unchanged even when its historical declaration is ambiguous', async () => {
    const f = catalogFixture();
    const existing = await f.service.getOrCreate(f.tx, f.accountId, f.leadId);
    f.lead.colorDeclaration = 'MOSTLY_COLOR';
    f.lead.v2Preparation.targetColorCoverage = 0.47;
    f.lead.aiAnalysis.colorCoverage = 0.47;
    expect(await f.service.getOrCreate(f.tx, f.accountId, f.leadId)).toEqual(existing);
    expect(f.create).toHaveBeenCalledOnce();
  });
});
