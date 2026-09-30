import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  ConversationState,
  ConversationStatus,
  FlowVersion,
  type Conversation,
  type Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import type { ConversationTransitionResult } from '../conversations/conversations.service.js';
import { hasCompleteV2Intake, v2IntakeSnapshot } from '../conversations/conversation-v2-intake.js';
import { LeadImageService } from '../storage/lead-image.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { ChatbotConversationUpdate, ChatbotImageInput } from './domain/chatbot.types.js';

@Injectable()
export class NitaV2IntakeService {
  private readonly logger = new SafeStructuredLogger(NitaV2IntakeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LeadImageService) private readonly leadImages: LeadImageService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async storeReference(
    accountId: string,
    conversationId: string,
    image: ChatbotImageInput,
    checkpoint?: (tx: Prisma.TransactionClient, conversation: Conversation) => Promise<void>,
  ): Promise<ConversationTransitionResult> {
    let uploadedPath: string | undefined;
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const conversation = await this.lockConversation(transaction, accountId, conversationId);
          if (
            conversation.status !== ConversationStatus.ACTIVE ||
            conversation.currentState !== ConversationState.WAITING_IMAGE
          ) {
            return { applied: false, conversation };
          }
          if (typeof conversation.firstTattoo !== 'boolean')
            throw new ConflictException('Falta la respuesta sobre el primer tatuaje.');

          // LeadImage already belongs to a lead. Reuse the existing candidate pattern at image receipt.
          const lead = await transaction.lead.upsert({
            where: { conversationId },
            update: {},
            create: { accountId, customerId: conversation.customerId, conversationId },
          });
          if (lead.accountId !== accountId || lead.customerId !== conversation.customerId)
            throw new ConflictException('La referencia no pertenece a esta cuenta y cliente.');
          const existing = await transaction.leadImage.findFirst({
            where: { leadId: lead.id, deletedAt: null },
          });
          const reference = await this.leadImages.ensureStored(lead.id, image, transaction);
          if (!existing) uploadedPath = reference.storagePath;
          const updated = await transaction.conversation.update({
            where: { id: conversationId },
            data: { currentState: ConversationState.ASK_SAME_SIZE, lastActivityAt: new Date() },
          });
          if (checkpoint) await checkpoint(transaction, updated);
          return { applied: true, conversation: updated };
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      // Compensate a successful upload if the enclosing DB transaction fails to commit.
      if (uploadedPath) {
        try {
          await this.storage.delete(uploadedPath);
        } catch {
          this.logger.error('storage.upload.compensation_failed', { conversationId });
        }
      }
      throw error;
    }
  }

  applyTransition(
    accountId: string,
    conversationId: string,
    expectedState: ConversationState,
    update: ChatbotConversationUpdate,
    checkpoint?: (tx: Prisma.TransactionClient, conversation: Conversation) => Promise<void>,
  ): Promise<ConversationTransitionResult> {
    return this.prisma.$transaction(async (transaction) => {
      const conversation = await this.lockConversation(transaction, accountId, conversationId);
      if (
        conversation.status !== ConversationStatus.ACTIVE ||
        conversation.currentState !== expectedState
      )
        return { applied: false, conversation };
      const updated = await transaction.conversation.update({
        where: { id: conversationId },
        data: { ...update, lastActivityAt: new Date() },
      });
      if (updated.currentState === ConversationState.READY_FOR_ANALYSIS) {
        const lead = await transaction.lead.findUnique({
          where: { conversationId },
          include: { images: { where: { deletedAt: null }, select: { id: true } } },
        });
        if (
          !hasCompleteV2Intake(updated) ||
          !lead ||
          lead.accountId !== accountId ||
          lead.customerId !== updated.customerId ||
          lead.images.length === 0
        ) {
          throw new ConflictException(
            'La conversación aún no tiene todos los datos y la referencia.',
          );
        }
        await transaction.lead.update({ where: { id: lead.id }, data: v2IntakeSnapshot(updated) });
      }
      if (checkpoint) await checkpoint(transaction, updated);
      return { applied: true, conversation: updated };
    });
  }

  private async lockConversation(
    transaction: Prisma.TransactionClient,
    accountId: string,
    conversationId: string,
  ): Promise<Conversation> {
    await transaction.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId}::uuid AND account_id = ${accountId}::uuid FOR UPDATE`;
    const conversation = await transaction.conversation.findFirst({
      where: { id: conversationId, accountId, flowVersion: FlowVersion.V2 },
      include: { account: { select: { isActive: true } } },
    });
    if (!conversation)
      throw new ConflictException('La conversación V2 no está disponible para esta cuenta.');
    if (!conversation.account.isActive) throw new ForbiddenException('La cuenta está desactivada.');
    return conversation;
  }
}
