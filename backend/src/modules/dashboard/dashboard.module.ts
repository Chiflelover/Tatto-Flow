import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { CustomerMessagingService } from './customer-messaging.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { MockCustomerMessagingService } from './mock-customer-messaging.service.js';

@Module({
  imports: [AuthModule, PricingModule, StorageModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    {
      provide: CustomerMessagingService,
      useClass: MockCustomerMessagingService,
    },
  ],
})
export class DashboardModule {}
