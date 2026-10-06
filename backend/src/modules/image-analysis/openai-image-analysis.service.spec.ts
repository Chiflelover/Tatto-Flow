import { VISION_RESPONSE, VISION_STYLES, visionResult } from '../../../test/fixtures/vision-v2.js';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { type TattooImageInput } from './domain/image-analysis.types.js';
import { OpenAIImageAnalysisService } from './openai-image-analysis.service.js';

const VALID_PNG: TattooImageInput = {
  content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  mimeType: 'image/png',
};

function createFixture(response: Record<string, unknown> | Error = {}) {
  const create = vi.fn();

  if (response instanceof Error) {
    create.mockRejectedValue(response);
  } else {
    create.mockResolvedValue({
      output_text: JSON.stringify(VISION_RESPONSE),
      output: [],
      error: null,
      ...response,
    });
  }

  const client = { responses: { create } } as unknown as OpenAI;
  const service = new OpenAIImageAnalysisService(
    new ConfigService({ OPENAI_MODEL: 'gpt-test-vision' }),
    client,
  );

  return { service, create };
}

describe('OpenAIImageAnalysisService', () => {
  it('returns the exact shared normalized contract', async () => {
    await expect(
      createFixture().service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES),
    ).resolves.toMatchObject({ observations: visionResult().observations });
  });

  it('uses Responses API with image input, strict Structured Outputs and no SDK retry', async () => {
    const { service, create } = createFixture();

    await service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES);

    expect(create).toHaveBeenCalledOnce();
    const [request, options] = create.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    const serialized = JSON.stringify(request);

    expect(request).toMatchObject({
      model: 'gpt-test-vision',
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'tattoo_image_analysis_v2',
          strict: true,
          schema: { additionalProperties: false },
        },
      },
    });
    expect(options).toEqual({ timeout: 20_000, maxRetries: 0 });
    expect(serialized).toContain('data:image/png;base64,');
    expect(serialized).not.toContain('readinessScore');
    expect(serialized).not.toContain('calculatedMaxPrice');
  });

  it.each([
    ['unknown_field', 'unexpected'],
    ['style', 'UNKNOWN_STYLE'],
    ['estimated_density', 101],
    ['style_confidence', 1.4],
    ['analyzabilityConfidence', -0.1],
  ])('defensively rejects an invalid %s despite strict output mode', async (field, value) => {
    const { service } = createFixture({
      output_text: JSON.stringify({ ...VISION_RESPONSE, [field]: value }),
    });

    await expect(service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES)).rejects.toMatchObject({
      provider: 'openai',
      category: 'INVALID_RESPONSE',
      retryable: false,
    });
  });

  it('classifies an explicit refusal as a safety rejection', async () => {
    const { service } = createFixture({
      output_text: '',
      output: [
        {
          type: 'message',
          content: [{ type: 'refusal', refusal: 'Cannot process this image.' }],
        },
      ],
    });

    await expect(service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES)).rejects.toMatchObject({
      category: 'SAFETY_REJECTION',
      fallbackEligible: false,
    });
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'AUTHENTICATION'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMIT'],
    [500, 'SERVER_ERROR'],
  ])('classifies HTTP %i as %s', async (status, category) => {
    const error = Object.assign(new Error('provider failure'), { status, code: 'provider_code' });

    await expect(
      createFixture(error).service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES),
    ).rejects.toMatchObject({
      status,
      category,
      retryable: false,
    });
  });

  it('classifies SDK timeout and network failures without retrying', async () => {
    await expect(
      createFixture(new OpenAI.APIConnectionTimeoutError()).service.analyzeTattooImageV2(
        VALID_PNG,
        VISION_STYLES,
      ),
    ).rejects.toMatchObject({ category: 'TIMEOUT', retryable: false });

    await expect(
      createFixture(
        new OpenAI.APIConnectionError({ message: 'network unavailable' }),
      ).service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES),
    ).rejects.toMatchObject({ category: 'NETWORK_ERROR', retryable: false });
  });

  it('fails closed if the fallback client was not configured', async () => {
    const service = new OpenAIImageAnalysisService(
      new ConfigService({ OPENAI_MODEL: 'gpt-test-vision' }),
      null,
    );

    await expect(service.analyzeTattooImageV2(VALID_PNG, VISION_STYLES)).rejects.toMatchObject({
      category: 'AUTHENTICATION',
    });
  });
});
