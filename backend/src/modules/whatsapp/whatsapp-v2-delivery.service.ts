import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma, WhatsAppDelivery, WhatsAppJob } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import type { WhatsAppOutboundMessage } from '../chatbot/whatsapp/whatsapp.adapter.js';
import {
  isConfirmedWhatsAppSendFailure,
  WhatsAppCloudApiClient,
} from './whatsapp-cloud-api.client.js';

const DELIVERY_ORDER = ['TARGET_SIZE', 'RESULT', 'ADVANCE_INTENT', 'HANDOFF'];
export const V2_DELIVERY_LEASE_MS = 60_000;

@Injectable()
export class WhatsAppV2DeliveryService {
  private readonly logger = new SafeStructuredLogger(WhatsAppV2DeliveryService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WhatsAppCloudApiClient) private readonly cloud: WhatsAppCloudApiClient,
  ) {}

  async deliverForCustomer(
    accountId: string,
    phoneNumberId: string,
    phoneNumber: string,
  ): Promise<'DONE' | 'UNKNOWN'> {
    const channel = await this.prisma.whatsAppChannel.findFirst({
      where: { accountId, phoneNumberId, account: { isActive: true } },
      select: { id: true },
    });
    if (!channel) return 'DONE';
    const lead = await this.prisma.lead.findFirst({
      where: {
        accountId,
        customer: { phoneNumber },
        conversation: { status: { not: 'ABANDONED' } },
        OR: [
          { status: { not: 'COMPLETED' } },
          {
            status: 'COMPLETED',
            conversation: { status: 'COMPLETED', currentState: 'INVALID_REFERENCE' },
          },
        ],
        deliveries: { some: { sentAt: null } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, conversation: { select: { currentState: true } } },
    });
    if (!lead) return 'DONE';
    const order =
      lead.conversation?.currentState === 'INVALID_REFERENCE'
        ? ['INVALID_REFERENCE']
        : DELIVERY_ORDER;
    for (const kind of order) {
      const delivery = await this.claim(accountId, lead.id, kind);
      if (delivery === 'UNKNOWN') return 'UNKNOWN';
      if (!delivery) continue;
      if (!(await this.sendClaimed(accountId, phoneNumberId, phoneNumber, delivery)))
        return 'UNKNOWN';
    }
    return 'DONE';
  }

  async deliverForJob(job: WhatsAppJob, phoneNumber: string): Promise<'DONE' | 'UNKNOWN'> {
    const entries = await this.prisma.whatsAppDelivery.findMany({
      where: { jobId: job.id, accountId: job.accountId, kind: 'INTAKE' },
      orderBy: { sequence: 'asc' },
    });
    for (const entry of entries) {
      const delivery = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM whatsapp_jobs WHERE id = ${job.id}::uuid AND account_id = ${job.accountId}::uuid FOR UPDATE`;
        const owned = await tx.whatsAppJob.findFirst({
          where: {
            id: job.id,
            accountId: job.accountId,
            claimId: job.claimId,
            status: 'PROCESSING',
            leaseUntil: { gt: new Date() },
            account: { isActive: true },
          },
        });
        if (!owned)
          throw new ServiceUnavailableException('El trabajo ya no está disponible para envío.');
        const row = await tx.whatsAppDelivery.findFirst({
          where: { id: entry.id, accountId: job.accountId },
        });
        return row ? this.claimRow(tx, row) : null;
      });
      if (delivery === 'UNKNOWN') return 'UNKNOWN';
      if (!delivery) continue;
      if (!(await this.sendClaimed(job.accountId, job.phoneNumberId, phoneNumber, delivery)))
        return 'UNKNOWN';
    }
    return 'DONE';
  }

  private async sendClaimed(
    accountId: string,
    phoneNumberId: string,
    phoneNumber: string,
    delivery: WhatsAppDelivery,
  ): Promise<boolean> {
    const active = await this.prisma.whatsAppChannel.findFirst({
      where: { accountId, phoneNumberId, account: { isActive: true } },
    });
    if (!active)
      throw new ServiceUnavailableException('La cuenta ya no está disponible para envío.');
    try {
      await this.cloud.sendMessage(
        phoneNumberId,
        phoneNumber,
        delivery.payload as unknown as WhatsAppOutboundMessage,
        AbortSignal.timeout(30_000),
      );
    } catch (error) {
      const confirmedFailure = isConfirmedWhatsAppSendFailure(error);
      await this.recordFailure(accountId, delivery, confirmedFailure);
      if (!confirmedFailure) return false;
      throw new ServiceUnavailableException(
        'La respuesta quedó guardada para reintentar su envío.',
      );
    }
    try {
      if (!(await this.markSent(accountId, delivery))) return false;
    } catch {
      // Meta accepted the request, but the local transaction may not have committed.
      await this.recordFailure(accountId, delivery, false);
      return false;
    }
    this.logger.info('whatsapp.v2.delivery_sent', {
      deliveryId: delivery.id,
      attempt: delivery.attemptCount,
    });
    return true;
  }

  private async recordFailure(
    accountId: string,
    delivery: WhatsAppDelivery,
    confirmedFailure: boolean,
  ) {
    const errorCode = confirmedFailure ? 'DELIVERY_FAILED' : 'DELIVERY_UNKNOWN';
    try {
      await this.prisma.whatsAppDelivery.updateMany({
        where: { id: delivery.id, accountId, claimId: delivery.claimId, sentAt: null },
        data: { claimId: null, leaseUntil: null, lastErrorCode: errorCode },
      });
    } catch {
      // The durable claim survives a DB outage; an expired claim also blocks resending.
      this.logger.error('whatsapp.v2.delivery_record_failed', {
        deliveryId: delivery.id,
        errorCode,
      });
    }
    this.logger.error(
      confirmedFailure ? 'whatsapp.v2.delivery_failed' : 'whatsapp.v2.delivery_unknown',
      {
        deliveryId: delivery.id,
        attempt: delivery.attemptCount,
        errorCode,
      },
    );
  }

  private claim(accountId: string, leadId: string, kind: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT c.id FROM conversations c JOIN leads l ON l.conversation_id = c.id WHERE l.id = ${leadId}::uuid AND l.account_id = ${accountId}::uuid AND c.account_id = ${accountId}::uuid FOR UPDATE OF c`;
      const lead = await tx.lead.findFirst({
        where: {
          id: leadId,
          accountId,
          ...(kind === 'INVALID_REFERENCE'
            ? {
                status: 'COMPLETED' as const,
                conversation: {
                  status: 'COMPLETED' as const,
                  currentState: 'INVALID_REFERENCE' as const,
                },
              }
            : {
                status: { not: 'COMPLETED' as const },
                conversation: { status: { not: 'ABANDONED' as const } },
              }),
        },
        select: { id: true },
      });
      if (!lead) return null;
      const delivery = await tx.whatsAppDelivery.findFirst({ where: { leadId, accountId, kind } });
      if (!delivery || delivery.sentAt) return null;
      if (delivery.lastErrorCode === 'DELIVERY_UNKNOWN') return 'UNKNOWN' as const;
      if (kind === 'ADVANCE_INTENT') {
        const result = await tx.whatsAppDelivery.findFirst({
          where: { leadId, accountId, kind: 'RESULT' },
        });
        if (!result?.sentAt)
          throw new ServiceUnavailableException('El resultado todavía no fue entregado.');
      }
      return this.claimRow(tx, delivery);
    });
  }

  private async claimRow(tx: Prisma.TransactionClient, delivery: WhatsAppDelivery) {
    if (delivery.sentAt) return null;
    if (delivery.lastErrorCode === 'DELIVERY_UNKNOWN') return 'UNKNOWN' as const;
    const now = new Date();
    if (delivery.claimId && delivery.leaseUntil && delivery.leaseUntil > now)
      throw new ServiceUnavailableException('La entrega sigue en proceso.');
    if (delivery.claimId) {
      // Expiration cannot establish whether the previous worker sent the message.
      await tx.whatsAppDelivery.update({
        where: { id: delivery.id, accountId: delivery.accountId },
        data: { claimId: null, leaseUntil: null, lastErrorCode: 'DELIVERY_UNKNOWN' },
      });
      return 'UNKNOWN' as const;
    }
    return tx.whatsAppDelivery.update({
      where: { id: delivery.id, accountId: delivery.accountId },
      data: {
        claimId: randomUUID(),
        leaseUntil: new Date(now.getTime() + V2_DELIVERY_LEASE_MS),
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
        lastErrorCode: null,
      },
    });
  }

  private markSent(accountId: string, delivery: WhatsAppDelivery) {
    return this.prisma.$transaction(async (tx) => {
      if (delivery.leadId)
        await tx.$queryRaw`SELECT c.id FROM conversations c JOIN leads l ON l.conversation_id = c.id WHERE l.id = ${delivery.leadId}::uuid AND l.account_id = ${accountId}::uuid AND c.account_id = ${accountId}::uuid FOR UPDATE OF c`;
      else if (delivery.jobId)
        await tx.$queryRaw`SELECT id FROM whatsapp_jobs WHERE id = ${delivery.jobId}::uuid AND account_id = ${accountId}::uuid FOR UPDATE`;
      const recorded = await tx.whatsAppDelivery.updateMany({
        where: { id: delivery.id, accountId, sentAt: null, claimId: delivery.claimId },
        data: { sentAt: new Date(), claimId: null, leaseUntil: null, lastErrorCode: null },
      });
      if (!recorded.count) return false;
      if (!delivery.leadId) return true;
      const lead = await tx.lead.findFirst({
        where: { id: delivery.leadId, accountId },
        include: { quote: true, conversation: true },
      });
      if (!lead?.conversation || lead.conversation.status !== 'ACTIVE') return true;
      if (delivery.kind === 'ADVANCE_INTENT' && lead.quote) {
        await tx.conversation.updateMany({
          where: {
            id: lead.conversation.id,
            accountId,

            status: 'ACTIVE',
            currentState: 'PRICE_READY',
          },
          data: { currentState: 'ASK_ADVANCE_INTENT', lastActivityAt: new Date() },
        });
      } else if (delivery.kind === 'RESULT' && !lead.quote) {
        await tx.conversation.updateMany({
          where: {
            id: lead.conversation.id,
            accountId,

            status: 'ACTIVE',
            currentState: { in: ['HUMAN_REVIEW', 'SPECIAL_REVIEW'] },
          },
          data: {
            currentState: 'HANDOFF_TO_TATTOO_ARTIST',
            status: 'COMPLETED',
            lastActivityAt: new Date(),
          },
        });
      }
      return true;
    });
  }
}
