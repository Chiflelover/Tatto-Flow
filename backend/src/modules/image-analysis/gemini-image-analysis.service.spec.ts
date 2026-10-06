import { VISION_RESPONSE, VISION_STYLES, visionResult } from '../../../test/fixtures/vision-v2.js';
import { ConfigService } from '@nestjs/config';

import { AIProviderError } from './ai-provider.error.js';
import { type TattooImageInput } from './domain/image-analysis.types.js';
import { type GeminiClient, GeminiImageAnalysisService } from './gemini-image-analysis.service.js';

const VALID_PNG: TattooImageInput = {
  content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  mimeType: 'image/png',
  fileName: 'reference.png',
};

type GeminiResponse = Awaited<ReturnType<GeminiClient['models']['generateContent']>>;

function createFixture(
  response: GeminiResponse | Error = { text: JSON.stringify(VISION_RESPONSE) },
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
    await expect(
      createFixture().service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES),
    ).resolves.toMatchObject({ observations: visionResult().observations });
  });

  it('sends the image inline with the shared strict schema, provider timeout and SDK retry disabled', async () => {
    const { service, generateContent } = createFixture();

    await service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES);

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
    ['style', 'UNKNOWN_STYLE'],
    ['scale_reference_type', 'UNKNOWN'],
    ['estimated_density', 101],
    ['style_confidence', 1.4],
    ['color_confidence', -0.1],
  ])('rejects an invalid structured value in %s', async (field, value) => {
    const { service } = createFixture({
      text: JSON.stringify({ ...VISION_RESPONSE, [field]: value }),
    });

    await expect(service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES)).rejects.toMatchObject({
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
      JSON.stringify({ ...VISION_RESPONSE, style_confidence: undefined }),
      JSON.stringify({ ...VISION_RESPONSE, unexpected: true }),
    ];

    for (const text of responses) {
      await expect(
        createFixture({ text }).service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES),
      ).rejects.toBeInstanceOf(AIProviderError);
    }
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

    await expect(service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES)).rejects.toMatchObject({
      category,
      status,
      retryable,
      fallbackEligible,
    });
  });

  it('classifies a network failure as retryable and fallback eligible', async () => {
    const networkError = Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' });

    await expect(
      createFixture(networkError).service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES),
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

    await expect(service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES)).rejects.toMatchObject({
      category: 'SAFETY_REJECTION',
      retryable: false,
      fallbackEligible: false,
    });
  });

  it('rejects an invalid image before calling Gemini', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.analyzeTattooImageV2(
        { content: new Uint8Array(), mimeType: 'image/png' },
        VISION_STYLES,
      ),
    ).rejects.toMatchObject({ category: 'IMAGE_UNAVAILABLE' });
    expect(fixture.generateContent).not.toHaveBeenCalled();
  });
});
