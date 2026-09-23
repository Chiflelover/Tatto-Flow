import { Logger } from '@nestjs/common';
import {
  ConversationState,
  ConversationStatus,
  DetailLevel,
  LeadStatus,
  Prisma,
  ReviewReason,
  TattooSize,
  type AiAnalysis,
  type Conversation,
  type Lead,
  type PricingRule,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { LEAD_SCORING_CONFIG_V1 } from '../lead-scoring/lead-scoring.config.js';
import { LeadScoringService } from '../lead-scoring/lead-scoring.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { LeadImageService } from '../storage/lead-image.service.js';
import { ValidationService } from '../validation/validation.service.js';
import { ImageAmbiguityLevel, type ImageAnalysisResult } from './domain/image-analysis.types.js';
import {
  type CompletedImageAnalysis,
  ImageAnalysisWorkflowService,
} from './image-analysis-workflow.service.js';
import { ImageAnalysisService } from './image-analysis.service.js';
import { GeminiImageAnalysisError } from './gemini-image-analysis.service.js';

const CONVERSATION_ID = 'a459f257-b03c-48f4-9091-2dc37871ef81';
const LEAD_ID = '290f2044-e63c-4e49-8847-067cd62426e4';
const PRICING_RULE_ID = 'ce16a85c-cc5b-43de-8a56-1b2ef568fd39';

interface FixtureOptions {
  selectedSize?: TattooSize;
  selectedDetail?: DetailLevel;
  analysis?: Partial<ImageAnalysisResult>;
  priceRange?: readonly [number, number];
  pricingRuleMissing?: boolean;
  analysisError?: Error;
}

interface AnalysisUpsertArguments {
  create: {
    leadId: string;
    detectedSize: TattooSize;
    sizeConfidence: number;
    detectedDetail: DetailLevel;
    detailConfidence: number;
    rawResponse: Prisma.JsonValue;
  };
}

interface LeadUpdateArguments {
  where: { id: string; status: LeadStatus };
  data: {
    status: LeadStatus;
    reviewReasons: ReviewReason[];
    calculatedMinPrice: Prisma.Decimal | null;
    calculatedMaxPrice: Prisma.Decimal | null;
    pricingRuleId: string | null;
    pricingRuleVersion: number | null;
  };
}

interface ConversationUpdateArguments {
  where: {
    id: string;
    status: ConversationStatus;
    currentState: ConversationState | { in: ConversationState[] };
  };
  data: {
    currentState: ConversationState;
    status?: ConversationStatus;
    lastActivityAt: Date;
  };
}

function createFixture(options: FixtureOptions = {}) {
  const now = new Date('2026-09-14T12:00:00.000Z');
  const selectedSize = options.selectedSize ?? TattooSize.MEDIUM;
  const selectedDetail = options.selectedDetail ?? DetailLevel.DETAILED;
  const providerResult: ImageAnalysisResult = {
    detectedSize: selectedSize,
    sizeConfidence: 0.95,
    detectedDetail: selectedDetail,
    detailConfidence: 0.95,
    tattooOnSkin: true,
    tattooOnSkinConfidence: 0.98,
    referenceAnalyzable: true,
    analyzabilityConfidence: 0.97,
    ambiguityLevel: ImageAmbiguityLevel.NONE,
    ...options.analysis,
  };
  let conversation: Conversation = {
    id: CONVERSATION_ID,
    customerId: '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e',
    currentState: ConversationState.ANALYZING,
    status: ConversationStatus.ACTIVE,
    selectedSize,
    selectedDetail,
    bodyPart: 'Brazo',
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  };
  let lead: Lead | null = null;
  let analysis: AiAnalysis | null = null;
  let pricingRule: PricingRule | null = options.pricingRuleMissing
    ? null
    : createPricingRule(options.priceRange ?? [500, 700], selectedSize, selectedDetail, now);

  const findConversation = vi.fn(() => Promise.resolve(conversation));
  const findLead = vi.fn(() => Promise.resolve(lead ? { ...lead, aiAnalysis: analysis } : null));
  const upsertLead = vi.fn(() => {
    if (!lead) {
      lead = {
        id: LEAD_ID,
        customerId: conversation.customerId,
        conversationId: conversation.id,
        selectedSize,
        selectedDetail,
        bodyPart: 'Brazo',
        status: LeadStatus.ANALYZING,
        reviewReasons: [],
        calculatedMinPrice: null,
        calculatedMaxPrice: null,
        pricingRuleId: null,
        pricingRuleVersion: null,
        priceSentAt: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    return Promise.resolve({ ...lead, aiAnalysis: analysis });
  });
  const upsertAnalysis = vi.fn((arguments_: AnalysisUpsertArguments) => {
    if (!analysis) {
      analysis = {
        id: 'c29080d9-49de-4d6e-bea2-6017cbe109f8',
        leadId: arguments_.create.leadId,
        detectedSize: arguments_.create.detectedSize,
        sizeConfidence: new Prisma.Decimal(arguments_.create.sizeConfidence),
        detectedDetail: arguments_.create.detectedDetail,
        detailConfidence: new Prisma.Decimal(arguments_.create.detailConfidence),
        rawResponse: arguments_.create.rawResponse,
        createdAt: now,
      };
    }

    return Promise.resolve(analysis);
  });
  const updateLead = vi.fn((arguments_: LeadUpdateArguments) => {
    const currentLead = lead;

    if (!currentLead || currentLead.status !== arguments_.where.status) {
      return Promise.resolve({ count: 0 });
    }

    lead = {
      ...currentLead,
      ...arguments_.data,
      updatedAt: new Date(),
    };

    return Promise.resolve({ count: 1 });
  });
  const findLeadOrThrow = vi.fn(() => {
    if (!lead) {
      throw new Error('Missing fixture lead.');
    }

    return Promise.resolve(lead);
  });
  const updateConversation = vi.fn((arguments_: ConversationUpdateArguments) => {
    const expectedState = arguments_.where.currentState;
    const stateMatches =
      typeof expectedState === 'string'
        ? conversation.currentState === expectedState
        : expectedState.in.includes(conversation.currentState);

    if (
      conversation.id !== arguments_.where.id ||
      conversation.status !== arguments_.where.status ||
      !stateMatches
    ) {
      return Promise.resolve({ count: 0 });
    }

    conversation = {
      ...conversation,
      currentState: arguments_.data.currentState,
      status: arguments_.data.status ?? conversation.status,
      lastActivityAt: arguments_.data.lastActivityAt,
      updatedAt: new Date(),
    };

    return Promise.resolve({ count: 1 });
  });
  const findConversationOrThrow = vi.fn(() => Promise.resolve(conversation));
  const findPricingRule = vi.fn(
    ({ where }: { where: { size: TattooSize; detail: DetailLevel; isActive: boolean } }) =>
      Promise.resolve(
        pricingRule?.size === where.size &&
          pricingRule.detail === where.detail &&
          pricingRule.isActive === where.isActive
          ? pricingRule
          : null,
      ),
  );
  const upsertEvaluation = vi.fn().mockResolvedValue({ id: 'evaluation-id' });
  const transactionClient = {
    aiAnalysis: { upsert: upsertAnalysis },
    lead: { updateMany: updateLead, findUniqueOrThrow: findLeadOrThrow },
    conversation: {
      updateMany: updateConversation,
      findUniqueOrThrow: findConversationOrThrow,
    },
    pricingRule: { findFirst: findPricingRule },
    leadEvaluation: { upsert: upsertEvaluation },
  };
  const runTransaction = vi.fn(
    (callback: (transaction: typeof transactionClient) => Promise<CompletedImageAnalysis>) =>
      callback(transactionClient),
  );
  const prisma = {
    conversation: { findUnique: findConversation },
    lead: { findUnique: findLead, upsert: upsertLead },
    pricingRule: { findFirst: findPricingRule },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const analyzeTattooImage = vi.fn(() =>
    options.analysisError ? Promise.reject(options.analysisError) : Promise.resolve(providerResult),
  );
  const provider = {
    providerName: 'mock',
    analyzeTattooImage,
  } as ImageAnalysisService;
  const ensureStored = vi.fn().mockResolvedValue({ id: 'stored-image' });
  const service = new ImageAnalysisWorkflowService(
    prisma,
    provider,
    new ValidationService(),
    new PricingService(prisma),
    { ensureStored } as unknown as LeadImageService,
    new LeadScoringService(LEAD_SCORING_CONFIG_V1),
  );

  return {
    service,
    getConversation: () => conversation,
    getLead: () => {
      if (!lead) {
        throw new Error('Missing fixture lead.');
      }

      return lead;
    },
    replacePricingRule: (minimum: number, maximum: number) => {
      pricingRule = createPricingRule([minimum, maximum], selectedSize, selectedDetail, new Date());
    },
    upsertLead,
    upsertAnalysis,
    upsertEvaluation,
    analyzeTattooImage,
    findPricingRule,
    ensureStored,
  };
}

function createPricingRule(
  range: readonly [number, number],
  size: TattooSize,
  detail: DetailLevel,
  updatedAt: Date,
): PricingRule {
  return {
    id: PRICING_RULE_ID,
    size,
    detail,
    minPrice: new Prisma.Decimal(range[0]),
    maxPrice: new Prisma.Decimal(range[1]),
    isActive: true,
    version: 1,
    updatedAt,
  };
}

const TEST_IMAGE = {
  content: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png',
  fileName: 'referencia.png',
};

describe('ImageAnalysisWorkflowService quotation finalization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists the complete lead and its AI analysis once', async () => {
    const fixture = createFixture();

    await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);

    expect(fixture.upsertLead).toHaveBeenCalledOnce();
    expect(fixture.ensureStored).toHaveBeenCalledWith(LEAD_ID, TEST_IMAGE);
    expect(fixture.upsertAnalysis).toHaveBeenCalledOnce();
    expect(fixture.upsertEvaluation).toHaveBeenCalledOnce();
    expect(fixture.getLead().conversationId).toBe(CONVERSATION_ID);
  });

  it('logs successful AI duration without changing the workflow result', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const fixture = createFixture();

    const result = await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);

    expect(result.quotation.status).toBe(LeadStatus.VERIFIED);
    const messages = log.mock.calls.flat().join(' ');
    expect(messages).toContain('ai.analysis.completed');
    expect(messages).toContain('durationMs');
    expect(messages).toContain(LEAD_ID);
  });

  it.each([
    ['RATE_LIMITED', 'ai.analysis.rate_limited'],
    ['TIMEOUT', 'ai.analysis.timeout'],
  ] as const)(
    'logs a safe %s provider failure and preserves review fallback',
    async (code, event) => {
      const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const fixture = createFixture({ analysisError: new GeminiImageAnalysisError(code) });

      const result = await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);

      expect(result.quotation.status).toBe(LeadStatus.REQUIRES_REVIEW);
      const messages = errorLog.mock.calls.flat().join(' ');
      expect(messages).toContain(event);
      expect(messages).toContain(LEAD_ID);
      expect(messages).not.toContain('GEMINI_API_KEY');
    },
  );

  it('copies the verified price and rule version into the lead', async () => {
    const fixture = createFixture();

    const result = await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);
    const lead = fixture.getLead();

    expect(result.quotation.status).toBe(LeadStatus.VERIFIED);
    expect(lead.status).toBe(LeadStatus.VERIFIED);
    expect(lead.calculatedMinPrice?.toString()).toBe('500');
    expect(lead.calculatedMaxPrice?.toString()).toBe('700');
    expect(lead.pricingRuleId).toBe(PRICING_RULE_ID);
    expect(lead.pricingRuleVersion).toBe(1);
    expect(lead.reviewReasons).toEqual([]);
  });

  it('preserves the old lead price after the pricing rule changes', async () => {
    const fixture = createFixture();

    await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);
    fixture.replacePricingRule(999, 1200);
    const repeated = await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);

    expect(repeated.quotation.pricingRule).toMatchObject({ minPrice: '500', maxPrice: '700' });
    expect(fixture.getLead().calculatedMinPrice?.toString()).toBe('500');
    expect(fixture.getLead().calculatedMaxPrice?.toString()).toBe('700');
  });

  it('does not calculate a price for REQUIRES_REVIEW', async () => {
    const fixture = createFixture({
      analysis: { detectedSize: TattooSize.LARGE, sizeConfidence: 0.85 },
    });

    await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);
    const lead = fixture.getLead();

    expect(lead.status).toBe(LeadStatus.REQUIRES_REVIEW);
    expect(lead.calculatedMinPrice).toBeNull();
    expect(lead.calculatedMaxPrice).toBeNull();
    expect(lead.pricingRuleId).toBeNull();
    expect(fixture.findPricingRule).not.toHaveBeenCalled();
  });

  it('never calculates an automatic price when the reference is not on skin', async () => {
    const fixture = createFixture({ analysis: { tattooOnSkin: false } });

    await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);
    const lead = fixture.getLead();

    expect(lead.status).toBe(LeadStatus.REQUIRES_REVIEW);
    expect(lead.reviewReasons).toContain(ReviewReason.NOT_ON_SKIN);
    expect(lead.calculatedMinPrice).toBeNull();
    expect(lead.calculatedMaxPrice).toBeNull();
    expect(fixture.findPricingRule).not.toHaveBeenCalled();
  });

  it('stores multiple review reasons on the lead', async () => {
    const fixture = createFixture({
      analysis: {
        detectedSize: TattooSize.LARGE,
        detectedDetail: DetailLevel.LIGHT,
        sizeConfidence: 0.85,
      },
    });

    await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);

    expect(fixture.getLead().reviewReasons).toEqual([
      ReviewReason.SIZE_MISMATCH,
      ReviewReason.DETAIL_MISMATCH,
      ReviewReason.LOW_SIZE_CONFIDENCE,
    ]);
  });

  it('finishes a VERIFIED conversation in HANDOFF_TO_TATTOO_ARTIST', async () => {
    const fixture = createFixture();

    await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);

    expect(fixture.getConversation()).toMatchObject({
      currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
      status: ConversationStatus.COMPLETED,
    });
  });

  it('finishes a REQUIRES_REVIEW conversation in HANDOFF_TO_TATTOO_ARTIST', async () => {
    const fixture = createFixture({ analysis: { detailConfidence: 0.899 } });

    await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);

    expect(fixture.getConversation()).toMatchObject({
      currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
      status: ConversationStatus.COMPLETED,
    });
  });

  it('does not duplicate the lead, analysis, or historical price on repeated processing', async () => {
    const fixture = createFixture();

    const first = await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);
    fixture.replacePricingRule(999, 1200);
    const second = await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);

    expect(first.quotation).toEqual(second.quotation);
    expect(fixture.upsertLead).toHaveBeenCalledOnce();
    expect(fixture.upsertAnalysis).toHaveBeenCalledOnce();
    expect(fixture.upsertEvaluation).toHaveBeenCalledOnce();
    expect(fixture.analyzeTattooImage).toHaveBeenCalledOnce();
    expect(fixture.findPricingRule).toHaveBeenCalledOnce();
    expect(fixture.ensureStored).toHaveBeenCalledOnce();
    expect(fixture.getLead().id).toBe(LEAD_ID);
  });

  it('routes a verified analysis without an active rule to review without inventing a price', async () => {
    const fixture = createFixture({ pricingRuleMissing: true });

    const result = await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);
    const lead = fixture.getLead();

    expect(result.quotation.status).toBe(LeadStatus.REQUIRES_REVIEW);
    expect(lead.reviewReasons).toEqual([ReviewReason.PRICING_RULE_NOT_FOUND]);
    expect(lead.calculatedMinPrice).toBeNull();
    expect(lead.calculatedMaxPrice).toBeNull();
  });

  it('finishes a provider failure as safe review without inventing analysis or price', async () => {
    const fixture = createFixture({ analysisError: new Error('provider unavailable') });

    const result = await fixture.service.analyzeConversationImage(CONVERSATION_ID, TEST_IMAGE);
    const lead = fixture.getLead();

    expect(result.analysis).toBeNull();
    expect(result.quotation.status).toBe(LeadStatus.REQUIRES_REVIEW);
    expect(lead.reviewReasons).toEqual([ReviewReason.AI_ERROR]);
    expect(lead.calculatedMinPrice).toBeNull();
    expect(lead.calculatedMaxPrice).toBeNull();
    expect(fixture.upsertAnalysis).not.toHaveBeenCalled();
    expect(fixture.upsertEvaluation).toHaveBeenCalledOnce();
    expect(fixture.getConversation()).toMatchObject({
      currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
      status: ConversationStatus.COMPLETED,
    });
  });
});
