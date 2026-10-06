import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type WhatsAppJob } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import {
  WhatsAppAdapter,
  type WhatsAppInboundMessage,
} from '../chatbot/whatsapp/whatsapp.adapter.js';
import { NitaV2AnalysisService } from '../chatbot/nita-v2-analysis.service.js';
import { NitaV2CompletionService } from '../chatbot/nita-v2-completion.service.js';
import { WhatsAppCloudApiClient } from './whatsapp-cloud-api.client.js';
import { WhatsAppJobRepository, type WhatsAppJobInput } from './whatsapp-job.repository.js';
import { WhatsAppV2DeliveryService } from './whatsapp-v2-delivery.service.js';

@Injectable()
export class WhatsAppJobProcessor {
  private readonly logger = new SafeStructuredLogger(WhatsAppJobProcessor.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WhatsAppJobRepository) private readonly jobs: WhatsAppJobRepository,
    @Inject(WhatsAppAdapter) private readonly adapter: WhatsAppAdapter,
    @Inject(WhatsAppCloudApiClient) private readonly cloud: WhatsAppCloudApiClient,
    @Inject(NitaV2AnalysisService) private readonly analysis: NitaV2AnalysisService,
    @Inject(NitaV2CompletionService) private readonly completion: NitaV2CompletionService,
    @Inject(WhatsAppV2DeliveryService) private readonly delivery: WhatsAppV2DeliveryService,
  ) {}

  async runNext(accountId?: string, customerId?: string) {
    const job = await this.jobs.claim(accountId, customerId);
    if (!job) return { processed: false };
    let stage = 'INPUT';
    this.logger.info('whatsapp.job.started', {
      jobId: job.id,
      accountId: job.accountId,
      conversationId: job.conversationId,
      state: job.status,
      attempt: job.attemptCount,
      startedAt: job.startedAt?.toISOString() ?? null,
    });
    try {
      let owned = await this.jobs.owned(job);
      if (!owned.account.isActive) {
        await this.jobs.finish(job, 'FAILED', 'ACCOUNT_INACTIVE');
        return { processed: true, jobId: job.id, status: 'FAILED' };
      }
      if (owned.channel.phoneNumberId !== job.phoneNumberId)
        throw new BadRequestException('El canal del trabajo cambió.');
      if (job.conversationId) {
        const conversation = await this.prisma.conversation.findFirst({
          where: {
            id: job.conversationId,
            accountId: job.accountId,
            customerId: job.customerId,
          },
        });
        if (!conversation || (owned.inputProcessedAt && conversation.status === 'ABANDONED'))
          throw new BadRequestException('La conversación del trabajo ya no está disponible.');
      }
      if (!owned.inputProcessedAt) {
        const input = owned.input as unknown as WhatsAppJobInput | null;
        if (!input) throw new BadRequestException('Falta el input del trabajo.');
        const base = { accountId: job.accountId, customerIdentifier: owned.customer.phoneNumber };
        let inbound: WhatsAppInboundMessage;
        if (input.type === 'image')
          inbound = {
            ...base,
            type: 'image',
            image: await this.cloud.downloadImage(
              job.phoneNumberId,
              input.mediaId,
              AbortSignal.timeout(20_000),
            ),
          };
        else inbound = { ...base, ...input };
        const outbound = await this.adapter.handleIncoming(
          inbound,
          { interactiveButtons: true },
          {
            checkpoint: (tx, conversation, response) =>
              this.jobs.checkpoint(
                tx,
                job,
                conversation,
                this.adapter.toWhatsAppMessages(response, { interactiveButtons: true }),
              ),
          },
        );
        // Read-only/ignored inputs have no transition transaction to attach the receipt to.
        await this.prisma.$transaction(async (tx) => {
          const current = await this.jobs.owned(job, tx);
          if (current.inputProcessedAt) return;
          const conversation = await tx.conversation.findFirst({
            where: {
              accountId: job.accountId,
              customerId: job.customerId,
              ...(job.conversationId
                ? { id: job.conversationId }
                : {
                    OR: [
                      { status: 'ACTIVE' },
                      {
                        status: 'COMPLETED',
                        currentState: 'HANDOFF_TO_TATTOO_ARTIST',
                        lead: { is: { status: { not: 'COMPLETED' } } },
                      },
                    ],
                  }),
            },
            orderBy: { createdAt: 'desc' },
          });
          await this.jobs.checkpoint(tx, job, conversation, outbound);
        });
      }
      owned = await this.jobs.owned(job);
      stage = 'DELIVERY';
      if ((await this.delivery.deliverForJob(owned, owned.customer.phoneNumber)) === 'UNKNOWN') {
        return await this.settleUncertainDelivery(owned);
      }
      if (owned.conversationId) {
        stage = 'ANALYSIS';
        await this.jobs.owned(job);
        const prepared = await this.analysis.process(job.accountId, owned.conversationId, {
          retryTransientFailures: true,
        });
        if (prepared.currentState === 'ANALYZING')
          throw new Error('Analysis still owned by another attempt');
        stage = 'PRICING';
        await this.jobs.owned(job);
        await this.completion.prepare(job.accountId, owned.conversationId);
        stage = 'DELIVERY';
        await this.jobs.owned(job);
        if (
          (await this.delivery.deliverForCustomer(
            job.accountId,
            job.phoneNumberId,
            owned.customer.phoneNumber,
          )) === 'UNKNOWN'
        ) {
          return await this.settleUncertainDelivery(owned);
        }
      }
      await this.jobs.finish(job, 'COMPLETED');
      this.logger.info('whatsapp.job.completed', {
        jobId: job.id,
        accountId: job.accountId,
        conversationId: owned.conversationId,
        attempt: job.attemptCount,
        finishedAt: new Date().toISOString(),
      });
      return { processed: true, jobId: job.id, status: 'COMPLETED' };
    } catch (error) {
      const account = await this.prisma.tattooArtistAccount.findUnique({
        where: { id: job.accountId },
        select: { isActive: true },
      });
      const inactive = !account?.isActive;
      const terminal = inactive || error instanceof BadRequestException;
      const code = inactive ? 'ACCOUNT_INACTIVE' : `${stage}_${terminal ? 'FAILED' : 'RETRYABLE'}`;
      await this.jobs.finish(job, terminal ? 'FAILED' : 'RETRYABLE', code);
      this.logger.error('whatsapp.job.failed', {
        jobId: job.id,
        accountId: job.accountId,
        conversationId: job.conversationId,
        attempt: job.attemptCount,
        errorCode: code,
        errorKind: error instanceof Prisma.PrismaClientKnownRequestError ? 'DATABASE' : stage,
      });
      return { processed: true, jobId: job.id, status: terminal ? 'FAILED' : 'RETRYABLE' };
    }
  }

  private async settleUncertainDelivery(job: WhatsAppJob) {
    // A transaction acknowledgement can be lost even though sentAt committed.
    // Re-read durable evidence; only an unresolved send blocks automatic recovery.
    const unresolved = await this.prisma.whatsAppDelivery.findFirst({
      where: {
        accountId: job.accountId,
        sentAt: null,
        AND: [
          { OR: [{ jobId: job.id }, ...(job.leadId ? [{ leadId: job.leadId }] : [])] },
          { OR: [{ lastErrorCode: 'DELIVERY_UNKNOWN' }, { claimId: { not: null } }] },
        ],
      },
      select: { id: true },
    });
    const status = unresolved ? 'UNKNOWN' : 'RETRYABLE';
    await this.jobs.finish(
      job,
      status,
      unresolved ? 'DELIVERY_UNKNOWN' : 'DELIVERY_CONFIRMATION_PENDING',
    );
    return { processed: true, jobId: job.id, status };
  }
}
