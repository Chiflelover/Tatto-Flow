import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DetailLevel, TattooSize } from '../../generated/prisma/client.js';
import { AIProviderError, type AIProviderErrorCategory } from './ai-provider.error.js';
import { ImageAmbiguityLevel, type ImageAnalysisResult } from './domain/image-analysis.types.js';
import { GeminiImageAnalysisService } from './gemini-image-analysis.service.js';
import { OpenAIImageAnalysisService } from './openai-image-analysis.service.js';
import { ResilientImageAnalysisService } from './resilient-image-analysis.service.js';

const IMAGE = {
  content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  mimeType: 'image/png',
};

const VALID_RESULT: ImageAnalysisResult = {
  detectedSize: TattooSize.MEDIUM,
  sizeConfidence: 0.95,
  detectedDetail: DetailLevel.DETAILED,
  detailConfidence: 0.96,
  tattooOnSkin: true,
  tattooOnSkinConfidence: 0.98,
  referenceAnalyzable: true,
  analyzabilityConfidence: 0.97,
  ambiguityLevel: ImageAmbiguityLevel.NONE,
};

interface FixtureOptions {
  fallback?: 'none' | 'openai';
  geminiResults?: Array<ImageAnalysisResult | Error>;
  openAIResult?: ImageAnalysisResult | Error;
}

function createProviderError(
  category: AIProviderErrorCategory,
  options: { retryable?: boolean; fallbackEligible?: boolean; status?: number } = {},
): AIProviderError {
  return new AIProviderError({
    provider: 'gemini',
    category,
    retryable: options.retryable ?? true,
    fallbackEligible: options.fallbackEligible ?? true,
    status: options.status,
    cause: new Error('sensitive provider payload'),
  });
}

function createFixture(options: FixtureOptions = {}) {
  const geminiResults = options.geminiResults ?? [VALID_RESULT];
  const analyzeWithGemini = vi.fn();

  for (const result of geminiResults) {
    if (result instanceof Error) {
      analyzeWithGemini.mockRejectedValueOnce(result);
    } else {
      analyzeWithGemini.mockResolvedValueOnce(result);
    }
  }

  const analyzeWithOpenAI = vi.fn();
  const openAIResult = options.openAIResult ?? VALID_RESULT;

  if (openAIResult instanceof Error) {
    analyzeWithOpenAI.mockRejectedValue(openAIResult);
  } else {
    analyzeWithOpenAI.mockResolvedValue(openAIResult);
  }

  const sleep = vi.fn().mockResolvedValue(undefined);
  const service = new ResilientImageAnalysisService(
    new ConfigService({
      AI_FALLBACK_PROVIDER: options.fallback ?? 'openai',
      GEMINI_MODEL: 'gemini-test-model',
      OPENAI_MODEL: 'openai-test-model',
    }),
    { analyzeTattooImage: analyzeWithGemini } as unknown as GeminiImageAnalysisService,
    { analyzeTattooImage: analyzeWithOpenAI } as unknown as OpenAIImageAnalysisService,
    sleep,
    () => 0,
  );

  return { service, analyzeWithGemini, analyzeWithOpenAI, sleep };
}

