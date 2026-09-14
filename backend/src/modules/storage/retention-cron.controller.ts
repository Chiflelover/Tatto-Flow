import { Controller, Get, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from './cron-secret.guard.js';
import {
  LeadImageRetentionService,
  type RetentionCleanupResult,
} from './lead-image-retention.service.js';

@Controller('cron')
@UseGuards(CronSecretGuard)
export class RetentionCronController {
  constructor(private readonly retentionService: LeadImageRetentionService) {}

  @Get('cleanup-expired-images')
  cleanupExpiredImages(): Promise<RetentionCleanupResult> {
    return this.retentionService.cleanupExpiredImages();
  }
}
