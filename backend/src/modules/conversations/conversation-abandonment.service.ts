import { Inject, Injectable } from '@nestjs/common';
import { ConversationStatus, type Conversation } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { toImageAnalysisResult } from '../image-analysis/domain/persisted-image-analysis.js';
import { LeadScoringService } from '../lead-scoring/lead-scoring.service.js';
import { getConversationAbandonmentCutoff } from './conversation-abandonment.constants.js';

@Injectable()
export class ConversationAbandonmentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LeadScoringService) private readonly leadScoringService: LeadScoringService,
  ) {}

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
    return this.prisma.$transaction(async (transaction) => {
      const update = await transaction.conversation.updateMany({
        where: {
          id: conversation.id,
          status: ConversationStatus.ACTIVE,
          lastActivityAt: { lte: cutoff },
        },
        data: { status: ConversationStatus.ABANDONED },
      });

      if (update.count === 0) {
        return false;
      }

      const lead = await transaction.lead.upsert({
        where: { conversationId: conversation.id },
        update: {
          selectedSize: conversation.selectedSize,
          selectedDetail: conversation.selectedDetail,
          bodyPart: conversation.bodyPart,
        },
        create: {
          customerId: conversation.customerId,
          conversationId: conversation.id,
          selectedSize: conversation.selectedSize,
          selectedDetail: conversation.selectedDetail,
          bodyPart: conversation.bodyPart,
        },
        include: {
          aiAnalysis: true,
          images: {
            where: { deletedAt: null },
            select: { id: true },
          },
        },
      });

      await this.leadScoringService.evaluateAndPersist(
        lead.id,
        {
          selectedSize: lead.selectedSize,
          selectedDetail: lead.selectedDetail,
          bodyPart: lead.bodyPart,
          referenceReceived: lead.images.length > 0,
          conversationStatus: ConversationStatus.ABANDONED,
          analysis: lead.aiAnalysis ? toImageAnalysisResult(lead.aiAnalysis) : null,
        },
        transaction,
      );

      return true;
    });
  }
}