describe('ResilientImageAnalysisService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it('uses Gemini as the fixed primary provider', async () => {
    const fixture = createFixture();

    await expect(fixture.service.analyzeTattooImage(IMAGE)).resolves.toEqual(VALID_RESULT);
    expect(fixture.analyzeWithGemini).toHaveBeenCalledOnce();
    expect(fixture.analyzeWithOpenAI).not.toHaveBeenCalled();
  });

  it('retries Gemini once with bounded backoff and jitter after a technical failure', async () => {
    const fixture = createFixture({
      geminiResults: [createProviderError('SERVER_ERROR', { status: 503 }), VALID_RESULT],
    });

    await expect(fixture.service.analyzeTattooImage(IMAGE)).resolves.toEqual(VALID_RESULT);
    expect(fixture.analyzeWithGemini).toHaveBeenCalledTimes(2);
    expect(fixture.sleep).toHaveBeenCalledOnce();
    expect(fixture.sleep).toHaveBeenCalledWith(250);
    expect(fixture.analyzeWithOpenAI).not.toHaveBeenCalled();
  });

  it('uses OpenAI once only after both Gemini attempts fail technically', async () => {
    const fixture = createFixture({
      geminiResults: [
        createProviderError('SERVER_ERROR', { status: 503 }),
        createProviderError('SERVER_ERROR', { status: 503 }),
      ],
    });

    await expect(fixture.service.analyzeTattooImage(IMAGE)).resolves.toEqual(VALID_RESULT);
    expect(fixture.analyzeWithGemini).toHaveBeenCalledTimes(2);
    expect(fixture.analyzeWithOpenAI).toHaveBeenCalledOnce();
  });

  it('never uses OpenAI when fallback is disabled', async () => {
    const terminalError = createProviderError('SERVER_ERROR');
    const fixture = createFixture({
      fallback: 'none',
      geminiResults: [createProviderError('SERVER_ERROR'), terminalError],
    });

    await expect(fixture.service.analyzeTattooImage(IMAGE)).rejects.toBe(terminalError);
    expect(fixture.analyzeWithOpenAI).not.toHaveBeenCalled();
  });

  it('does not call fallback for a valid low-confidence size mismatch observation', async () => {
    const validReviewCandidate: ImageAnalysisResult = {
      ...VALID_RESULT,
      detectedSize: TattooSize.LARGE,
      detectedDetail: DetailLevel.LIGHT,
      sizeConfidence: 0.2,
      detailConfidence: 0.3,
    };
    const fixture = createFixture({ geminiResults: [validReviewCandidate] });

    await expect(fixture.service.analyzeTattooImage(IMAGE)).resolves.toEqual(validReviewCandidate);
    expect(fixture.analyzeWithOpenAI).not.toHaveBeenCalled();
  });

  it('does not call fallback for a valid detail mismatch observation', async () => {
    const validReviewCandidate: ImageAnalysisResult = {
      ...VALID_RESULT,
      detectedDetail: DetailLevel.LIGHT,
      detailConfidence: 0.7,
    };
    const fixture = createFixture({ geminiResults: [validReviewCandidate] });

    await expect(fixture.service.analyzeTattooImage(IMAGE)).resolves.toEqual(validReviewCandidate);
    expect(fixture.analyzeWithOpenAI).not.toHaveBeenCalled();
  });

  it('does not retry or fall back after an explicit safety rejection', async () => {
    const safetyError = createProviderError('SAFETY_REJECTION', {
      retryable: false,
      fallbackEligible: false,
    });
    const fixture = createFixture({ geminiResults: [safetyError] });

    await expect(fixture.service.analyzeTattooImage(IMAGE)).rejects.toBe(safetyError);
    expect(fixture.analyzeWithGemini).toHaveBeenCalledOnce();
    expect(fixture.analyzeWithOpenAI).not.toHaveBeenCalled();
  });

  it('fails to the workflow when Gemini and OpenAI both fail', async () => {
    const openAIError = new AIProviderError({
      provider: 'openai',
      category: 'TIMEOUT',
      retryable: false,
      fallbackEligible: false,
    });
    const fixture = createFixture({
      geminiResults: [createProviderError('NETWORK_ERROR'), createProviderError('SERVER_ERROR')],
      openAIResult: openAIError,
    });

    await expect(fixture.service.analyzeTattooImage(IMAGE)).rejects.toBe(openAIError);
    expect(fixture.analyzeWithOpenAI).toHaveBeenCalledOnce();
  });

  it('emits provider and fallback events without logging credentials, images, prompts or causes', async () => {
    process.env.GEMINI_API_KEY = 'gemini-secret-value';
    process.env.OPENAI_API_KEY = 'openai-secret-value';
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const fixture = createFixture({
      geminiResults: [createProviderError('SERVER_ERROR'), createProviderError('SERVER_ERROR')],
    });

    await fixture.service.analyzeTattooImage(IMAGE, { leadId: 'lead-test-id' });

    const messages = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(messages).toContain('ai.provider.started');
    expect(messages).toContain('ai.provider.error');
    expect(messages).toContain('ai.fallback.started');
    expect(messages).toContain('ai.fallback.completed');
    expect(messages).not.toContain('gemini-secret-value');
    expect(messages).not.toContain('openai-secret-value');
    expect(messages).not.toContain(Buffer.from(IMAGE.content).toString('base64'));
    expect(messages).not.toContain('sensitive provider payload');
    expect(messages).not.toContain('Analiza exclusivamente');
  });
});
