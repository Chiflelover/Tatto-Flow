import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError } from '@google/genai';
import { DetailLevel, TattooSize } from '../../generated/prisma/client.js';
import { ImageAmbiguityLevel, type TattooImageInput } from './domain/image-analysis.types.js';
import {
  type GeminiClient,
  GeminiImageAnalysisError,
  GeminiImageAnalysisService,
} from './gemini-image-analysis.service.js';

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

function createFixture(response: object | string | Error = VALID_RESPONSE) {
  const generateContent = vi.fn<GeminiClient['models']['generateContent']>();

  if (response instanceof Error) {
    generateContent.mockRejectedValue(response);
  } else {
    generateContent.mockResolvedValue({
      text: typeof response === 'string' ? response : JSON.stringify(response),
    });
  }
  const client = { models: { generateContent } } as unknown as GeminiClient;
  const service = new GeminiImageAnalysisService(
    new ConfigService({ GEMINI_MODEL: 'gemini-test-model' }),
    client,
  );

  return { service, generateContent };
}

async function expectErrorCode(
  service: GeminiImageAnalysisService,
  code: GeminiImageAnalysisError['code'],
): Promise<void> {
  await expect(service.analyzeTattooImage(VALID_PNG)).rejects.toMatchObject({ code });
}

function createApiError(status: number, code: string, message = 'Safe provider detail'): ApiError {
  return new ApiError({
    status,
    message: JSON.stringify({ error: { code: status, status: code, message } }),
  });
}

function providerErrorLogs(errorLog: {
  mock: { calls: readonly (readonly unknown[])[] };
}): Record<string, unknown>[] {
  return errorLog.mock.calls
    .flat()
    .filter(
      (message): message is string =>
        typeof message === 'string' && message.includes('"event":"ai.provider.error"'),
    )
    .map((message) => JSON.parse(message) as Record<string, unknown>);
}

