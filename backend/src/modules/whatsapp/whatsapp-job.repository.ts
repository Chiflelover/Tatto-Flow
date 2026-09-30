import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type Conversation,
  type WhatsAppChannel,
  type WhatsAppJob,
  type WhatsAppJobStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import type { WhatsAppOutboundMessage } from '../chatbot/whatsapp/whatsapp.adapter.js';

export type WhatsAppJobInput =
  | { type: 'text'; text: string }
  | { type: 'button_reply'; buttonId: string }
  | { type: 'image'; mediaId: string };
export const WHATSAPP_JOB_LEASE_MS = 300_000;

@Injectable()
export class WhatsAppJobRepository {
  private readonly logger = new SafeStructuredLogger(WhatsAppJobRepository.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async enqueueIfV2(
    messageId: string,
    channel: WhatsAppChannel,
    phoneNumber: string,
    input: WhatsAppJobInput,
  ) {
    const duplicate = await this.prisma.whatsAppJob.findUnique({
      where: { inboundMessageId: messageId },
      include: { customer: true },
    });
    if (duplicate) {
      if (
        duplicate.accountId !== channel.accountId ||
        duplicate.customer.phoneNumber !== phoneNumber
      )
        throw new BadRequestException('El mensaje no pertenece a este canal y cliente.');
      return { queued: true, accountId: channel.accountId, customerId: duplicate.customerId };
    }
    const customer = await this.prisma.customer.findUnique({
      where: { accountId_phoneNumber: { accountId: channel.accountId, phoneNumber } },
    });
    const latest = customer
      ? await this.prisma.conversation.findFirst({
          where: { accountId: channel.accountId, customerId: customer.id },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const active = customer
      ? await this.prisma.conversation.findFirst({
          where: {
            accountId: channel.accountId,
            customerId: customer.id,
            OR: [
              { status: 'ACTIVE' },
              {
                status: 'COMPLETED',
                currentState: 'HANDOFF_TO_TATTOO_ARTIST',
                lead: { is: { status: { not: 'COMPLETED' } } },
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const restarting = latest?.status === 'ABANDONED' && latest.flowVersion === 'V2';
    const pending = customer
      ? await this.prisma.whatsAppJob.findFirst({
          where: {
            accountId: channel.accountId,
            customerId: customer.id,
            status: { in: ['PENDING', 'PROCESSING', 'RETRYABLE', 'UNKNOWN'] },
          },
          select: { id: true },
        })
      : null;
    const flow = restarting
      ? 'V2'
      : (active?.flowVersion ??
        (pending ? 'V2' : (this.config.get<string>('NITA_DEFAULT_FLOW_VERSION') ?? 'V1')));
    if (flow !== 'V2') return { queued: false };
    const saved = await this.prisma.$transaction(async (tx) => {
      const ownedCustomer =
        customer ??
        (await tx.customer.upsert({
          where: { accountId_phoneNumber: { accountId: channel.accountId, phoneNumber } },
          update: {},
          create: { accountId: channel.accountId, phoneNumber },
        }));
      const inserted =
        await tx.$executeRaw`INSERT INTO whatsapp_inbound_messages (message_id) VALUES (${messageId}) ON CONFLICT (message_id) DO NOTHING`;
      if (inserted)
        await tx.whatsAppJob.create({
          data: {
            inboundMessageId: messageId,
            accountId: channel.accountId,
            channelId: channel.id,
            phoneNumberId: channel.phoneNumberId,
            customerId: ownedCustomer.id,
            conversationId: restarting ? null : active?.id,
            input,
          },
        });
      return ownedCustomer;
    });
    return { queued: true, accountId: channel.accountId, customerId: saved.id };
  }

  claim(accountId?: string, customerId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT j.id FROM whatsapp_jobs j
        WHERE ((j.status IN ('PENDING', 'RETRYABLE') AND j.available_at <= ${now})
          OR (j.status = 'PROCESSING' AND j.lease_until <= ${now}))
        ${accountId ? Prisma.sql`AND j.account_id = ${accountId}::uuid` : Prisma.empty}
        ${customerId ? Prisma.sql`AND j.customer_id = ${customerId}::uuid` : Prisma.empty}
        AND NOT EXISTS (SELECT 1 FROM whatsapp_jobs older
          WHERE older.account_id = j.account_id AND older.customer_id = j.customer_id
            AND older.status IN ('PENDING', 'PROCESSING', 'RETRYABLE', 'UNKNOWN')
            AND (older.created_at, older.id) < (j.created_at, j.id))
        ORDER BY j.created_at, j.id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!rows[0]) return null;
      return tx.whatsAppJob.update({
        where: { id: rows[0].id },
        data: {
          status: 'PROCESSING',
          claimId: randomUUID(),
          leaseUntil: new Date(now.getTime() + WHATSAPP_JOB_LEASE_MS),
          attemptCount: { increment: 1 },
          startedAt: now,
          lastErrorCode: null,
        },
      });
    });
  }

  async owned(job: WhatsAppJob, tx: Prisma.TransactionClient = this.prisma) {
    const current = await tx.whatsAppJob.findFirst({
      where: {
        id: job.id,
        accountId: job.accountId,
        claimId: job.claimId,
        status: 'PROCESSING',
        leaseUntil: { gt: new Date() },
      },
      include: { customer: true, channel: true, account: true },
    });
    if (!current) throw new ConflictException('El trabajo ya no pertenece a esta ejecución.');
    return current;
  }

  async checkpoint(
    tx: Prisma.TransactionClient,
    job: WhatsAppJob,
    conversation: Conversation | null,
    outbound: WhatsAppOutboundMessage[],
  ) {
    await tx.$queryRaw`SELECT id FROM whatsapp_jobs WHERE id = ${job.id}::uuid AND account_id = ${job.accountId}::uuid FOR UPDATE`;
    const current = await this.owned(job, tx);
    if (current.inputProcessedAt) return;
    if (
      conversation &&
      (conversation.accountId !== job.accountId ||
        conversation.customerId !== job.customerId ||
        conversation.flowVersion !== 'V2')
    )
      throw new ConflictException('La conversación no corresponde al trabajo.');
    if (conversation && job.conversationId && job.conversationId !== conversation.id) {
      const abandoned = await tx.conversation.findFirst({
        where: {
          id: job.conversationId,
          accountId: job.accountId,
          customerId: job.customerId,
          flowVersion: 'V2',
          status: 'ABANDONED',
        },
        select: { id: true },
      });
      if (!abandoned) throw new ConflictException('La conversación no corresponde al trabajo.');
    }
    const lead = conversation
      ? await tx.lead.findFirst({
          where: { accountId: job.accountId, conversationId: conversation.id },
          include: {
            images: { where: { deletedAt: null }, take: 1, orderBy: { createdAt: 'desc' } },
          },
        })
      : null;
    await tx.whatsAppJob.update({
      where: { id: job.id },
      data: {
        conversationId: conversation?.id,
        leadId: lead?.id,
        imageId: lead?.images[0]?.id,
        input: Prisma.DbNull,
        response: outbound,
        inputProcessedAt: new Date(),
      },
    });
    await tx.whatsAppDelivery.createMany({
      data: outbound.map((payload, sequence) => ({
        accountId: job.accountId,
        jobId: job.id,
        sequence,
        kind: 'INTAKE',
        payload,
      })),
      skipDuplicates: true,
    });
  }

  async finish(job: WhatsAppJob, status: WhatsAppJobStatus, errorCode: string | null = null) {
    const seconds = Math.min(300, 5 * 2 ** Math.min(job.attemptCount - 1, 6));
    const updated = await this.prisma.whatsAppJob.updateMany({
      where: { id: job.id, accountId: job.accountId, claimId: job.claimId, status: 'PROCESSING' },
      data: {
        status,
        lastErrorCode: errorCode,
        claimId: null,
        leaseUntil: null,
        availableAt: new Date(Date.now() + seconds * 1000),
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
    });
    if (updated.count)
      this.logger.info('whatsapp.job.settled', {
        jobId: job.id,
        accountId: job.accountId,
        conversationId: job.conversationId,
        state: status,
        attempt: job.attemptCount,
        errorCode,
        finishedAt: new Date().toISOString(),
      });
    return updated;
  }
}
