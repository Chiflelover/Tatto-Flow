import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  VISION_RESPONSE,
  VISION_STYLES,
  VISION_IMAGE,
  visionResult,
} from '../../../test/fixtures/vision-v2.js';
import { AIProviderError } from './ai-provider.error.js';
import { GeminiImageAnalysisService } from './gemini-image-analysis.service.js';
import { OpenAIImageAnalysisService } from './openai-image-analysis.service.js';
import { ResilientImageAnalysisService } from './resilient-image-analysis.service.js';

function providers(response = VISION_RESPONSE) {
  const geminiRaw = {
    text: JSON.stringify(response),
    candidates: [],
    modelVersion: 'gemini-server-version',
  };
  const openaiRaw = {
    output_text: JSON.stringify(response),
    output: [],
    error: null,
    id: 'openai-request-id',
    model: 'openai-server-version',
  };
  const generateContent = vi.fn().mockResolvedValue(geminiRaw);
  const create = vi.fn().mockResolvedValue(openaiRaw);
  const gemini = new GeminiImageAnalysisService(
    new ConfigService({ GEMINI_MODEL: 'gemini-test-model' }),
    { models: { generateContent } },
  );
  const openai = new OpenAIImageAnalysisService(
    new ConfigService({ OPENAI_MODEL: 'openai-test-model' }),
    { responses: { create } } as unknown as OpenAI,
  );
  return { gemini, openai, generateContent, create, geminiRaw, openaiRaw };
}

describe('AI Vision V2 providers', () => {
  it('uses the same V2 observations and preserves each provider raw response and versions', async () => {
    const f = providers();
    const gemini = await f.gemini.analyzeTattooImageV2(VISION_IMAGE, VISION_STYLES);
    const openai = await f.openai.analyzeTattooImageV2(VISION_IMAGE, VISION_STYLES);
    expect(gemini.observations).toEqual(visionResult().observations);
    expect(openai.observations).toEqual(gemini.observations);
    expect(gemini).toMatchObject({
      provider: 'gemini',
      model: 'gemini-server-version',
      promptVersion: 2,
      schemaVersion: 'VISION_V2_2',
      rawResponse: { response: f.geminiRaw, outputText: f.geminiRaw.text },
    });
    expect(openai).toMatchObject({
      provider: 'openai',
      model: 'openai-server-version',
      promptVersion: 2,
      schemaVersion: 'VISION_V2_2',
      rawResponse: { response: f.openaiRaw, outputText: f.openaiRaw.output_text },
    });
    const g = f.generateContent.mock.calls[0]?.[0] as Record<string, unknown>;
    const o = f.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(g.config).toMatchObject({
      responseJsonSchema: { additionalProperties: false, required: Object.keys(VISION_RESPONSE) },
    });
    expect(o.text).toMatchObject({ format: { name: 'tattoo_image_analysis_v2', strict: true } });
    expect(JSON.stringify(o)).not.toContain('detectedDetail');
    expect(JSON.stringify(g)).not.toContain('detectedSize');
  });

  it('discards provider measurements with NONE while preserving the unmodified raw response', async () => {
    const f = providers({ ...VISION_RESPONSE, scale_reference_type: 'NONE', scale_confidence: 0 });
    for (const provider of [f.gemini, f.openai]) {
      const result = await provider.analyzeTattooImageV2(VISION_IMAGE, VISION_STYLES);
      expect(result.observations).toMatchObject({
        scaleReferenceType: 'NONE',
        scaleConfidence: 0,
        referenceMainDimensionCm: null,
        referenceAreaCm2: null,
      });
      expect(result.rawResponse).toMatchObject({
        outputText: JSON.stringify({
          ...VISION_RESPONSE,
          scale_reference_type: 'NONE',
          scale_confidence: 0,
        }),
      });
    }
  });

  it('rejects unknown styles from both real providers instead of silently inventing a catalog code', async () => {
    const f = providers({ ...VISION_RESPONSE, style: 'INVENTED' });
    await expect(f.gemini.analyzeTattooImageV2(VISION_IMAGE, VISION_STYLES)).rejects.toMatchObject({
      category: 'INVALID_RESPONSE',
      fallbackEligible: true,
    });
    await expect(f.openai.analyzeTattooImageV2(VISION_IMAGE, VISION_STYLES)).rejects.toMatchObject({
      category: 'INVALID_RESPONSE',
    });
  });

  it('retries and falls back with V2 throughout and preserves the actual successful provider identity', async () => {
    const error = new AIProviderError({
      provider: 'gemini',
      category: 'TIMEOUT',
      retryable: true,
      fallbackEligible: true,
    });
    const primary = vi.fn().mockRejectedValue(error);
    const fallback = vi.fn().mockResolvedValue(visionResult('openai'));
    const v1 = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const service = new ResilientImageAnalysisService(
      new ConfigService({
        AI_FALLBACK_PROVIDER: 'openai',
        GEMINI_MODEL: 'gemini-test-model',
        OPENAI_MODEL: 'openai-test-model',
      }),
      {
        analyzeTattooImageV2: primary,
        analyzeTattooImage: v1,
      } as unknown as GeminiImageAnalysisService,
      {
        analyzeTattooImageV2: fallback,
        analyzeTattooImage: v1,
      } as unknown as OpenAIImageAnalysisService,
      sleep,
      () => 0,
    );
    await expect(
      service.analyzeTattooImageV2(VISION_IMAGE, VISION_STYLES, { leadId: 'lead-test' }),
    ).resolves.toEqual(visionResult('openai'));
    expect(primary).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledWith(VISION_IMAGE, VISION_STYLES);
    expect(sleep).toHaveBeenCalledOnce();
    expect(v1).not.toHaveBeenCalled();
  });
});
