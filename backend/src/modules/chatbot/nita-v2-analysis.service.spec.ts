import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AiAnalysis, Conversation, Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  persistedVision,
  VISION_IMAGE,
  VISION_STYLES,
  visionResult,
} from '../../../test/fixtures/vision-v2.js';
import { ImageAnalysisV2Service } from '../image-analysis/image-analysis-v2.service.js';
import { AIProviderError } from '../image-analysis/ai-provider.error.js';
import type { ImageAnalysisService } from '../image-analysis/image-analysis.service.js';
import { InMemoryStorageService } from '../storage/in-memory-storage.service.js';
import {
  NitaV2AnalysisService,
  V2_ANALYSIS_TIMEOUT_MS,
  V2AnalysisRetryableError,
} from './nita-v2-analysis.service.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(overrides: Partial<Conversation> = {}) {
  const accountId = crypto.randomUUID();
  let conversation: Conversation = {
    id: crypto.randomUUID(),
    accountId,
    customerId: crypto.randomUUID(),
    flowVersion: 'V2',
    currentState: 'READY_FOR_ANALYSIS',
    status: 'ACTIVE',
    selectedSize: null,
    selectedDetail: null,
    firstTattoo: false,
    sameSizeAsReference: true,
    targetSizeCm: null,
    colorDeclaration: 'BLACK_ONLY',
    bodyPart: 'Antebrazo',
    v2AnalysisClaimId: null,
    v2AnalysisLeaseUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  };
  const leadId = crypto.randomUUID();
  const image = {
    id: crypto.randomUUID(),
    storagePath: `leads/${leadId}/${crypto.randomUUID()}.png`,
  };
  let stored: AiAnalysis | null = null;
  let preparation: Prisma.InputJsonValue | null = null;
  const storage = new InMemoryStorageService();
  await storage.upload({
    path: image.storagePath,
    content: VISION_IMAGE.content,
    contentType: VISION_IMAGE.mimeType,
  });
  const analyzeTattooImageV2 = vi.fn().mockResolvedValue(visionResult());
  const owned = ({ where }: { where: { id: string; accountId: string } }) =>
    where.id === conversation.id && where.accountId === accountId
      ? Promise.resolve({
          ...conversation,
          account: { isActive: true },
          lead: {
            id: leadId,
            accountId,
            customerId: conversation.customerId,
            aiAnalysis: stored,
            images: [image],
          },
        })
      : Promise.resolve(null);
  const updateConversation = vi.fn(({ data }: { data: Partial<Conversation> }) => {
    conversation = { ...conversation, ...data };
    return Promise.resolve({ ...conversation });
  });
  const release = vi.fn(
    ({ where, data }: { where: { v2AnalysisClaimId: string }; data: Partial<Conversation> }) => {
      if (conversation.v2AnalysisClaimId !== where.v2AnalysisClaimId)
        return Promise.resolve({ count: 0 });
      conversation = { ...conversation, ...data };
      return Promise.resolve({ count: 1 });
    },
  );
  const updateLead = vi.fn(({ data }: { data: { v2Preparation: Prisma.InputJsonValue } }) => {
    preparation = data.v2Preparation;
    return Promise.resolve({ id: leadId });
  });
  const upsertAnalysis = vi.fn(({ create }: { create: Partial<AiAnalysis> }) => {
    stored ??= { ...persistedVision(), id: crypto.randomUUID(), leadId, ...create };
    return Promise.resolve(stored);
  });
  const styleLookup = vi.fn(
    ({
      select,
    }: {
      select: { artistStyles: { where: { accountId: string; isEnabled: boolean } } };
    }) =>
      Promise.resolve({
        id: 'style-id',
        artistStyles:
          select.artistStyles.where.accountId === accountId && select.artistStyles.where.isEnabled
            ? [{ accountId }]
            : [],
      }),
  );
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    conversation: { findFirst: vi.fn(owned), update: updateConversation },
    lead: {
      findFirst: vi.fn(({ where }: { where: { id: string; accountId: string } }) =>
        Promise.resolve(
          where.id === leadId && where.accountId === accountId ? { id: leadId } : null,
        ),
      ),
      update: updateLead,
    },
    aiAnalysis: { upsert: upsertAnalysis },
    tattooStyle: { findUnique: styleLookup },
  };
  // Emulate the row lock and transaction rollback; provider work runs outside the transaction.
  let queue = Promise.resolve();
  const runTransaction = async (
    callback: (client: Prisma.TransactionClient) => Promise<unknown>,
  ) => {
    const previous = queue;
    let unlock!: () => void;
    queue = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    const before = { conversation, stored, preparation };
    try {
      return await callback(tx as unknown as Prisma.TransactionClient);
    } catch (error) {
      ({ conversation, stored, preparation } = before);
      throw error;
    } finally {
      unlock();
    }
  };
  const prisma = {
    ...tx,
    conversation: { ...tx.conversation, updateMany: release },
    tattooStyle: { ...tx.tattooStyle, findMany: vi.fn().mockResolvedValue(VISION_STYLES) },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const vision = new ImageAnalysisV2Service(prisma, {
    analyzeTattooImageV2,
  } as unknown as ImageAnalysisService);
  return {
    service: new NitaV2AnalysisService(prisma, vision, storage),
    accountId,
    conversationId: conversation.id,
    analyzeTattooImageV2,
    upsertAnalysis,
    updateLead,
    styleLookup,
    storage,
    image,
    current: () => ({ conversation, stored, preparation }),
    change: (changes: Partial<Conversation>) => {
      conversation = { ...conversation, ...changes };
    },
    setStored: (value: AiAnalysis) => {
      stored = value;
    },
  };
}

