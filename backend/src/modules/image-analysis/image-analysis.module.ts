import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type { AiMode } from '../../config/environment.validation.js';
import { LeadScoringModule } from '../lead-scoring/lead-scoring.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { ValidationModule } from '../validation/validation.module.js';
import {
  GEMINI_CLIENT,
  GeminiImageAnalysisService,
  type GeminiClient,
} from './gemini-image-analysis.service.js';
import { ImageAnalysisWorkflowService } from './image-analysis-workflow.service.js';
import { selectImageAnalysisProvider } from './image-analysis.provider.js';
import { ImageAnalysisService } from './image-analysis.service.js';
import { MockImageAnalysisService } from './mock-image-analysis.service.js';

@Module({
  imports: [LeadScoringModule, PricingModule, ValidationModule],
  providers: [
    MockImageAnalysisService,
    GeminiImageAnalysisService,
    ImageAnalysisWorkflowService,
    {
      provide: GEMINI_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): GeminiClient | null => {
        if (configService.getOrThrow<AiMode>('AI_MODE') !== 'gemini') {
          return null;
        }

        return new GoogleGenAI({
          apiKey: configService.getOrThrow<string>('GEMINI_API_KEY'),
        });
      },
    },
    {
      provide: ImageAnalysisService,
      inject: [ConfigService, MockImageAnalysisService, GeminiImageAnalysisService],
      useFactory: (
        configService: ConfigService,
        mockService: MockImageAnalysisService,
        geminiService: GeminiImageAnalysisService,
      ): ImageAnalysisService => {
        const mode = configService.getOrThrow<AiMode>('AI_MODE');
        return selectImageAnalysisProvider(mode, mockService, geminiService);
      },
    },
  ],
  exports: [ImageAnalysisWorkflowService],
})
export class ImageAnalysisModule {}
