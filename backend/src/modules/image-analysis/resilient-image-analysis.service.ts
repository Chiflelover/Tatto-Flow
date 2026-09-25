import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiFallbackProvider } from '../../config/environment.validation.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { AIProviderError, toUnknownProviderError } from './ai-provider.error.js';
import type { ImageAnalysisResult, TattooImageInput } from './domain/image-analysis.types.js';
import { GeminiImageAnalysisService } from './gemini-image-analysis.service.js';
import { ImageAnalysisService, type ImageAnalysisContext } from './image-analysis.service.js';
import { OpenAIImageAnalysisService } from './openai-image-analysis.service.js';

const GEMINI_MAX_ATTEMPTS = 2;
const GEMINI_RETRY_BASE_DELAY_MS = 250;
const GEMINI_RETRY_JITTER_MS = 250;

export const AI_RETRY_SLEEP = Symbol('AI_RETRY_SLEEP');
export const AI_RETRY_RANDOM = Symbol('AI_RETRY_RANDOM');

export type RetrySleep = (milliseconds: number) => Promise<void>;
export type RetryRandom = () => number;

@Injectable()
export class ResilientImageAnalysisService extends ImageAnalysisService {
  readonly providerName = 'gemini-with-openai-fallback';
  private readonly logger = new SafeStructuredLogger(ResilientImageAnalysisService.name);

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(GeminiImageAnalysisService)
    private readonly geminiService: GeminiImageAnalysisService,
    @Inject(OpenAIImageAnalysisService)
    private readonly openAIService: OpenAIImageAnalysisService,
    @Inject(AI_RETRY_SLEEP) private readonly sleep: RetrySleep,
    @Inject(AI_RETRY_RANDOM) private readonly random: RetryRandom,
  ) {
    super();
  }

  async analyzeTattooImage(
    image: TattooImageInput,
    context: ImageAnalysisContext = {},
  ): Promise<ImageAnalysisResult> {
    let lastError: AIProviderError | undefined;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
      attemptsMade = attempt;
      const startedAt = Date.now();
      this.logProviderStarted('gemini', this.geminiModel, attempt, context.leadId);

      try {
        const result = await this.geminiService.analyzeTattooImage(image);
        this.logProviderCompleted('gemini', this.geminiModel, attempt, context.leadId, startedAt);
        return result;
      } catch (error: unknown) {
        lastError = toUnknownProviderError('gemini', error);
        this.logProviderError(lastError, attempt, context.leadId, startedAt);

        if (!lastError.retryable || attempt === GEMINI_MAX_ATTEMPTS) {
          break;
        }

        this.logger.warn('ai.analysis.retry', {
          provider: 'gemini',
          leadId: context.leadId ?? null,
          attempt: attempt + 1,
          reason: lastError.category,
        });
        await this.sleep(this.retryDelayMs());
      }
    }

    if (!lastError) {
      throw new AIProviderError({
        provider: 'gemini',
        category: 'UNKNOWN',
        retryable: false,
        fallbackEligible: false,
      });
    }

    if (lastError.retryable && attemptsMade === GEMINI_MAX_ATTEMPTS) {
      this.logger.error('ai.provider.exhausted', {
        provider: 'gemini',
        model: this.geminiModel,
        attempts: attemptsMade,
        leadId: context.leadId ?? null,
        errorCategory: lastError.category,
      });
    }

    if (this.fallbackProvider !== 'openai' || !lastError.fallbackEligible) {
      throw lastError;
    }

    return this.runOpenAIFallback(image, context);
  }

  private async runOpenAIFallback(
    image: TattooImageInput,
    context: ImageAnalysisContext,
  ): Promise<ImageAnalysisResult> {
    const attempt = 1;
    const startedAt = Date.now();
    this.logger.warn('ai.fallback.started', {
      fromProvider: 'gemini',
      provider: 'openai',
      model: this.openAIModel,
      leadId: context.leadId ?? null,
      attempt,
    });
    this.logProviderStarted('openai', this.openAIModel, attempt, context.leadId);

    try {
      const result = await this.openAIService.analyzeTattooImage(image);
      this.logProviderCompleted('openai', this.openAIModel, attempt, context.leadId, startedAt);
      this.logger.info('ai.fallback.completed', {
        fromProvider: 'gemini',
        provider: 'openai',
        model: this.openAIModel,
        leadId: context.leadId ?? null,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error: unknown) {
      const providerError = toUnknownProviderError('openai', error);
      this.logProviderError(providerError, attempt, context.leadId, startedAt);
      this.logger.error('ai.fallback.failed', {
        fromProvider: 'gemini',
        provider: 'openai',
        model: this.openAIModel,
        leadId: context.leadId ?? null,
        durationMs: Date.now() - startedAt,
        errorCode: providerError.category,
      });
      this.logger.error('ai.providers.failed', {
        primaryProvider: 'gemini',
        fallbackProvider: 'openai',
        leadId: context.leadId ?? null,
        errorCategory: providerError.category,
      });
      throw providerError;
    }
  }

  private logProviderStarted(
    provider: 'gemini' | 'openai',
    model: string,
    attempt: number,
    leadId?: string,
  ): void {
    this.logger.info('ai.provider.started', {
      provider,
      model,
      attempt,
      leadId: leadId ?? null,
    });
  }

  private logProviderCompleted(
    provider: 'gemini' | 'openai',
    model: string,
    attempt: number,
    leadId: string | undefined,
    startedAt: number,
  ): void {
    this.logger.info('ai.provider.completed', {
      provider,
      model,
      attempt,
      leadId: leadId ?? null,
      durationMs: Date.now() - startedAt,
    });
  }

  private logProviderError(
    error: AIProviderError,
    attempt: number,
    leadId: string | undefined,
    startedAt: number,
  ): void {
    this.logger.error('ai.provider.error', {
      provider: error.provider,
      model: error.provider === 'gemini' ? this.geminiModel : this.openAIModel,
      status: error.status ?? null,
      code: error.code ?? error.category,
      errorName: error.category,
      errorCategory: error.category,
      retryable: error.retryable,
      attempt,
      leadId: leadId ?? null,
      durationMs: Date.now() - startedAt,
    });
  }

  private retryDelayMs(): number {
    return GEMINI_RETRY_BASE_DELAY_MS + Math.floor(this.random() * GEMINI_RETRY_JITTER_MS);
  }

  private get fallbackProvider(): AiFallbackProvider {
    return this.configService.getOrThrow<AiFallbackProvider>('AI_FALLBACK_PROVIDER');
  }

  private get geminiModel(): string {
    return this.configService.getOrThrow<string>('GEMINI_MODEL');
  }

  private get openAIModel(): string {
    return this.configService.getOrThrow<string>('OPENAI_MODEL');
  }
}

export const productionRetrySleep: RetrySleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const productionRetryRandom: RetryRandom = () => Math.random();
