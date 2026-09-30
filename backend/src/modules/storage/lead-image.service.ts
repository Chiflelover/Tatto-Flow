import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { LeadImage, Prisma } from '../../generated/prisma/client.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { TattooImageInput } from '../image-analysis/domain/image-analysis.types.js';
import { validateLeadImageFile } from './lead-image-file.js';
import { createLeadImageStoragePath } from './storage-path.js';
import { StorageService } from './storage.service.js';

const FRIENDLY_STORAGE_ERROR = 'No pudimos guardar la imagen de referencia. Inténtalo nuevamente.';

export class LeadImageStorageException extends ServiceUnavailableException {
  constructor() {
    super(FRIENDLY_STORAGE_ERROR);
  }
}

@Injectable()
export class LeadImageService {
  private readonly logger = new SafeStructuredLogger(LeadImageService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(StorageService)
    private readonly storage: StorageService,
  ) {}

  async ensureStored(
    leadId: string,
    image: TattooImageInput,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<LeadImage> {
    const validatedImage = validateLeadImageFile(image);
    const existingImage = await client.leadImage.findFirst({
      where: {
        leadId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingImage) {
      return existingImage;
    }

    const storagePath = createLeadImageStoragePath(leadId, validatedImage.extension);
    this.logger.info('storage.upload.started', { leadId });

    try {
      await this.storage.upload({
        path: storagePath,
        content: image.content,
        contentType: validatedImage.contentType,
      });
    } catch {
      this.logger.error('storage.upload.failed', { leadId, stage: 'upload' });
      throw new LeadImageStorageException();
    }

    const createdAt = new Date();

    try {
      const leadImage = await client.leadImage.create({
        data: {
          leadId,
          storagePath,
          createdAt,
        },
      });

      this.logger.info('storage.upload.completed', { leadId, leadImageId: leadImage.id });
      return leadImage;
    } catch {
      try {
        await this.storage.delete(storagePath);
      } catch {
        this.logger.error('storage.upload.compensation_failed', { leadId });
      }

      this.logger.error('storage.upload.failed', { leadId, stage: 'metadata' });
      throw new LeadImageStorageException();
    }
  }
}
