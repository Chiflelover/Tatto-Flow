import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  ConversationState,
  ConversationStatus,
  LeadStatus,
  Prisma,
  ReviewReason,
  type AiAnalysis,
  type Conversation,
  type Lead,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { LeadScoringService } from '../lead-scoring/lead-scoring.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { LeadImageService } from '../storage/lead-image.service.js';
import { ValidationService } from '../validation/validation.service.js';
import type { ImageAnalysisResult, TattooImageInput } from './domain/image-analysis.types.js';
import { toImageAnalysisResult } from './domain/persisted-image-analysis.js';
import { ImageAnalysisService } from './image-analysis.service.js';
import { GeminiImageAnalysisError } from './gemini-image-analysis.service.js';

export interface QuotationPricingSnapshot {
  ruleId: string;
  version: number;
  minPrice: string;
  maxPrice: string;
}

export interface CompletedImageAnalysis {
  analysis: ImageAnalysisResult | null;
  conversation: Conversation;
  quotation: {
    status: LeadStatus;
    reviewReasons: ReviewReason[];
    pricingRule: QuotationPricingSnapshot | null;
  };
}

@Injectable()
export class ImageAnalysisWorkflowService {
  private readonly logger = new SafeStructuredLogger(ImageAnalysisWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ImageAnalysisService)
    private readonly imageAnalysisService: ImageAnalysisService,
    @Inject(ValidationService)
    private readonly validationService: ValidationService,
    @Inject(PricingService)
    private readonly pricingService: PricingService,
    @Inject(LeadImageService)
    private readonly leadImageService: LeadImageService,
    @Inject(LeadScoringService)
    private readonly leadScoringService: LeadScoringService,
  ) {}

  async analyzeConversationImage(
    conversationId: string,
    image: TattooImageInput,
  ): Promise<CompletedImageAnalysis> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new ConflictException('La conversación ya no está disponible.');
    }

    const finalizedResult = await this.findFinalizedResult(conversation);

    if (finalizedResult) {
      return finalizedResult;
    }

    const storedAnalysis = await this.findPendingStoredAnalysis(conversation);

    if (storedAnalysis) {
      return this.persistAnalysisAndFinalize(
        conversation,
        storedAnalysis.leadId,
        toImageAnalysisResult(storedAnalysis),
      );
    }

    if (
      conversation.status !== ConversationStatus.ACTIVE ||
      conversation.currentState !== ConversationState.ANALYZING ||
      !conversation.selectedSize ||
      !conversation.selectedDetail ||
      !conversation.bodyPart
    ) {
      throw new ConflictException('La conversación no está lista para analizar una imagen.');
    }

    const lead = await this.prisma.lead.upsert({
      where: { conversationId: conversation.id },
      update: {},
      create: {
        customerId: conversation.customerId,
        conversationId: conversation.id,
        selectedSize: conversation.selectedSize,
        selectedDetail: conversation.selectedDetail,
        bodyPart: conversation.bodyPart,
      },
    });
    this.logger.info('workflow.lead.available', {
      conversationId: conversation.id,
      leadId: lead.id,
    });

    await this.leadImageService.ensureStored(lead.id, image);

    let result: ImageAnalysisResult;
    const analysisStartedAt = Date.now();

    this.logger.info('ai.analysis.started', {
      conversationId: conversation.id,
      leadId: lead.id,
      provider: this.imageAnalysisService.providerName,
    });

    try {
      result = await this.imageAnalysisService.analyzeTattooImage(image, { leadId: lead.id });
      this.logger.info('ai.analysis.completed', {
        conversationId: conversation.id,
        leadId: lead.id,
        provider: this.imageAnalysisService.providerName,
        durationMs: Date.now() - analysisStartedAt,
        result: 'success',
      });
    } catch (error) {
      this.logAnalysisFailure(error, conversation.id, lead.id, analysisStartedAt);
      return this.persistFailedAnalysisAndFinalize(conversation, lead.id);
    }

    return this.persistAnalysisAndFinalize(conversation, lead.id, result);
  }

  private async findFinalizedResult(
    conversation: Conversation,
  ): Promise<CompletedImageAnalysis | null> {
    if (
      conversation.status !== ConversationStatus.COMPLETED ||
      conversation.currentState !== ConversationState.HANDOFF_TO_TATTOO_ARTIST
    ) {
      return null;
    }

    const lead = await this.prisma.lead.findUnique({
      where: { conversationId: conversation.id },
      include: { aiAnalysis: true },
    });

    if (!lead || !this.isFinalLeadStatus(lead.status)) {
      return null;
    }

    return this.toCompletedResult(conversation, lead, lead.aiAnalysis);
  }

  private async findPendingStoredAnalysis(conversation: Conversation): Promise<AiAnalysis | null> {
    if (
      conversation.status !== ConversationStatus.ACTIVE ||
      conversation.currentState !== ConversationState.VALIDATING
    ) {
      return null;
    }

    const lead = await this.prisma.lead.findUnique({
      where: { conversationId: conversation.id },
      include: { aiAnalysis: true },
    });

    return lead?.status === LeadStatus.ANALYZING ? lead.aiAnalysis : null;
  }

  private async persistAnalysisAndFinalize(
    conversation: Conversation,
    leadId: string,
    result: ImageAnalysisResult,
  ): Promise<CompletedImageAnalysis> {
    const selectedSize = conversation.selectedSize;
    const selectedDetail = conversation.selectedDetail;

    if (!selectedSize || !selectedDetail) {
      throw new ConflictException('La conversación no contiene una cotización completa.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const analysis = await transaction.aiAnalysis.upsert({
        where: { leadId },
        update: {},
        create: {
          leadId,
          detectedSize: result.detectedSize,
          sizeConfidence: result.sizeConfidence,
          detectedDetail: result.detectedDetail,
          detailConfidence: result.detailConfidence,
          rawResponse: {
            provider: this.imageAnalysisService.providerName,
            ...result,
          },
        },
      });

      await transaction.conversation.updateMany({
        where: {
          id: conversation.id,
          status: ConversationStatus.ACTIVE,
          currentState: ConversationState.ANALYZING,
        },
        data: {
          currentState: ConversationState.VALIDATING,
          lastActivityAt: new Date(),
        },
      });

      const persistedAnalysis = toImageAnalysisResult(analysis);
      const evaluation = await this.leadScoringService.evaluateAndPersist(
        leadId,
        {
          selectedSize,
          selectedDetail,
          bodyPart: conversation.bodyPart,
          referenceReceived: true,
          conversationStatus: conversation.status,
          analysis: persistedAnalysis,
        },
        transaction,
      );
      const validation = this.validationService.validate({
        selectedSize,
        selectedDetail,
        analysis: persistedAnalysis,
      });
      let status = validation.verified ? LeadStatus.VERIFIED : LeadStatus.REQUIRES_REVIEW;
      let reviewReasons = validation.reviewReasons;
      let pricingRule = null;
      const referenceIsNotOnSkin = evaluation.blockers.some(
        (blocker) => blocker.ruleId === 'NOT_ON_SKIN',
      );

      if (referenceIsNotOnSkin) {
        status = LeadStatus.REQUIRES_REVIEW;
        reviewReasons = Array.from(new Set([...reviewReasons, ReviewReason.NOT_ON_SKIN]));
      }

      if (validation.verified && !referenceIsNotOnSkin) {
        pricingRule = await this.pricingService.findActiveRule(
          selectedSize,
          selectedDetail,
          transaction,
        );

        if (!pricingRule) {
          status = LeadStatus.REQUIRES_REVIEW;
          reviewReasons = [ReviewReason.PRICING_RULE_NOT_FOUND];
          this.logger.error('workflow.pricing_rule.missing', { leadId });
        }
      }

      const leadUpdate = await transaction.lead.updateMany({
        where: {
          id: leadId,
          status: LeadStatus.ANALYZING,
        },
        data: {
          status,
          reviewReasons,
          calculatedMinPrice: pricingRule?.minPrice ?? null,
          calculatedMaxPrice: pricingRule?.maxPrice ?? null,
          pricingRuleId: pricingRule?.id ?? null,
          pricingRuleVersion: pricingRule?.version ?? null,
        },
      });

      const finalizedLead = await transaction.lead.findUniqueOrThrow({
        where: { id: leadId },
      });

      if (leadUpdate.count === 0 && !this.isFinalLeadStatus(finalizedLead.status)) {
        throw new ConflictException('El lead no pudo finalizarse de forma consistente.');
      }

      await transaction.conversation.updateMany({
        where: {
          id: conversation.id,
          status: ConversationStatus.ACTIVE,
          currentState: {
            in: [ConversationState.ANALYZING, ConversationState.VALIDATING],
          },
        },
        data: {
          currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
          status: ConversationStatus.COMPLETED,
          lastActivityAt: new Date(),
        },
      });

      const finalizedConversation = await transaction.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });

      this.logFinalWorkflowStatus(conversation.id, finalizedLead);

      return this.toCompletedResult(finalizedConversation, finalizedLead, analysis);
    });
  }

  private toCompletedResult(
    conversation: Conversation,
    lead: Lead,
    analysis: AiAnalysis | null,
  ): CompletedImageAnalysis {
    return {
      conversation,
      analysis: analysis ? toImageAnalysisResult(analysis) : null,
      quotation: {
        status: lead.status,
        reviewReasons: lead.reviewReasons,
        pricingRule:
          lead.pricingRuleId &&
          lead.pricingRuleVersion !== null &&
          lead.calculatedMinPrice &&
          lead.calculatedMaxPrice
            ? {
                ruleId: lead.pricingRuleId,
                version: lead.pricingRuleVersion,
                minPrice: this.formatMoney(lead.calculatedMinPrice),
                maxPrice: this.formatMoney(lead.calculatedMaxPrice),
              }
            : null,
      },
    };
  }

  private async persistFailedAnalysisAndFinalize(
    conversation: Conversation,
    leadId: string,
  ): Promise<CompletedImageAnalysis> {
    return this.prisma.$transaction(async (transaction) => {
      const leadUpdate = await transaction.lead.updateMany({
        where: {
          id: leadId,
          status: LeadStatus.ANALYZING,
        },
        data: {
          status: LeadStatus.REQUIRES_REVIEW,
          reviewReasons: [ReviewReason.AI_ERROR],
          calculatedMinPrice: null,
          calculatedMaxPrice: null,
          pricingRuleId: null,
          pricingRuleVersion: null,
        },
      });

      if (leadUpdate.count > 0) {
        await this.leadScoringService.evaluateAndPersist(
          leadId,
          {
            selectedSize: conversation.selectedSize,
            selectedDetail: conversation.selectedDetail,
            bodyPart: conversation.bodyPart,
            referenceReceived: true,
            conversationStatus: conversation.status,
            analysis: null,
          },
          transaction,
        );

        await transaction.conversation.updateMany({
          where: {
            id: conversation.id,
            status: ConversationStatus.ACTIVE,
            currentState: {
              in: [ConversationState.ANALYZING, ConversationState.VALIDATING],
            },
          },
          data: {
            currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
            status: ConversationStatus.COMPLETED,
            lastActivityAt: new Date(),
          },
        });
      }

      const finalizedLead = await transaction.lead.findUniqueOrThrow({
        where: { id: leadId },
        include: { aiAnalysis: true },
      });

      if (!this.isFinalLeadStatus(finalizedLead.status)) {
        throw new ConflictException('El lead no pudo enviarse a revisión de forma consistente.');
      }

      const finalizedConversation = await transaction.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });

      this.logFinalWorkflowStatus(conversation.id, finalizedLead);

      return this.toCompletedResult(finalizedConversation, finalizedLead, finalizedLead.aiAnalysis);
    });
  }

  private formatMoney(value: Prisma.Decimal): string {
    return value
      .toFixed(2)
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  }

  private isFinalLeadStatus(status: LeadStatus): boolean {
    return status === LeadStatus.VERIFIED || status === LeadStatus.REQUIRES_REVIEW;
  }

  private logAnalysisFailure(
    error: unknown,
    conversationId: string,
    leadId: string,
    startedAt: number,
  ): void {
    const code = error instanceof GeminiImageAnalysisError ? error.code : 'PROVIDER_ERROR';
    const eventByCode: Partial<Record<GeminiImageAnalysisError['code'], string>> = {
      RATE_LIMITED: 'ai.analysis.rate_limited',
      TIMEOUT: 'ai.analysis.timeout',
      INVALID_RESPONSE: 'ai.analysis.invalid_response',
    };

    this.logger.error(
      eventByCode[code as GeminiImageAnalysisError['code']] ?? 'ai.analysis.failed',
      {
        conversationId,
        leadId,
        provider: this.imageAnalysisService.providerName,
        durationMs: Date.now() - startedAt,
        result: 'failure',
        errorCode: code,
      },
    );
  }

  private logFinalWorkflowStatus(conversationId: string, lead: Lead): void {
    const event =
      lead.status === LeadStatus.VERIFIED ? 'workflow.lead.ready' : 'workflow.lead.review_required';

    this.logger.info(event, { conversationId, leadId: lead.id });
  }
}
