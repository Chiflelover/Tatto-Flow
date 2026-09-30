import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type Quote } from '../../generated/prisma/client.js';
import { ALGORITHM_VERSION, buildModel } from '../calibration/model-interpolation.js';
import { prepareV2Case } from '../chatbot/domain/nita-v2-decision.js';
import { persistedVision } from '../../../test/fixtures/vision-v2.js';
import { QuoteV2Service } from './quote-v2.service.js';

function fixture() {
  const accountId = crypto.randomUUID(),
    leadId = crypto.randomUUID();
  const observations = persistedVision();
  observations.referenceAreaCm2 = 50;
  observations.colorCoverage = 0.5;
  observations.referenceEssentiallyBlack = false;
  const preparation = prepareV2Case(
    {
      firstTattoo: true,
      sameSizeAsReference: true,
      targetSizeCm: null,
      colorDeclaration: 'MOSTLY_COLOR',
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
    quote: null as Quote | null,
    aiAnalysis: observations,
    conversation: { flowVersion: 'V2' },
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
    expect(result.quote.targetAreaCm2.toString()).toBe('50');
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
  it('never uses Quote V2 for a V1 conversation', async () => {
    const f = fixture();
    f.lead.conversation.flowVersion = 'V1';
    await expect(f.service.getOrCreate(f.tx, f.accountId, f.leadId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.create).not.toHaveBeenCalled();
  });
});
