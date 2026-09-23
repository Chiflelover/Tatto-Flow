import { Inject, Injectable } from '@nestjs/common';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from './storage.service.js';

export interface RetentionCleanupResult {
  found: number;
  completed: number;
  failed: number;
}

@Injectable()
export class LeadImageRetentionService {
  private readonly logger = new SafeStructuredLogger(LeadImageRetentionService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(StorageService)
    private readonly storage: StorageService,
  ) {}

  async cleanupExpiredImages(now = new Date()): Promise<RetentionCleanupResult> {
    this.logger.info('storage.cleanup.started');
    const expiredImages = await this.prisma.leadImage.findMany({
      where: {
        expiresAt: { lte: now },
        deletedAt: null,
      },
      select: { id: true, storagePath: true },
    });
    let completed = 0;
    let failed = 0;

    for (const image of expiredImages) {
      try {
        await this.storage.delete(image.storagePath);
        await this.prisma.leadImage.updateMany({
          where: { id: image.id, deletedAt: null },
          data: { deletedAt: now },
        });
        completed += 1;
      } catch {
        failed += 1;
        this.logger.error('storage.cleanup.item_failed', { leadImageId: image.id });
      }
    }

    const result = { found: expiredImages.length, completed, failed };
    const level = failed > 0 ? 'warn' : 'info';
    this.logger[level]('storage.cleanup.completed', result);

    return result;
  }
}
