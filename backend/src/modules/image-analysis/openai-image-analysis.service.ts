import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { validateLeadImageFile } from '../storage/lead-image-file.js';
import { AIProviderError, type AIProviderErrorCategory } from './ai-provider.error.js';
import type { ImageAnalysisResult, TattooImageInput } from './domain/image-analysis.types.js';
import { IMAGE_ANALYSIS_PROMPT } from './image-analysis.prompt.js';
import {
  InvalidImageAnalysisResponseError,
  parseImageAnalysisResponse,
} from './image-analysis-response.js';
import { IMAGE_ANALYSIS_RESPONSE_SCHEMA } from './image-analysis.schema.js';
import { ImageAnalysisService } from './image-analysis.service.js';

export const OPENAI_TIMEOUT_MS = 20_000;
export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

@Injectable()
export class OpenAIImageAnalysisService extends ImageAnalysisService {
  readonly providerName = 'openai';

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI | null,
  ) {
    super();
  }

  async analyzeTattooImage(image: TattooImageInput): Promise<ImageAnalysisResult> {
    let contentType: 'image/jpeg' | 'image/png' | 'image/webp';

    try {
      contentType = validateLeadImageFile(image).contentType;
    } catch (error: unknown) {
      throw new AIProviderError({
        provider: this.providerName,
        category: 'IMAGE_UNAVAILABLE',
        retryable: false,
        fallbackEligible: false,
        cause: error,
      });
    }

    if (!this.client) {
      throw new AIProviderError({
        provider: this.providerName,
        category: 'AUTHENTICATION',
        retryable: false,
        fallbackEligible: false,
      });
    }

    try {
      const response = await this.client.responses.create(
        {
          model: this.configService.getOrThrow<string>('OPENAI_MODEL'),
          store: false,
          max_output_tokens: 512,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: IMAGE_ANALYSIS_PROMPT },
                {
                  type: 'input_image',
                  detail: 'high',
                  image_url: `data:${contentType};base64,${Buffer.from(image.content).toString('base64')}`,
                },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'tattoo_image_analysis',
              description: 'Observaciones visuales normalizadas de una referencia de tatuaje.',
              strict: true,
              schema: IMAGE_ANALYSIS_RESPONSE_SCHEMA,
            },
          },
        },
        {
          timeout: OPENAI_TIMEOUT_MS,
          maxRetries: 0,
        },
      );

      if (this.hasSafetyRejection(response)) {
        throw new AIProviderError({
          provider: this.providerName,
          category: 'SAFETY_REJECTION',
          retryable: false,
          fallbackEligible: false,
        });
      }

      if (response.error) {
        const safetyError =
          response.error.code === 'image_content_policy_violation' ||
          response.error.code === 'bio_policy' ||
          response.error.code === 'misalignment_policy_violation';

        throw new AIProviderError({
          provider: this.providerName,
          category: safetyError ? 'SAFETY_REJECTION' : 'SERVER_ERROR',
          retryable: false,
          fallbackEligible: false,
          code: response.error.code,
        });
      }

      return parseImageAnalysisResponse(response.output_text);
    } catch (error: unknown) {
      if (error instanceof AIProviderError) {
        throw error;
      }

      if (error instanceof InvalidImageAnalysisResponseError) {
        throw new AIProviderError({
          provider: this.providerName,
          category: 'INVALID_RESPONSE',
          retryable: false,
          fallbackEligible: false,
          cause: error,
        });
      }

      throw this.toProviderError(error);
    }
  }

  private hasSafetyRejection(response: {
    output: Array<{ type: string; content?: Array<{ type: string }> }>;
  }): boolean {
    return response.output.some(
      (item) =>
        item.type === 'message' && item.content?.some((content) => content.type === 'refusal'),
    );
  }

  private toProviderError(error: unknown): AIProviderError {
    const status = this.readStatus(error);
    const code = this.readCode(error);
    const name = error instanceof Error ? error.name : '';

    if (error instanceof OpenAI.APIConnectionTimeoutError || name === 'AbortError') {
      return this.createError('TIMEOUT', error, status, code);
    }

    if (error instanceof OpenAI.APIConnectionError) {
      return this.createError('NETWORK_ERROR', error, status, code);
    }

    if (status === 429) {
      return this.createError('RATE_LIMIT', error, status, code);
    }

    if (typeof status === 'number' && status >= 500) {
      return this.createError('SERVER_ERROR', error, status, code);
    }

    if (status === 400) {
      return this.createError('BAD_REQUEST', error, status, code);
    }

    if (status === 401) {
      return this.createError('AUTHENTICATION', error, status, code);
    }

    if (status === 403) {
      return this.createError('PERMISSION_DENIED', error, status, code);
    }

    if (status === 404) {
      return this.createError('NOT_FOUND', error, status, code);
    }

    return this.createError('UNKNOWN', error, status, code);
  }

  private createError(
    category: AIProviderErrorCategory,
    cause: unknown,
    status?: number,
    code?: string | number,
  ): AIProviderError {
    return new AIProviderError({
      provider: this.providerName,
      category,
      retryable: false,
      fallbackEligible: false,
      status,
      code,
      cause,
    });
  }

  private readStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const status: unknown = Reflect.get(error, 'status');
    return typeof status === 'number' ? status : undefined;
  }

  private readCode(error: unknown): string | number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const code: unknown = Reflect.get(error, 'code');
    return typeof code === 'string' || typeof code === 'number' ? code : undefined;
  }
}
