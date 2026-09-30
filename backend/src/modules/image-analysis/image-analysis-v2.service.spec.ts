import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  persistedVision,
  VISION_IMAGE,
  VISION_STYLES,
  visionResult,
} from '../../../test/fixtures/vision-v2.js';
import { ImageAnalysisService } from './image-analysis.service.js';
import { ImageAnalysisV2Service } from './image-analysis-v2.service.js';

const accountId = '00000000-0000-4000-8000-000000000001';
const leadId = '00000000-0000-4000-8000-000000000020';

function fixture(flowVersion = 'V2') {
  let stored: ReturnType<typeof persistedVision> | null = null;
  const findFirst = vi.fn(({ where }: { where: { id: string; accountId: string } }) =>
    Promise.resolve(
      where.id === leadId && where.accountId === accountId
        ? { id: leadId, conversation: { flowVersion }, aiAnalysis: stored }
        : null,
    ),
  );
  const findStyles = vi.fn().mockResolvedValue(VISION_STYLES);
  const upsert = vi.fn(({ create }: { create: Record<string, unknown> }) => {
    stored ??= { ...persistedVision(), ...create };
    return Promise.resolve(stored);
  });
  const updateLead = vi.fn();
  const updateConversation = vi.fn();
  const tx = {
    lead: { findFirst, update: updateLead },
    aiAnalysis: { upsert },
    conversation: { update: updateConversation },
  };
  const prisma = {
    ...tx,
    tattooStyle: { findMany: findStyles },
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  } as unknown as PrismaService;
  const analyzeTattooImageV2 = vi.fn().mockResolvedValue(visionResult());
  const provider = { analyzeTattooImageV2 } as unknown as ImageAnalysisService;
  return {
    service: new ImageAnalysisV2Service(prisma, provider),
    findFirst,
    findStyles,
    upsert,
    analyzeTattooImageV2,
    updateLead,
    updateConversation,
    setStored: (value: ReturnType<typeof persistedVision>) => {
      stored = value;
    },
  };
}

describe('controlled AI Vision V2 persistence', () => {
  it('reads the dynamic catalog and analyzes a reference without customer declarations or DB writes', async () => {
    const f = fixture();
    const result = await f.service.analyzeReference(VISION_IMAGE);
    expect(result).toEqual(visionResult());
    expect(f.findStyles).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });
    expect(f.analyzeTattooImageV2).toHaveBeenCalledWith(VISION_IMAGE, VISION_STYLES, {});
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it('stores all V2 fields and provider provenance against the owned lead without commercial side effects', async () => {
    const f = fixture();
    const result = visionResult();
    result.observations.referenceMainDimensionCm = null;
    result.observations.referenceAreaCm2 = null;
    result.observations.extensiveBodyCoverage = true;
    result.observations.areaConfidence = 0.31;
    result.observations.scaleReferenceType = 'BODY_CONTEXT';
    result.observations.scaleConfidence = 0.12;
    f.analyzeTattooImageV2.mockResolvedValueOnce(result);
    const stored = await f.service.analyzeAndPersistLeadReference(accountId, leadId, VISION_IMAGE);
    expect(f.upsert).toHaveBeenCalledWith({
      where: { leadId },
      update: {},
      create: {
        leadId,
        analysisVersion: 'V2',
        ...result.observations,
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
        schemaVersion: result.schemaVersion,
        rawResponse: result.rawResponse,
      },
    });
    expect(f.findFirst).toHaveBeenLastCalledWith({
      where: { id: leadId, accountId, conversation: { flowVersion: 'V2' } },
      select: { id: true },
    });
    expect(stored.referenceAreaCm2).toBeNull();
    expect(stored.scaleReferenceType).toBe('BODY_CONTEXT');
    expect(stored.scaleConfidence).toBe(0.12);
    expect(stored.extensiveBodyCoverage).toBe(true);
    expect(stored.detectedSize).toBeNull();
    expect(stored.overallConfidence).toBe(0.91);
    expect(f.updateLead).not.toHaveBeenCalled();
    expect(f.updateConversation).not.toHaveBeenCalled();
    await f.service.analyzeAndPersistLeadReference(accountId, leadId, VISION_IMAGE);
    expect(f.analyzeTattooImageV2).toHaveBeenCalledTimes(1);
    expect(f.upsert).toHaveBeenCalledTimes(1);
  });

  it('normalizes NONE at the backend persistence boundary without losing the provider raw response', async () => {
    const f = fixture();
    const result = visionResult();
    result.observations.scaleReferenceType = 'NONE';
    result.observations.scaleConfidence = 0;
    f.analyzeTattooImageV2.mockResolvedValueOnce(result);

    const stored = await f.service.analyzeAndPersistLeadReference(accountId, leadId, VISION_IMAGE);
    expect(stored.referenceMainDimensionCm).toBeNull();
    expect(stored.referenceAreaCm2).toBeNull();
    expect(stored.scaleReferenceType).toBe('NONE');
    expect(stored.scaleConfidence).toBe(0);
    expect(stored.rawResponse).toEqual(result.rawResponse);
    expect(result.observations.referenceMainDimensionCm).toBe(12);
    expect(result.observations.referenceAreaCm2).toBe(54);
  });

  it('rejects a lead in another account before analysis or persistence', async () => {
    const f = fixture();
    await expect(
      f.service.analyzeAndPersistLeadReference('another-account', leadId, VISION_IMAGE),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.findFirst).toHaveBeenCalledWith({
      where: { id: leadId, accountId: 'another-account' },
      select: { conversation: { select: { flowVersion: true } }, aiAnalysis: true },
    });
    expect(f.analyzeTattooImageV2).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it('never activates V2 for a normal V1 conversation or overwrites a V1 analysis', async () => {
    const f = fixture('V1');
    await expect(
      f.service.analyzeAndPersistLeadReference(accountId, leadId, VISION_IMAGE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.analyzeTattooImageV2).not.toHaveBeenCalled();
    const v2 = fixture();
    v2.setStored(persistedVision('V1'));
    await expect(
      v2.service.analyzeAndPersistLeadReference(accountId, leadId, VISION_IMAGE),
    ).rejects.toThrow('histórico V1');
    expect(v2.upsert).not.toHaveBeenCalled();
  });
});
