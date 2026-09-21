import { Inject, Injectable } from '@nestjs/common';
import {
  ConversationState,
  ConversationStatus,
  LeadStatus,
  Prisma,
  type Conversation,
  type DetailLevel,
  type TattooSize,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';

export interface ConversationUpdate {
  currentState?: ConversationState;
  selectedSize?: TattooSize;
  selectedDetail?: DetailLevel;
  bodyPart?: string;
}

export interface ConversationTransitionResult {
  applied: boolean;
  conversation: Conversation;
}

export interface ActiveConversationResult {
  conversation: Conversation;
  created: boolean;
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConversationAbandonmentService)
    private readonly abandonmentService: ConversationAbandonmentService,
  ) {}

  async getOrCreateActive(customerId: string): Promise<ActiveConversationResult> {
    const now = new Date();

    await this.abandonmentService.abandonInactiveForCustomer(customerId, now);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const activeConversation = await transaction.conversation.findFirst({
          where: {
            customerId,
            status: ConversationStatus.ACTIVE,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (activeConversation) {
          return { conversation: activeConversation, created: false };
        }

        const handedOffConversation = await transaction.conversation.findFirst({
          where: {
            customerId,
            status: ConversationStatus.COMPLETED,
            currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
            lead: {
              is: {
                status: { not: LeadStatus.COMPLETED },
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
        });

        if (handedOffConversation) {
          return { conversation: handedOffConversation, created: false };
        }

        const conversation = await transaction.conversation.create({
          data: {
            customerId,
            currentState: ConversationState.START,
            status: ConversationStatus.ACTIVE,
            lastActivityAt: now,
          },
        });

        return { conversation, created: true };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }

      const concurrentConversation = await this.findActiveByCustomerId(customerId);

      if (!concurrentConversation) {
        throw error;
      }

      return { conversation: concurrentConversation, created: false };
    }
  }

  async findCurrentForCustomer(customerId: string): Promise<Conversation | null> {
    const activeConversation = await this.prisma.conversation.findFirst({
      where: {
        customerId,
        status: ConversationStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (activeConversation) {
      return activeConversation;
    }

    return this.prisma.conversation.findFirst({
      where: {
        customerId,
        status: ConversationStatus.COMPLETED,
        currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
        lead: {
          is: {
            status: { not: LeadStatus.COMPLETED },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async applyTransition(
    conversationId: string,
    expectedState: ConversationState,
    update: ConversationUpdate,
  ): Promise<ConversationTransitionResult> {
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        currentState: expectedState,
        status: ConversationStatus.ACTIVE,
      },
      data: {
        ...update,
        lastActivityAt: new Date(),
      },
    });

    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });

    return {
      applied: result.count === 1,
      conversation,
    };
  }

  private findActiveByCustomerId(customerId: string): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({
      where: {
        customerId,
        status: ConversationStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
