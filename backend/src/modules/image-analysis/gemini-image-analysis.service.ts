import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, type GenerateContentParameters } from '@google/genai';
import { DetailLevel, TattooSize } from '../../generated/prisma/client.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { validateLeadImageFile } from '../storage/lead-image-file.js';
import {
  ImageAmbiguityLevel,
  type ImageAnalysisResult,
  type TattooImageInput,
} from './domain/image-analysis.types.js';
import { GEMINI_ANALYSIS_PROMPT } from './gemini-analysis.prompt.js';
import { GEMINI_ANALYSIS_RESPONSE_SCHEMA } from './gemini-analysis.schema.js';
import { ImageAnalysisService, type ImageAnalysisContext } from './image-analysis.service.js';

const GEMINI_TIMEOUT_MS = 20_000;
const GEMINI_RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
const RESPONSE_KEYS = Object.freeze([
  'detectedSize',
  'sizeConfidence',
  'detectedDetail',
  'detailConfidence',
  'tattooOnSkin',
  'tattooOnSkinConfidence',
  'referenceAnalyzable',
  'analyzabilityConfidence',
  'ambiguityLevel',
]);

export const GEMINI_CLIENT = Symbol('GEMINI_CLIENT');

export interface GeminiClient {
  models: {
    generateContent(parameters: GenerateContentParameters): Promise<{ readonly text?: string }>;
  };
}

export type GeminiAnalysisErrorCode =
  'TIMEOUT' | 'RATE_LIMITED' | 'INVALID_RESPONSE' | 'API_ERROR' | 'IMAGE_UNAVAILABLE';

export class GeminiImageAnalysisError extends Error {
  constructor(readonly code: GeminiAnalysisErrorCode) {
    super(`Gemini image analysis failed (${code}).`);
    this.name = GeminiImageAnalysisError.name;
  }
}

@Injectable()
export class GeminiImageAnalysisService extends ImageAnalysisService {
  readonly providerName = 'gemini';
  private readonly logger = new SafeStructuredLogger(GeminiImageAnalysisService.name);

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(GEMINI_CLIENT) private readonly client: GeminiClient | null,
  ) {
    super();
  }

  async analyzeTattooImage(
    image: TattooImageInput,
    context: ImageAnalysisContext = {},
  ): Promise<ImageAnalysisResult> {
    let contentType: 'image/jpeg' | 'image/png' | 'image/webp';

    try {
      contentType = validateLeadImageFile(image).contentType;
    } catch {
      throw new GeminiImageAnalysisError('IMAGE_UNAVAILABLE');
    }

    if (!this.client) {
      throw new GeminiImageAnalysisError('API_ERROR');
    }

    const parameters: GenerateContentParameters = {
      model: this.configService.getOrThrow<string>('GEMINI_MODEL'),
      contents: [
        {
          role: 'user',
          parts: [
            { text: GEMINI_ANALYSIS_PROMPT },
            {
              inlineData: {
                mimeType: contentType,
                data: Buffer.from(image.content).toString('base64'),
              },
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        responseJsonSchema: GEMINI_ANALYSIS_RESPONSE_SCHEMA,
        httpOptions: {
          timeout: GEMINI_TIMEOUT_MS,
          retryOptions: {
            attempts: 1,
            initialDelay: 0.5,
            maxDelay: 1,
            httpStatusCodes: GEMINI_RETRYABLE_STATUS_CODES,
          },
        },
      },
    };
    let response: { readonly text?: string } | undefined;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        response = await this.client.models.generateContent(parameters);
        break;
      } catch (error: unknown) {
        if (attempt === 1 && this.isRetryable(error)) {
          this.logger.warn('ai.analysis.retry', {
            provider: this.providerName,
            leadId: context.leadId ?? null,
            attempt: 2,
            reason: this.toControlledError(error).code,
          });
          continue;
        }

        throw this.toControlledError(error);
      }
    }

    return this.parseResponse(response?.text);
  }

  private parseResponse(text: string | undefined): ImageAnalysisResult {
    let value: unknown;

    try {
      value = text ? JSON.parse(text) : null;
    } catch {
      throw new GeminiImageAnalysisError('INVALID_RESPONSE');
    }

    if (!this.isValidResponse(value)) {
      throw new GeminiImageAnalysisError('INVALID_RESPONSE');
    }

    return value;
  }

  private isValidResponse(value: unknown): value is ImageAnalysisResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate);

    return (
      keys.length === RESPONSE_KEYS.length &&
      keys.every((key) => RESPONSE_KEYS.includes(key)) &&
      Object.values(TattooSize).includes(candidate.detectedSize as TattooSize) &&
      this.isConfidence(candidate.sizeConfidence) &&
      Object.values(DetailLevel).includes(candidate.detectedDetail as DetailLevel) &&
      this.isConfidence(candidate.detailConfidence) &&
      typeof candidate.tattooOnSkin === 'boolean' &&
      this.isConfidence(candidate.tattooOnSkinConfidence) &&
      typeof candidate.referenceAnalyzable === 'boolean' &&
      this.isConfidence(candidate.analyzabilityConfidence) &&
      Object.values(ImageAmbiguityLevel).includes(candidate.ambiguityLevel as ImageAmbiguityLevel)
    );
  }

  private isConfidence(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  }

  private toControlledError(error: unknown): GeminiImageAnalysisError {
    const status = error instanceof ApiError ? error.status : this.readStatus(error);
    const name = error instanceof Error ? error.name : '';

    if (status === 408 || name === 'AbortError' || name === 'TimeoutError') {
      return new GeminiImageAnalysisError('TIMEOUT');
    }

    if (status === 429) {
      return new GeminiImageAnalysisError('RATE_LIMITED');
    }

    return new GeminiImageAnalysisError('API_ERROR');
  }

  private readStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const status: unknown = Reflect.get(error, 'status');
    return typeof status === 'number' ? status : undefined;
  }

  private isRetryable(error: unknown): boolean {
    const status = error instanceof ApiError ? error.status : this.readStatus(error);
    const name = error instanceof Error ? error.name : '';

    return (
      (typeof status === 'number' && GEMINI_RETRYABLE_STATUS_CODES.includes(status)) ||
      name === 'AbortError' ||
      name === 'TimeoutError'
    );
  }
}
