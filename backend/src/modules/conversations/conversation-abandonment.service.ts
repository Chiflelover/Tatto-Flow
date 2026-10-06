import { Inject, Injectable } from '@nestjs/common';
import { ConversationStatus, type Conversation } from '../../generated/prisma/client.js';
import { v2IntakeSnapshot } from './conversation-v2-intake.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { getConversationAbandonmentCutoff } from './conversation-abandonment.constants.js';

@Injectable()
export class ConversationAbandonmentService {
  private readonly logger = new SafeStructuredLogger(ConversationAbandonmentService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  abandonInactive(now = new Date()): Promise<number> {
    return this.updateInactiveConversations(now);
  }

  abandonInactiveForCustomer(customerId: string, now = new Date()): Promise<number> {
    return this.updateInactiveConversations(now, customerId);
  }

  private async updateInactiveConversations(now: Date, customerId?: string): Promise<number> {
    const cutoff = getConversationAbandonmentCutoff(now);
    const candidates = await this.prisma.conversation.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        status: ConversationStatus.ACTIVE,
        lastActivityAt: { lte: cutoff },
      },
    });
    let abandonedCount = 0;

    for (const conversation of candidates) {
      if (await this.abandonConversation(conversation, cutoff)) {
        abandonedCount += 1;
      }
    }

    return abandonedCount;
  }

  private async abandonConversation(conversation: Conversation, cutoff: Date): Promise<boolean> {
    const leadId = await this.prisma.$transaction(async (transaction) => {
      const update = await transaction.conversation.updateMany({
        where: {
          id: conversation.id,
          accountId: conversation.accountId,
          customerId: conversation.customerId,
          status: ConversationStatus.ACTIVE,
          lastActivityAt: { lte: cutoff },
        },
        data: { status: ConversationStatus.ABANDONED },
      });

      if (update.count === 0) {
        return null;
      }

      const lead = await transaction.lead.upsert({
        where: { conversationId: conversation.id },
        update: {
          ...v2IntakeSnapshot(conversation),
          bodyPart: conversation.bodyPart,
        },
        create: {
          ...v2IntakeSnapshot(conversation),
          accountId: conversation.accountId,
          customerId: conversation.customerId,
          conversationId: conversation.id,
          bodyPart: conversation.bodyPart,
        },
      });

      return lead.id;
    });

    if (!leadId) {
      return false;
    }

    this.logger.info('workflow.conversation.abandoned', {
      conversationId: conversation.id,
      leadId,
    });
    return true;
  }
}
