import { Injectable } from '@nestjs/common';
import { ConversationStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { getConversationAbandonmentCutoff } from './conversation-abandonment.constants.js';

@Injectable()
export class ConversationAbandonmentService {
  constructor(private readonly prisma: PrismaService) {}

  abandonInactive(now = new Date()): Promise<number> {
    return this.updateInactiveConversations(now);
  }

  abandonInactiveForCustomer(customerId: string, now = new Date()): Promise<number> {
    return this.updateInactiveConversations(now, customerId);
  }

  private async updateInactiveConversations(now: Date, customerId?: string): Promise<number> {
    const cutoff = getConversationAbandonmentCutoff(now);
    const result = await this.prisma.conversation.updateMany({
      where: {
        ...(customerId ? { customerId } : {}),
        status: ConversationStatus.ACTIVE,
        lastActivityAt: { lte: cutoff },
      },
      data: { status: ConversationStatus.ABANDONED },
    });

    return result.count;
  }
}
