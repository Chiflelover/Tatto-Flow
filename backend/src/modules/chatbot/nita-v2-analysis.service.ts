import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type Conversation } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { v2IntakeSnapshot } from '../conversations/conversation-v2-intake.js';
import { AIProviderError } from '../image-analysis/ai-provider.error.js';
import type { ImageAnalysisV2Result } from '../image-analysis/domain/image-analysis-v2.types.js';
import { ImageAnalysisV2Service } from '../image-analysis/image-analysis-v2.service.js';
import { validateLeadImageFile } from '../storage/lead-image-file.js';
import { StorageService } from '../storage/storage.service.js';
import {
  isValidV2Analysis,
  prepareV2Case,
  type V2ReviewReason,
} from './domain/nita-v2-decision.js';
import {
  V2_INVALID_REFERENCE_MESSAGE,
  V2_TARGET_SIZE_AFTER_ANALYSIS_QUESTION,
} from './domain/nita-v2-messages.js';

// Technical deadlines: allow the existing Gemini retries and OpenAI fallback to finish.
export const V2_ANALYSIS_TIMEOUT_MS = 90_000;
export const V2_ANALYSIS_LEASE_MS = 120_000;

export class V2AnalysisRetryableError extends ServiceUnavailableException {
  constructor() {
    super('El análisis temporalmente no disponible quedó pendiente.');
  }
}
class AnalysisDeadlineError extends Error {}

const ownedConversation = (accountId: string, id: string) => ({
  where: { id, accountId },
  include: {
    account: { select: { isActive: true } },
    lead: {
      include: {
        aiAnalysis: true,
        images: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' as const }, take: 1 },
      },
    },
  },
});

@Injectable()
export class NitaV2AnalysisService {
  private readonly logger = new SafeStructuredLogger(NitaV2AnalysisService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ImageAnalysisV2Service) private readonly vision: ImageAnalysisV2Service,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async resumePendingForCustomer(accountId: string, phoneNumber: string): Promise<void> {
    const pending = await this.prisma.conversation.findFirst({
      where: {
        accountId,

        status: 'ACTIVE',
        currentState: { in: ['READY_FOR_ANALYSIS', 'ANALYZING'] },
        customer: { phoneNumber },
      },
      select: { id: true },
    });
    if (!pending) return;
    const result = await this.process(accountId, pending.id);
    // A duplicate delivery must remain retryable until the active claim completes or expires.
    if (result.currentState === 'ANALYZING')
      throw new ServiceUnavailableException('El análisis sigue en proceso. Reintenta más tarde.');
  }

  async process(
    accountId: string,
    conversationId: string,
    options: { retryTransientFailures?: boolean } = {},
  ): Promise<Conversation> {
    const claim = await this.claim(accountId, conversationId);
    if (!claim.attemptId) return claim.conversation;
    const attemptId = claim.attemptId;
    try {
      let result: ImageAnalysisV2Result | undefined;
      let failure: V2ReviewReason = 'ANALYSIS_FAILED';
      if (!claim.conversation.lead?.aiAnalysis) {
        const reference = claim.conversation.lead?.images[0];
        let image;
        try {
          if (!reference) throw new Error('Reference unavailable');
          image = await this.withDeadline(this.storage.download(reference.storagePath), 20_000);
          validateLeadImageFile(image);
        } catch {
          image = undefined;
          failure = 'REFERENCE_UNAVAILABLE';
        }
        if (image) {
          try {
            result = await this.withDeadline(
              this.vision.analyzeReference(image, { leadId: claim.conversation.lead!.id }),
              V2_ANALYSIS_TIMEOUT_MS,
            );
            if (!isValidV2Analysis(result.observations)) {
              result = undefined;
              failure = 'INVALID_ANALYSIS';
            }
          } catch (error) {
            if (
              options.retryTransientFailures &&
              ((error instanceof AIProviderError && error.retryable) ||
                error instanceof AnalysisDeadlineError)
            )
              throw new V2AnalysisRetryableError();
            failure =
              error instanceof AIProviderError && error.category === 'INVALID_RESPONSE'
                ? 'INVALID_ANALYSIS'
                : 'ANALYSIS_FAILED';
            this.logger.error('workflow.v2.analysis_failed', {
              conversationId,
              errorCode: failure,
            });
          }
        }
      }
      return await this.finalize(accountId, conversationId, attemptId, result, failure);
    } catch (error) {
      // A failure releases ownership so a durable job retry can resume immediately.
      // If the DB is unavailable, the persistent lease still expires for a later retry.
      try {
        await this.prisma.conversation.updateMany({
          where: {
            id: conversationId,
            accountId,

            status: 'ACTIVE',
            currentState: 'ANALYZING',
            v2AnalysisClaimId: attemptId,
          },
          data: { v2AnalysisClaimId: null, v2AnalysisLeaseUntil: null },
        });
      } catch {
        this.logger.error('workflow.v2.claim_release_failed', { conversationId });
      }
      throw error;
    }
  }

