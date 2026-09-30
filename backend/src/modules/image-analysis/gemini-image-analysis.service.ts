import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, type GenerateContentParameters } from '@google/genai';
import { validateLeadImageFile } from '../storage/lead-image-file.js';
import { AIProviderError, type AIProviderErrorCategory } from './ai-provider.error.js';
import type { ImageAnalysisResult, TattooImageInput } from './domain/image-analysis.types.js';
import type { ImageAnalysisV2Result, VisionStyle } from './domain/image-analysis-v2.types.js';
import {
  createImageAnalysisV2Schema,
  IMAGE_ANALYSIS_V2_SCHEMA_VERSION,
  parseImageAnalysisV2Response,
  serializeProviderResponse,
} from './image-analysis-v2.contract.js';
import {
  createImageAnalysisV2Prompt,
  IMAGE_ANALYSIS_V2_PROMPT_VERSION,
} from './image-analysis-v2.prompt.js';
import { IMAGE_ANALYSIS_PROMPT } from './image-analysis.prompt.js';
import {
  InvalidImageAnalysisResponseError,
  parseImageAnalysisResponse,
} from './image-analysis-response.js';
import { IMAGE_ANALYSIS_RESPONSE_SCHEMA } from './image-analysis.schema.js';
import { ImageAnalysisService } from './image-analysis.service.js';

export const GEMINI_TIMEOUT_MS = 20_000;

export const GEMINI_CLIENT = Symbol('GEMINI_CLIENT');

interface GeminiCandidate {
  finishReason?: string;
}

interface GeminiPromptFeedback {
  blockReason?: string;
}

export interface GeminiClient {
  models: {
    generateContent(parameters: GenerateContentParameters): Promise<{
      readonly text?: string;
      readonly candidates?: readonly GeminiCandidate[];
      readonly promptFeedback?: GeminiPromptFeedback;
      readonly modelVersion?: string;
    }>;
  };
}

@Injectable()
export class GeminiImageAnalysisService extends ImageAnalysisService {
  readonly providerName = 'gemini';

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(GEMINI_CLIENT) private readonly client: GeminiClient | null,
  ) {
    super();
  }

  async analyzeTattooImage(image: TattooImageInput): Promise<ImageAnalysisResult> {
    return (
      await this.requestAnalysis(
        image,
        IMAGE_ANALYSIS_PROMPT,
        IMAGE_ANALYSIS_RESPONSE_SCHEMA,
        parseImageAnalysisResponse,
      )
    ).result;
  }

  async analyzeTattooImageV2(
    image: TattooImageInput,
    styles: readonly VisionStyle[],
  ): Promise<ImageAnalysisV2Result> {
    const { result, rawResponse, model } = await this.requestAnalysis(
      image,
      createImageAnalysisV2Prompt(styles),
      createImageAnalysisV2Schema(styles, 'gemini'),
      (text) => parseImageAnalysisV2Response(text, styles),
    );
    return {
      observations: result,
      provider: 'gemini',
      model,
      promptVersion: IMAGE_ANALYSIS_V2_PROMPT_VERSION,
      schemaVersion: IMAGE_ANALYSIS_V2_SCHEMA_VERSION,
      rawResponse,
    };
  }

  private async requestAnalysis<T>(
    image: TattooImageInput,
    prompt: string,
    schema: Record<string, unknown>,
    parse: (text: string | undefined) => T,
  ) {
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

    if (!this.client)
      throw new AIProviderError({
        provider: 'gemini',
        category: 'AUTHENTICATION',
        retryable: false,
        fallbackEligible: false,
      });

    const parameters: GenerateContentParameters = {
      model: this.configService.getOrThrow<string>('GEMINI_MODEL'),
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
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
        maxOutputTokens: schema === IMAGE_ANALYSIS_RESPONSE_SCHEMA ? 512 : 1024,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        httpOptions: {
          timeout: GEMINI_TIMEOUT_MS,
          retryOptions: {
            attempts: 1,
          },
        },
      },
    };

    try {
      const response = await this.client.models.generateContent(parameters);

      if (this.hasSafetyRejection(response)) {
        throw new AIProviderError({
          provider: this.providerName,
          category: 'SAFETY_REJECTION',
          retryable: false,
          fallbackEligible: false,
        });
      }

      return {
        result: parse(response.text),
        model: response.modelVersion || parameters.model,
        rawResponse: serializeProviderResponse(response, response.text),
      };
    } catch (error: unknown) {
      if (error instanceof AIProviderError) {
        throw error;
      }

      if (error instanceof InvalidImageAnalysisResponseError) {
        throw new AIProviderError({
          provider: this.providerName,
          category: 'INVALID_RESPONSE',
          retryable: true,
          fallbackEligible: true,
          cause: error,
        });
      }

      throw this.toProviderError(error);
    }
  }

  private hasSafetyRejection(response: {
    candidates?: readonly GeminiCandidate[];
    promptFeedback?: GeminiPromptFeedback;
  }): boolean {
    if (response.promptFeedback?.blockReason) {
      return true;
    }

    return Boolean(
      response.candidates?.some((candidate) =>
        ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(candidate.finishReason ?? ''),
      ),
    );
  }

  private toProviderError(error: unknown): AIProviderError {
    const status = error instanceof ApiError ? error.status : this.readStatus(error);
    const code = this.readCode(error);
    const name = error instanceof Error ? error.name : '';

    if (status === 408 || name === 'AbortError' || name === 'TimeoutError') {
      return this.createError('TIMEOUT', true, true, error, status, code);
    }

    if (status === 429) {
      return this.createError('RATE_LIMIT', true, true, error, status, code);
    }

    if (typeof status === 'number' && status >= 500) {
      return this.createError('SERVER_ERROR', true, true, error, status, code);
    }

    if (this.isNetworkError(error, status)) {
      return this.createError('NETWORK_ERROR', true, true, error, status, code);
    }

    if (status === 400) {
      return this.createError('BAD_REQUEST', false, false, error, status, code);
    }

    if (status === 401) {
      return this.createError('AUTHENTICATION', false, false, error, status, code);
    }

    if (status === 403) {
      return this.createError('PERMISSION_DENIED', false, false, error, status, code);
    }

    if (status === 404) {
      return this.createError('NOT_FOUND', false, false, error, status, code);
    }

    return this.createError('UNKNOWN', false, false, error, status, code);
  }

  private createError(
    category: AIProviderErrorCategory,
    retryable: boolean,
    fallbackEligible: boolean,
    cause: unknown,
    status?: number,
    code?: string | number,
  ): AIProviderError {
    return new AIProviderError({
      provider: this.providerName,
      category,
      retryable,
      fallbackEligible,
      status,
      code,
      cause,
    });
  }

  private isNetworkError(error: unknown, status: number | undefined): boolean {
    if (status !== undefined) {
      return false;
    }

    const code = this.readCode(error);

    return (
      error instanceof TypeError ||
      (typeof code === 'string' &&
        ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT'].includes(code))
    );
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
