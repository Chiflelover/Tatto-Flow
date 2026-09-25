import { ConfigService } from '@nestjs/config';
import { DetailLevel, TattooSize } from '../../generated/prisma/client.js';
import { AIProviderError } from './ai-provider.error.js';
import { ImageAmbiguityLevel, type TattooImageInput } from './domain/image-analysis.types.js';
import { type GeminiClient, GeminiImageAnalysisService } from './gemini-image-analysis.service.js';

const VALID_PNG: TattooImageInput = {
  content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  mimeType: 'image/png',
  fileName: 'reference.png',
};

const VALID_RESPONSE = {
  detectedSize: TattooSize.MEDIUM,
  sizeConfidence: 0.91,
  detectedDetail: DetailLevel.DETAILED,
  detailConfidence: 0.92,
  tattooOnSkin: true,
  tattooOnSkinConfidence: 0.98,
  referenceAnalyzable: true,
  analyzabilityConfidence: 0.97,
  ambiguityLevel: ImageAmbiguityLevel.NONE,
};

type GeminiResponse = Awaited<ReturnType<GeminiClient['models']['generateContent']>>;

function createFixture(
  response: GeminiResponse | Error = { text: JSON.stringify(VALID_RESPONSE) },
) {
  const generateContent = vi.fn<GeminiClient['models']['generateContent']>();

  if (response instanceof Error) {
    generateContent.mockRejectedValue(response);
  } else {
    generateContent.mockResolvedValue(response);
  }

  const service = new GeminiImageAnalysisService(
    new ConfigService({ GEMINI_MODEL: 'gemini-test-model' }),
    { models: { generateContent } },
  );

  return { service, generateContent };
}

function providerError(status: number, code = 'PROVIDER_ERROR'): Error {
  return Object.assign(new Error('provider failure'), { status, code });
}

describe('GeminiImageAnalysisService', () => {
  it('returns the shared normalized contract without making business decisions', async () => {
    await expect(createFixture().service.analyzeTattooImage(VALID_PNG)).resolves.toEqual(
      VALID_RESPONSE,
    );
  });

  it('sends the image inline with the shared strict schema, provider timeout and SDK retry disabled', async () => {
    const { service, generateContent } = createFixture();

    await service.analyzeTattooImage(VALID_PNG);

    expect(generateContent).toHaveBeenCalledOnce();
    const request = generateContent.mock.calls[0]?.[0];
    const serialized = JSON.stringify(request);

    expect(request?.model).toBe('gemini-test-model');
    expect(request?.config?.responseMimeType).toBe('application/json');
    expect(request?.config?.responseJsonSchema).toMatchObject({
      additionalProperties: false,
    });
    expect(request?.config?.httpOptions).toEqual({
      timeout: 20_000,
      retryOptions: { attempts: 1 },
    });
    expect(serialized).toContain(Buffer.from(VALID_PNG.content).toString('base64'));
    expect(serialized).not.toContain('readinessScore');
    expect(serialized).not.toContain('calculatedMinPrice');
  });

  it.each([
    ['detectedSize', 'EXTRA_LARGE'],
    ['detectedDetail', 'EXTREME'],
    ['ambiguityLevel', 'UNKNOWN'],
    ['sizeConfidence', 1.4],
    ['detailConfidence', -0.1],
  ])('rejects an invalid structured value in %s', async (field, value) => {
    const { service } = createFixture({
      text: JSON.stringify({ ...VALID_RESPONSE, [field]: value }),
    });

    await expect(service.analyzeTattooImage(VALID_PNG)).rejects.toMatchObject({
      provider: 'gemini',
      category: 'INVALID_RESPONSE',
      retryable: true,
      fallbackEligible: true,
    });
  });

  it('rejects missing, malformed and additional response fields', async () => {
    const responses = [
      undefined,
      '{bad json',
      JSON.stringify({ ...VALID_RESPONSE, detectedSize: undefined }),
      JSON.stringify({ ...VALID_RESPONSE, unexpected: true }),
    ];

    for (const text of responses) {
      await expect(
        createFixture({ text }).service.analyzeTattooImage(VALID_PNG),
      ).rejects.toBeInstanceOf(AIProviderError);
    }
  });

  it('accepts valid low-confidence observations instead of treating them as provider errors', async () => {
    const result = {
      ...VALID_RESPONSE,
      sizeConfidence: 0.3,
      detailConfidence: 0.4,
      tattooOnSkin: false,
      referenceAnalyzable: false,
      ambiguityLevel: ImageAmbiguityLevel.MAJOR,
    };

    await expect(
      createFixture({ text: JSON.stringify(result) }).service.analyzeTattooImage(VALID_PNG),
    ).resolves.toEqual(result);
  });

  it.each([
    [408, 'TIMEOUT', true, true],
    [429, 'RATE_LIMIT', true, true],
    [500, 'SERVER_ERROR', true, true],
    [401, 'AUTHENTICATION', false, false],
    [403, 'PERMISSION_DENIED', false, false],
    [404, 'NOT_FOUND', false, false],
    [400, 'BAD_REQUEST', false, false],
  ])('classifies HTTP %i as %s', async (status, category, retryable, fallbackEligible) => {
    const { service } = createFixture(providerError(status));

    await expect(service.analyzeTattooImage(VALID_PNG)).rejects.toMatchObject({
      category,
      status,
      retryable,
      fallbackEligible,
    });
  });

  it('classifies a network failure as retryable and fallback eligible', async () => {
    const networkError = Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' });

    await expect(
      createFixture(networkError).service.analyzeTattooImage(VALID_PNG),
    ).rejects.toMatchObject({
      category: 'NETWORK_ERROR',
      retryable: true,
      fallbackEligible: true,
    });
  });

  it('never retries or falls back after an explicit Gemini safety rejection', async () => {
    const { service } = createFixture({
      candidates: [{ finishReason: 'SAFETY' }],
    });

    await expect(service.analyzeTattooImage(VALID_PNG)).rejects.toMatchObject({
      category: 'SAFETY_REJECTION',
      retryable: false,
      fallbackEligible: false,
    });
  });

  it('rejects an invalid image before calling Gemini', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.analyzeTattooImage({ content: new Uint8Array(), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ category: 'IMAGE_UNAVAILABLE' });
    expect(fixture.generateContent).not.toHaveBeenCalled();
  });
});
