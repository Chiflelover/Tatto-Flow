import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiMode } from '../../config/environment.validation.js';
import { LeadScoringModule } from '../lead-scoring/lead-scoring.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { ValidationModule } from '../validation/validation.module.js';
import { ImageAnalysisWorkflowService } from './image-analysis-workflow.service.js';
import { ImageAnalysisService } from './image-analysis.service.js';
import { MockImageAnalysisService } from './mock-image-analysis.service.js';

@Module({
  imports: [LeadScoringModule, PricingModule, ValidationModule],
  providers: [
    MockImageAnalysisService,
    ImageAnalysisWorkflowService,
    {
      provide: ImageAnalysisService,
      inject: [ConfigService, MockImageAnalysisService],
      useFactory: (
        configService: ConfigService,
        mockService: MockImageAnalysisService,
      ): ImageAnalysisService => {
        const mode = configService.getOrThrow<AiMode>('AI_MODE');

        if (mode === 'mock') {
          return mockService;
        }

        throw new Error(
          'AI_MODE=openai todavía no está implementado. Usa AI_MODE=mock en esta fase.',
        );
      },
    },
  ],
  exports: [ImageAnalysisWorkflowService],
})
export class ImageAnalysisModule {}
