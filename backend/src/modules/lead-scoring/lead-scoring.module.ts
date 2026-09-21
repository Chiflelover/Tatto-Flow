import { Module } from '@nestjs/common';
import { LEAD_SCORING_CONFIG, LEAD_SCORING_CONFIG_V1 } from './lead-scoring.config.js';
import { LeadScoringService } from './lead-scoring.service.js';

@Module({
  providers: [
    LeadScoringService,
    {
      provide: LEAD_SCORING_CONFIG,
      useValue: LEAD_SCORING_CONFIG_V1,
    },
  ],
  exports: [LeadScoringService],
})
export class LeadScoringModule {}
