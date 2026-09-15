import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { LeadImage } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { TattooImageInput } from '../image-analysis/domain/image-analysis.types.js';
import { validateLeadImageFile } from './lead-image-file.js';
import { createLeadImageStoragePath } from './storage-path.js';
import { StorageService } from './storage.service.js';

const RETENTION_DAYS = 15;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const FRIENDLY_STORAGE_ERROR = 'No pudimos guardar la imagen de referencia. Inténtalo nuevamente.';

export class LeadImageStorageException extends ServiceUnavailableException {
  constructor() {
    super(FRIENDLY_STORAGE_ERROR);
  }
}

@Injectable()
export class LeadImageService {
  private readonly logger = new Logger(LeadImageService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(StorageService)
    private readonly storage: StorageService,
  ) {}

  async ensureStored(leadId: string, image: TattooImageInput): Promise<LeadImage> {
    const validatedImage = validateLeadImageFile(image);
    const existingImage = await this.prisma.leadImage.findFirst({
      where: {
        leadId,
        deletedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingImage) {
      return existingImage;
    }

    const storagePath = createLeadImageStoragePath(leadId, validatedImage.extension);

    try {
      await this.storage.upload({
        path: storagePath,
        content: image.content,
        contentType: validatedImage.contentType,
      });
    } catch {
      throw new LeadImageStorageException();
    }

    const createdAt = new Date();

    try {
      return await this.prisma.leadImage.create({
        data: {
          leadId,
          storagePath,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + RETENTION_MS),
        },
      });
    } catch {
      try {
        await this.storage.delete(storagePath);
      } catch {
        this.logger.error(`Storage compensation failed for lead ${leadId}.`);
      }

      throw new LeadImageStorageException();
    }
  }
}

export const LEAD_IMAGE_RETENTION_DAYS = RETENTION_DAYS;