describe('GeminiImageAnalysisService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a valid structured response without making business decisions', async () => {
    const { service } = createFixture();

    await expect(service.analyzeTattooImage(VALID_PNG)).resolves.toEqual(VALID_RESPONSE);
  });

  it('sends the private image inline with JSON schema, timeout and one retry maximum', async () => {
    const { service, generateContent } = createFixture();

    await service.analyzeTattooImage(VALID_PNG);

    expect(generateContent).toHaveBeenCalledOnce();
    const request = generateContent.mock.calls[0]?.[0];
    const serialized = JSON.stringify(request);

    expect(request?.model).toBe('gemini-test-model');
    expect(request?.config?.responseMimeType).toBe('application/json');
    expect(request?.config?.responseJsonSchema).toMatchObject({ additionalProperties: false });
    expect(request?.config?.httpOptions).toMatchObject({
      timeout: 20_000,
      retryOptions: { attempts: 1 },
    });

    expect(serialized).toContain(Buffer.from(VALID_PNG.content).toString('base64'));
    expect(serialized).not.toContain('http://');
    expect(serialized).not.toContain('https://');
    expect(serialized).not.toContain('price');
    expect(serialized).not.toContain('readinessScore');
  });

  it.each([
    ['detectedSize', 'EXTRA_LARGE'],
    ['detectedDetail', 'EXTREME'],
    ['ambiguityLevel', 'UNKNOWN'],
  ])('rejects an invalid enum in %s', async (field, value) => {
    const fixture = createFixture({ ...VALID_RESPONSE, [field]: value });

    await expectErrorCode(fixture.service, 'INVALID_RESPONSE');
  });

  it.each([
    'sizeConfidence',
    'detailConfidence',
    'tattooOnSkinConfidence',
    'analyzabilityConfidence',
  ])('rejects %s outside the 0..1 range', async (field) => {
    const below = createFixture({ ...VALID_RESPONSE, [field]: -0.01 });
    const above = createFixture({ ...VALID_RESPONSE, [field]: 1.01 });

    await expectErrorCode(below.service, 'INVALID_RESPONSE');
    await expectErrorCode(above.service, 'INVALID_RESPONSE');
  });

  it('rejects malformed JSON and unexpected fields', async () => {
    await expectErrorCode(createFixture('{').service, 'INVALID_RESPONSE');
    await expectErrorCode(
      createFixture({ ...VALID_RESPONSE, readinessScore: 100 }).service,
      'INVALID_RESPONSE',
    );
  });

  it('maps timeouts to a controlled error', async () => {
    const error = new Error('request stopped');
    error.name = 'AbortError';
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expectErrorCode(createFixture(error).service, 'TIMEOUT');

    expect(providerErrorLogs(errorLog)).toEqual([
      expect.objectContaining({
        event: 'ai.provider.error',
        provider: 'gemini',
        status: null,
        code: 'TIMEOUT',
        errorName: 'AbortError',
        retryable: true,
        attempt: 1,
      }),
      expect.objectContaining({
        event: 'ai.provider.error',
        code: 'TIMEOUT',
        attempt: 2,
      }),
    ]);
  });

  it('maps rate limits to a controlled error', async () => {
    const error = Object.assign(new Error('quota unavailable'), { status: 429 });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expectErrorCode(createFixture(error).service, 'RATE_LIMITED');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"ai.analysis.retry"'));
  });

  it('retries a transient error only once and succeeds safely', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const fixture = createFixture();
    fixture.generateContent
      .mockRejectedValueOnce(Object.assign(new Error('temporary quota'), { status: 429 }))
      .mockResolvedValueOnce({ text: JSON.stringify(VALID_RESPONSE) });

    await expect(
      fixture.service.analyzeTattooImage(VALID_PNG, { leadId: 'lead-1' }),
    ).resolves.toEqual(VALID_RESPONSE);

    expect(fixture.generateContent).toHaveBeenCalledTimes(2);
    const retryLog = warn.mock.calls.flat().join(' ');
    expect(retryLog).toContain('ai.analysis.retry');
    expect(retryLog).toContain('lead-1');
    expect(retryLog).not.toContain('temporary quota');
  });

  it('maps other API failures without leaking the upstream payload', async () => {
    const error = Object.assign(new Error('upstream details'), { status: 500 });
    const promise = createFixture(error).service.analyzeTattooImage(VALID_PNG);

    await expect(promise).rejects.toEqual(new GeminiImageAnalysisError('API_ERROR'));
  });

  it.each([
    [400, 'INVALID_ARGUMENT', false, 1],
    [401, 'UNAUTHENTICATED', false, 1],
    [403, 'PERMISSION_DENIED', false, 1],
    [404, 'NOT_FOUND', false, 1],
    [429, 'RESOURCE_EXHAUSTED', true, 2],
    [500, 'INTERNAL', true, 2],
  ] as const)(
    'logs safe provider diagnostics for HTTP %s',
    async (status, code, retryable, attempts) => {
      const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const fixture = createFixture(createApiError(status, code));

      await expect(fixture.service.analyzeTattooImage(VALID_PNG)).rejects.toBeInstanceOf(
        GeminiImageAnalysisError,
      );

      const logs = providerErrorLogs(errorLog);
      expect(logs).toHaveLength(attempts);
      expect(logs.at(-1)).toMatchObject({
        event: 'ai.provider.error',
        provider: 'gemini',
        status,
        code,
        errorName: 'ApiError',
        retryable,
        attempt: attempts,
        message: 'Safe provider detail',
      });
    },
  );

  it('logs invalid structured responses without logging the response body', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expectErrorCode(createFixture('{').service, 'INVALID_RESPONSE');

    expect(providerErrorLogs(errorLog)).toEqual([
      expect.objectContaining({
        event: 'ai.provider.error',
        provider: 'gemini',
        status: null,
        code: 'INVALID_RESPONSE',
        errorName: 'GeminiImageAnalysisError',
        retryable: false,
        attempt: 1,
      }),
    ]);
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('"{"');
  });

  it('never logs API keys, image data, prompts, signed URLs, phones or full payloads', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const previousKey = process.env.GEMINI_API_KEY;
    const secret = 'AIzaProductionSecretThatMustNeverAppear123';
    process.env.GEMINI_API_KEY = secret;
    const unsafeMessage = [
      `key=${secret}`,
      'inlineData',
      'A'.repeat(200),
      'https://storage.example/signed?token=private',
      '51999888777',
      'Analiza exclusivamente la imagen de referencia de tatuaje',
    ].join(' ');

    try {
      await expectErrorCode(
        createFixture(createApiError(400, 'INVALID_ARGUMENT', unsafeMessage)).service,
        'API_ERROR',
      );
    } finally {
      if (previousKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousKey;
      }
    }

    const serializedLogs = errorLog.mock.calls.flat().join(' ');
    expect(serializedLogs).toContain('ai.provider.error');
    expect(serializedLogs).toContain('INVALID_ARGUMENT');
    expect(serializedLogs).not.toContain(secret);
    expect(serializedLogs).not.toContain('inlineData');
    expect(serializedLogs).not.toContain('A'.repeat(80));
    expect(serializedLogs).not.toContain('storage.example');
    expect(serializedLogs).not.toContain('51999888777');
    expect(serializedLogs).not.toContain('Analiza exclusivamente');
    expect(serializedLogs).not.toContain('"message"');
  });

  it('preserves negative visual findings and low confidence', async () => {
    const result = {
      ...VALID_RESPONSE,
      sizeConfidence: 0.42,
      detailConfidence: 0.38,
      tattooOnSkin: false,
      referenceAnalyzable: false,
      ambiguityLevel: ImageAmbiguityLevel.MAJOR,
    };

    await expect(createFixture(result).service.analyzeTattooImage(VALID_PNG)).resolves.toEqual(
      result,
    );
  });

  it('rejects an unavailable or unsupported image before calling Gemini', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.analyzeTattooImage({ content: new Uint8Array(), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'IMAGE_UNAVAILABLE' });
    expect(fixture.generateContent).not.toHaveBeenCalled();
  });
});
