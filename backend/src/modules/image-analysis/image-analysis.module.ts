import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type { AiFallbackProvider } from '../../config/environment.validation.js';
import { LeadScoringModule } from '../lead-scoring/lead-scoring.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { ValidationModule } from '../validation/validation.module.js';
import {
  GEMINI_CLIENT,
  GeminiImageAnalysisService,
  type GeminiClient,
} from './gemini-image-analysis.service.js';
import { ImageAnalysisWorkflowService } from './image-analysis-workflow.service.js';
import { ImageAnalysisService } from './image-analysis.service.js';
import {
  OPENAI_CLIENT,
  OPENAI_TIMEOUT_MS,
  OpenAIImageAnalysisService,
} from './openai-image-analysis.service.js';
import {
  AI_RETRY_RANDOM,
  AI_RETRY_SLEEP,
  ResilientImageAnalysisService,
  productionRetryRandom,
  productionRetrySleep,
} from './resilient-image-analysis.service.js';

@Module({
  imports: [LeadScoringModule, PricingModule, ValidationModule],
  providers: [
    GeminiImageAnalysisService,
    OpenAIImageAnalysisService,
    ResilientImageAnalysisService,
    ImageAnalysisWorkflowService,
    { provide: AI_RETRY_SLEEP, useValue: productionRetrySleep },
    { provide: AI_RETRY_RANDOM, useValue: productionRetryRandom },
    {
      provide: GEMINI_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): GeminiClient =>
        new GoogleGenAI({
          apiKey: configService.getOrThrow<string>('GEMINI_API_KEY'),
        }),
    },
    {
      provide: OPENAI_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): OpenAI | null => {
        if (configService.getOrThrow<AiFallbackProvider>('AI_FALLBACK_PROVIDER') !== 'openai') {
          return null;
        }

        return new OpenAI({
          apiKey: configService.getOrThrow<string>('OPENAI_API_KEY'),
          maxRetries: 0,
          timeout: OPENAI_TIMEOUT_MS,
        });
      },
    },
    {
      provide: ImageAnalysisService,
      useExisting: ResilientImageAnalysisService,
    },
  ],
  exports: [ImageAnalysisWorkflowService],
})
export class ImageAnalysisModule {}