  private claim(accountId: string, conversationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, accountId, conversationId);
      const conversation = await tx.conversation.findFirst(
        ownedConversation(accountId, conversationId),
      );
      if (!conversation)
        throw new NotFoundException('Conversación no disponible para esta cuenta.');
      if (
        conversation.lead &&
        (conversation.lead.accountId !== accountId ||
          conversation.lead.customerId !== conversation.customerId)
      )
        throw new ConflictException('El lead no pertenece a esta cuenta y cliente.');
      if (!conversation.account.isActive)
        throw new ForbiddenException('La cuenta está desactivada.');
      const now = new Date();
      if (
        conversation.status !== 'ACTIVE' ||
        !['READY_FOR_ANALYSIS', 'ANALYZING'].includes(conversation.currentState) ||
        (conversation.currentState === 'ANALYZING' &&
          conversation.v2AnalysisClaimId &&
          conversation.v2AnalysisLeaseUntil &&
          conversation.v2AnalysisLeaseUntil > now)
      )
        return { conversation, attemptId: null };

      const attemptId = randomUUID();
      const updated = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          currentState: 'ANALYZING',
          v2AnalysisClaimId: attemptId,
          v2AnalysisLeaseUntil: new Date(now.getTime() + V2_ANALYSIS_LEASE_MS),
          lastActivityAt: now,
        },
      });
      return { conversation: { ...conversation, ...updated }, attemptId };
    });
  }

  private finalize(
    accountId: string,
    conversationId: string,
    attemptId: string,
    result: ImageAnalysisV2Result | undefined,
    failure: V2ReviewReason,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, accountId, conversationId);
      const conversation = await tx.conversation.findFirst(
        ownedConversation(accountId, conversationId),
      );
      if (!conversation)
        throw new NotFoundException('Conversación no disponible para esta cuenta.');
      if (
        conversation.status !== 'ACTIVE' ||
        conversation.currentState !== 'ANALYZING' ||
        conversation.v2AnalysisClaimId !== attemptId
      )
        return conversation;
      const lead =
        conversation.lead ??
        (await tx.lead.create({
          data: {
            accountId,
            customerId: conversation.customerId,
            conversationId,
            ...v2IntakeSnapshot(conversation),
          },
        }));
      if (lead.accountId !== accountId || lead.customerId !== conversation.customerId)
        throw new ConflictException('El lead no pertenece a esta cuenta y cliente.');
      let analysis = conversation.lead?.aiAnalysis ?? null;
      if (!analysis && result)
        analysis = await this.vision.persistLeadReference(tx, accountId, lead.id, result);
      const style =
        analysis?.validTattooReference !== false && analysis?.style
          ? await tx.tattooStyle.findUnique({
              where: { code: analysis.style },
              select: {
                id: true,
                artistStyles: {
                  where: { accountId, isEnabled: true },
                  select: { accountId: true },
                },
                modelVersions: {
                  where: { accountId, status: 'ACTIVE' },
                  select: { algorithmVersion: true },
                },
              },
            })
          : null;
      const preparation = prepareV2Case(
        conversation,
        analysis,
        {
          exists: !!style,
          enabled: (style?.artistStyles.length ?? 0) > 0,
          pricingAlgorithmVersion: style?.modelVersions?.[0]?.algorithmVersion,
        },
        failure,
      );
      await tx.lead.update({
        where: { id: lead.id, accountId },
        data: {
          v2Preparation: preparation as unknown as Prisma.InputJsonValue,
          ...(preparation.decision === 'INVALID_REFERENCE' ? { status: 'COMPLETED' as const } : {}),
        },
      });
      if (
        preparation.decision === 'ASK_TARGET_SIZE_AFTER_ANALYSIS' ||
        preparation.decision === 'INVALID_REFERENCE'
      ) {
        const kind =
          preparation.decision === 'INVALID_REFERENCE' ? 'INVALID_REFERENCE' : 'TARGET_SIZE';
        await tx.whatsAppDelivery.upsert({
          where: { leadId_kind: { leadId: lead.id, kind } },
          update: {},
          create: {
            accountId,
            leadId: lead.id,
            kind,
            payload: {
              type: 'text',
              text:
                kind === 'INVALID_REFERENCE'
                  ? V2_INVALID_REFERENCE_MESSAGE
                  : V2_TARGET_SIZE_AFTER_ANALYSIS_QUESTION,
            },
          },
        });
      }
      return tx.conversation.update({
        where: { id: conversationId },
        data: {
          currentState: preparation.decision,
          ...(preparation.decision === 'INVALID_REFERENCE' ? { status: 'COMPLETED' as const } : {}),
          v2AnalysisClaimId: null,
          v2AnalysisLeaseUntil: null,
          lastActivityAt: new Date(),
        },
      });
    });
  }

  private lock(tx: Prisma.TransactionClient, accountId: string, id: string) {
    return tx.$queryRaw`SELECT id FROM conversations WHERE id = ${id}::uuid AND account_id = ${accountId}::uuid FOR UPDATE`;
  }

  private async withDeadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new AnalysisDeadlineError('Analysis deadline exceeded')),
            milliseconds,
          );
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
