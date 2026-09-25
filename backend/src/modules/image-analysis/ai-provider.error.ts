export type AIProviderName = 'gemini' | 'openai';

export type AIProviderErrorCategory =
  | 'AUTHENTICATION'
  | 'BAD_REQUEST'
  | 'IMAGE_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMIT'
  | 'SAFETY_REJECTION'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface AIProviderErrorOptions {
  provider: AIProviderName;
  category: AIProviderErrorCategory;
  retryable: boolean;
  fallbackEligible: boolean;
  status?: number;
  code?: string | number;
  cause?: unknown;
}

export class AIProviderError extends Error {
  readonly provider: AIProviderName;
  readonly category: AIProviderErrorCategory;
  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
  readonly status?: number;
  readonly code?: string | number;

  constructor(options: AIProviderErrorOptions) {
    super(`${options.provider} image analysis failed (${options.category}).`, {
      cause: options.cause,
    });
    this.name = AIProviderError.name;
    this.provider = options.provider;
    this.category = options.category;
    this.retryable = options.retryable;
    this.fallbackEligible = options.fallbackEligible;
    this.status = options.status;
    this.code = options.code;
  }
}

export function toUnknownProviderError(provider: AIProviderName, error: unknown): AIProviderError {
  return error instanceof AIProviderError
    ? error
    : new AIProviderError({
        provider,
        category: 'UNKNOWN',
        retryable: false,
        fallbackEligible: false,
        cause: error,
      });
}
