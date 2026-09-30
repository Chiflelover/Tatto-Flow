import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service.js';
import { QuoteV2Service } from './quote-v2.service.js';

@Module({
  providers: [PricingService, QuoteV2Service],
  exports: [PricingService, QuoteV2Service],
})
export class PricingModule {}
