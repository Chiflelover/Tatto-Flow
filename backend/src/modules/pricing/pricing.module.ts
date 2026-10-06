import { Module } from '@nestjs/common';
import { QuoteV2Service } from './quote-v2.service.js';

@Module({
  providers: [QuoteV2Service],
  exports: [QuoteV2Service],
})
export class PricingModule {}