describe('Nita V2 analysis ownership and persistence', () => {
  it('scopes pending retry lookup to V2 and the channel account without creating intake', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'pending-conversation' });
    const service = new NitaV2AnalysisService(
      { conversation: { findFirst } } as unknown as PrismaService,
      {} as ImageAnalysisV2Service,
      new InMemoryStorageService(),
    );
    const f = await fixture();
    const process = vi
      .spyOn(service, 'process')
      .mockResolvedValue({ ...f.current().conversation, currentState: 'READY_FOR_PRICING' });
    await service.resumePendingForCustomer(f.accountId, '51900000001');
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        accountId: f.accountId,
        flowVersion: 'V2',
        status: 'ACTIVE',
        currentState: { in: ['READY_FOR_ANALYSIS', 'ANALYZING'] },
        customer: { phoneNumber: '51900000001' },
      },
      select: { id: true },
    });
    expect(process).toHaveBeenCalledWith(f.accountId, 'pending-conversation');
    process.mockResolvedValue({ ...f.current().conversation, currentState: 'ANALYZING' });
    await expect(service.resumePendingForCustomer(f.accountId, '51900000001')).rejects.toThrow(
      'El análisis sigue en proceso',
    );
    findFirst.mockResolvedValue(null);
    await service.resumePendingForCustomer(f.accountId, '51900000001');
    expect(process).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid provider ranges as ordinary review without persisting invalid observations', async () => {
    const f = await fixture();
    const result = visionResult();
    result.observations.overallConfidence = 1.01;
    f.analyzeTattooImageV2.mockResolvedValue(result);
    await f.service.process(f.accountId, f.conversationId);
    expect(f.current().preparation).toMatchObject({
      decision: 'HUMAN_REVIEW',
      reviewReasons: ['INVALID_ANALYSIS'],
    });
    expect(f.current().stored).toBeNull();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('reads a private reference, persists metadata and prepares once without deleting it', async () => {
    const f = await fixture();
    const original = await f.storage.download(f.image.storagePath);
    expect((await f.service.process(f.accountId, f.conversationId)).currentState).toBe(
      'READY_FOR_PRICING',
    );
    const finished = f.current();
    expect(finished.stored).toMatchObject({
      ...visionResult().observations,
      provider: 'gemini',
      model: 'gemini-test-model',
      schemaVersion: 'VISION_V2_2',
      rawResponse: visionResult().rawResponse,
    });
    expect(finished.preparation).toMatchObject({
      decision: 'READY_FOR_PRICING',
      targetAreaCm2: '54',
      analysisId: finished.stored!.id,
    });
    await f.service.process(f.accountId, f.conversationId);
    expect(f.current()).toEqual(finished);
    expect(f.upsertAnalysis).toHaveBeenCalledOnce();
    expect(f.analyzeTattooImageV2).toHaveBeenCalledWith(original, VISION_STYLES, {
      leadId: finished.stored!.leadId,
    });
    expect(await f.storage.exists(f.image.storagePath)).toBe(true);
    expect(f.updateLead).toHaveBeenCalledOnce();
  });
  it('keeps a live claim exclusive while two requests overlap', async () => {
    const f = await fixture();
    const providerStarted = deferred<void>();
    const providerResult = deferred<ReturnType<typeof visionResult>>();
    f.analyzeTattooImageV2.mockImplementation(() => {
      providerStarted.resolve(undefined);
      return providerResult.promise;
    });
    const first = f.service.process(f.accountId, f.conversationId);
    await providerStarted.promise;
    expect((await f.service.process(f.accountId, f.conversationId)).currentState).toBe('ANALYZING');
    providerResult.resolve(visionResult());
    expect((await first).currentState).toBe('READY_FOR_PRICING');
    expect(f.analyzeTattooImageV2).toHaveBeenCalledOnce();
    expect(f.upsertAnalysis).toHaveBeenCalledOnce();
  });
  it('recovers an expired claim and reuses a previously persisted analysis', async () => {
    const f = await fixture({
      currentState: 'ANALYZING',
      v2AnalysisClaimId: crypto.randomUUID(),
      v2AnalysisLeaseUntil: new Date(0),
    });
    const stored = persistedVision();
    f.setStored(stored);
    await f.service.process(f.accountId, f.conversationId);
    expect(f.current().conversation).toMatchObject({
      currentState: 'READY_FOR_PRICING',
      v2AnalysisClaimId: null,
      v2AnalysisLeaseUntil: null,
    });
    expect(f.current().stored).toEqual(stored);
    expect(f.analyzeTattooImageV2).not.toHaveBeenCalled();
    expect(f.upsertAnalysis).not.toHaveBeenCalled();
  });
  it('fences a late worker after its claim expires and another worker finalizes', async () => {
    const f = await fixture();
    const started = deferred<void>();
    const stale = deferred<ReturnType<typeof visionResult>>();
    f.analyzeTattooImageV2.mockImplementationOnce(() => {
      started.resolve(undefined);
      return stale.promise;
    });
    const oldWork = f.service.process(f.accountId, f.conversationId);
    await started.promise;
    f.change({ v2AnalysisLeaseUntil: new Date(0) });
    await f.service.process(f.accountId, f.conversationId);
    const snapshot = f.current();
    const oldResult = visionResult();
    oldResult.observations.extensiveBodyCoverage = true;
    stale.resolve(oldResult);
    await oldWork;
    expect(f.current()).toEqual(snapshot);
    expect(f.current().conversation.currentState).toBe('READY_FOR_PRICING');
    expect(f.upsertAnalysis).toHaveBeenCalledOnce();
    expect(f.updateLead).toHaveBeenCalledOnce();
  });
  it('settles exhausted provider failures into HUMAN_REVIEW instead of remaining ANALYZING', async () => {
    const f = await fixture();
    f.analyzeTattooImageV2.mockRejectedValueOnce(new Error('Providers exhausted'));
    expect((await f.service.process(f.accountId, f.conversationId)).currentState).toBe(
      'HUMAN_REVIEW',
    );
    expect(f.current().preparation).toMatchObject({ reviewReasons: ['ANALYSIS_FAILED'] });
    expect(f.current().stored).toBeNull();
    expect(await f.storage.exists(f.image.storagePath)).toBe(true);
  });
  it('bounds a stalled provider and discards its eventual late result', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const late = deferred<ReturnType<typeof visionResult>>();
    f.analyzeTattooImageV2.mockReturnValueOnce(late.promise);
    const work = f.service.process(f.accountId, f.conversationId);
    await vi.advanceTimersByTimeAsync(V2_ANALYSIS_TIMEOUT_MS + 1);
    expect((await work).currentState).toBe('HUMAN_REVIEW');
    late.resolve(visionResult());
    await Promise.resolve();
    expect(f.current().stored).toBeNull();
    expect(f.upsertAnalysis).not.toHaveBeenCalled();
  });
  it('keeps transient provider failures retryable for durable processing', async () => {
    const f = await fixture();
    f.analyzeTattooImageV2.mockRejectedValueOnce(
      new AIProviderError({
        provider: 'gemini',
        category: 'TIMEOUT',
        retryable: true,
        fallbackEligible: false,
      }),
    );
    await expect(
      f.service.process(f.accountId, f.conversationId, { retryTransientFailures: true }),
    ).rejects.toBeInstanceOf(V2AnalysisRetryableError);
    expect(f.current()).toMatchObject({
      stored: null,
      preparation: null,
      conversation: {
        currentState: 'ANALYZING',
        v2AnalysisClaimId: null,
        v2AnalysisLeaseUntil: null,
      },
    });
    await f.service.process(f.accountId, f.conversationId, { retryTransientFailures: true });
    expect(f.current().conversation.currentState).toBe('READY_FOR_PRICING');
    expect(f.upsertAnalysis).toHaveBeenCalledOnce();
  });
  it('releases a timed out durable analysis and never persists the late response', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const late = deferred<ReturnType<typeof visionResult>>();
    f.analyzeTattooImageV2.mockReturnValueOnce(late.promise);
    const rejected = expect(
      f.service.process(f.accountId, f.conversationId, { retryTransientFailures: true }),
    ).rejects.toBeInstanceOf(V2AnalysisRetryableError);
    await vi.advanceTimersByTimeAsync(V2_ANALYSIS_TIMEOUT_MS + 1);
    await rejected;
    late.resolve(visionResult());
    await Promise.resolve();
    expect(f.current().stored).toBeNull();
    expect(f.current().preparation).toBeNull();
    expect(f.current().conversation.v2AnalysisClaimId).toBeNull();
    expect(f.upsertAnalysis).not.toHaveBeenCalled();
  });
  it('reviews missing Storage without calling the provider', async () => {
    const f = await fixture();
    await f.storage.delete(f.image.storagePath);
    await f.service.process(f.accountId, f.conversationId);
    expect(f.current().preparation).toMatchObject({
      decision: 'HUMAN_REVIEW',
      reviewReasons: ['REFERENCE_UNAVAILABLE'],
    });
    expect(f.analyzeTattooImageV2).not.toHaveBeenCalled();
  });
  it('reviews an invalid downloaded image without sending it to the provider', async () => {
    const f = await fixture();
    vi.spyOn(f.storage, 'download').mockResolvedValue({
      content: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
    });
    await f.service.process(f.accountId, f.conversationId);
    expect(f.current().preparation).toMatchObject({
      decision: 'HUMAN_REVIEW',
      reviewReasons: ['REFERENCE_UNAVAILABLE'],
    });
    expect(f.analyzeTattooImageV2).not.toHaveBeenCalled();
    expect(f.upsertAnalysis).not.toHaveBeenCalled();
    expect(f.current().conversation.v2AnalysisClaimId).toBeNull();
  });
  it('releases ownership and rolls back decision/analysis on a DB failure before retry', async () => {
    const f = await fixture();
    f.updateLead.mockRejectedValueOnce(new Error('DB failure'));
    await expect(f.service.process(f.accountId, f.conversationId)).rejects.toThrow('DB failure');
    expect(f.current()).toMatchObject({
      stored: null,
      preparation: null,
      conversation: {
        currentState: 'ANALYZING',
        v2AnalysisClaimId: null,
        v2AnalysisLeaseUntil: null,
      },
    });
    await f.service.process(f.accountId, f.conversationId);
    expect(f.current().conversation.currentState).toBe('READY_FOR_PRICING');
    expect(f.current().stored).not.toBeNull();
  });
  it('checks only the owned artist style configuration and rejects another account before AI', async () => {
    const f = await fixture();
    await expect(f.service.process(crypto.randomUUID(), f.conversationId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(f.analyzeTattooImageV2).not.toHaveBeenCalled();
    await f.service.process(f.accountId, f.conversationId);
    expect(f.styleLookup).toHaveBeenCalledWith({
      where: { code: 'FINE_LINE' },
      select: {
        id: true,
        artistStyles: {
          where: { accountId: f.accountId, isEnabled: true },
          select: { accountId: true },
        },
      },
    });
  });
  it('never starts V2 processing for V1', async () => {
    const f = await fixture({ flowVersion: 'V1' });
    await expect(f.service.process(f.accountId, f.conversationId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.analyzeTattooImageV2).not.toHaveBeenCalled();
  });
  it('keeps abandoned conversation and image intact', async () => {
    const f = await fixture({ status: 'ABANDONED' });
    const before = f.current();
    await f.service.process(f.accountId, f.conversationId);
    expect(f.current()).toEqual(before);
    expect(f.analyzeTattooImageV2).not.toHaveBeenCalled();
    expect(await f.storage.exists(f.image.storagePath)).toBe(true);
  });
  it('does not overwrite a historical V1 analysis attached to a V2 conversation', async () => {
    const f = await fixture();
    const original = persistedVision('V1');
    f.setStored(original);
    await f.service.process(f.accountId, f.conversationId);
    expect(f.current().stored).toEqual(original);
    expect(f.current().preparation).toMatchObject({
      decision: 'HUMAN_REVIEW',
      reviewReasons: ['INVALID_ANALYSIS'],
    });
    expect(f.upsertAnalysis).not.toHaveBeenCalled();
  });
});
