import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type BookingIntent, type Conversation } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { QuoteV2Service } from '../pricing/quote-v2.service.js';
import { prepareV2Case, v2PreparationFromJson } from './domain/nita-v2-decision.js';
import {
  V2_ADVANCE_QUESTION,
  V2_REVIEW_MESSAGE,
  v2PriceMessage,
} from './domain/nita-v2-messages.js';
import type { WhatsAppOutboundMessage } from './whatsapp/whatsapp.adapter.js';

const PREPARABLE_STATES = [
  'READY_FOR_PRICING',
  'HUMAN_REVIEW',
  'SPECIAL_REVIEW',
  'PRICE_READY',
] as const;

@Injectable()
export class NitaV2CompletionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QuoteV2Service) private readonly pricing: QuoteV2Service,
  ) {}

  async resumePendingForCustomer(accountId: string, phoneNumber: string): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        accountId,
        flowVersion: 'V2',
        status: 'ACTIVE',
        currentState: { in: [...PREPARABLE_STATES] },
        customer: { phoneNumber },
      },
      select: { id: true },
    });
    if (conversation) await this.prepare(accountId, conversation.id);
  }

  async prepare(accountId: string, conversationId: string): Promise<Conversation> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, accountId, conversationId);
      const conversation = await tx.conversation.findFirst({
        where: { id: conversationId, accountId },
        include: { lead: { include: { quote: true } }, account: { select: { isActive: true } } },
      });
      if (!conversation)
        throw new NotFoundException('Conversación no disponible para esta cuenta.');
      if (conversation.flowVersion !== 'V2')
        throw new ConflictException('El cierre solo admite V2.');
      if (!conversation.account.isActive)
        throw new ConflictException('La cuenta está desactivada.');
      if (
        conversation.status !== 'ACTIVE' ||
        !PREPARABLE_STATES.some((state) => state === conversation.currentState)
      )
        return conversation;
      const lead = conversation.lead;
      if (!lead || lead.accountId !== accountId || lead.customerId !== conversation.customerId)
        throw new ConflictException('El lead no pertenece a esta cuenta y cliente.');
      if (lead.status === 'COMPLETED') return conversation;
      let state = conversation.currentState;
      let quote = lead.quote;
      if (state === 'READY_FOR_PRICING') {
        const priced = await this.pricing.getOrCreate(tx, accountId, lead.id);
        if (priced.applicable) {
          quote = priced.quote;
          state = 'PRICE_READY';
        } else {
          const previous =
            v2PreparationFromJson(lead.v2Preparation) ??
            prepareV2Case(
              conversation,
              null,
              { exists: false, enabled: false },
              'INVALID_PREPARATION',
            );
          const preparation = {
            ...previous,
            decision: 'HUMAN_REVIEW',
            reviewReasons: [...new Set([...previous.reviewReasons, priced.reason])],
          };
          await tx.lead.update({
            where: { id: lead.id, accountId },
            data: { v2Preparation: preparation },
          });
          state = 'HUMAN_REVIEW';
        }
      }
      if (state === 'PRICE_READY') {
        if (!quote) throw new ConflictException('Falta la cotización persistida.');
        await tx.lead.update({
          where: { id: lead.id, accountId },
          data: { status: 'AUTO_QUOTED' },
        });
        await this.enqueue(tx, accountId, lead.id, 'RESULT', {
          type: 'text',
          text: v2PriceMessage(quote.amount.toFixed(2)),
        });
        await this.enqueue(tx, accountId, lead.id, 'ADVANCE_INTENT', V2_ADVANCE_QUESTION);
      } else {
        await tx.lead.update({
          where: { id: lead.id, accountId },
          data: { status: state === 'SPECIAL_REVIEW' ? 'SPECIAL_REVIEW' : 'REQUIRES_REVIEW' },
        });
        await this.enqueue(tx, accountId, lead.id, 'RESULT', {
          type: 'text',
          text: V2_REVIEW_MESSAGE,
        });
      }
      return tx.conversation.update({
        where: { id: conversationId, accountId },
        data: { currentState: state, lastActivityAt: new Date() },
      });
    });
  }

  async recordIntent(
    accountId: string,
    conversationId: string,
    customerId: string,
    intent: BookingIntent,
    checkpoint?: (tx: Prisma.TransactionClient, conversation: Conversation) => Promise<void>,
  ): Promise<Conversation> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, accountId, conversationId);
      const conversation = await tx.conversation.findFirst({
        where: { id: conversationId, accountId, customerId, flowVersion: 'V2' },
        include: { lead: { include: { quote: true } }, account: { select: { isActive: true } } },
      });
      if (!conversation)
        throw new NotFoundException('Conversación no disponible para este cliente.');
      if (!conversation.account.isActive)
        throw new ConflictException('La cuenta está desactivada.');
      if (conversation.status !== 'ACTIVE' || conversation.currentState !== 'ASK_ADVANCE_INTENT')
        return conversation;
      const lead = conversation.lead;
      if (
        !lead?.quote ||
        lead.accountId !== accountId ||
        lead.customerId !== customerId ||
        lead.status === 'COMPLETED'
      )
        return conversation;
      await tx.lead.update({
        where: { id: lead.id, accountId },
        data: {
          bookingIntent: intent,
          status: intent === 'DIRECT_BOOKING' ? 'READY_TO_COORDINATE' : 'HANDOFF_TO_TATTOO_ARTIST',
        },
      });
      await this.enqueue(tx, accountId, lead.id, 'HANDOFF', {
        type: 'text',
        text: 'Gracias. El tatuador se pondrá en contacto contigo para coordinar los siguientes pasos.',
      });
      const updated = await tx.conversation.update({
        where: { id: conversationId, accountId },
        data: {
          currentState: 'HANDOFF_TO_TATTOO_ARTIST',
          status: 'COMPLETED',
          lastActivityAt: new Date(),
        },
      });
      if (checkpoint) await checkpoint(tx, updated);
      return updated;
    });
  }

  private enqueue(
    tx: Prisma.TransactionClient,
    accountId: string,
    leadId: string,
    kind: string,
    message: WhatsAppOutboundMessage,
  ) {
    return tx.whatsAppDelivery.upsert({
      where: { leadId_kind: { leadId, kind } },
      update: {},
      create: { leadId, accountId, kind, payload: message },
    });
  }
  private lock(tx: Prisma.TransactionClient, accountId: string, id: string) {
    return tx.$queryRaw`SELECT id FROM conversations WHERE id = ${id}::uuid AND account_id = ${accountId}::uuid FOR UPDATE`;
  }
}
