import { Inject, Injectable } from '@nestjs/common';
import { ConversationStatus, LeadStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import type { TemporaryImageStorage } from '../ports/temporary-image-storage.port.js';

@Injectable()
export class IncompleteConversationCleanupService implements TemporaryImageStorage {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(StorageService)
    private readonly storage: StorageService,
  ) {}

  async deleteForConversation(conversationId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { conversationId },
      select: {
        id: true,
        status: true,
        images: {
          where: { deletedAt: null },
          select: { storagePath: true },
        },
      },
    });

    if (!lead || lead.status !== LeadStatus.ANALYZING) {
      return;
    }

    for (const image of lead.images) {
      await this.storage.delete(image.storagePath);
    }

    await this.prisma.lead.deleteMany({
      where: {
        id: lead.id,
        status: LeadStatus.ANALYZING,
        conversation: { status: ConversationStatus.ABANDONED },
      },
    });
  }
}
