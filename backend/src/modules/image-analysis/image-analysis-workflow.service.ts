import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
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
import { LeadScoringService } from '../lead-scoring/lead-scoring.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { LeadImageService } from '../storage/lead-image.service.js';
import { ValidationService } from '../validation/validation.service.js';
import type { ImageAnalysisResult, TattooImageInput } from './domain/image-analysis.types.js';
import { toImageAnalysisResult } from './domain/persisted-image-analysis.js';
import { ImageAnalysisService } from './image-analysis.service.js';

export interface QuotationPricingSnapshot {
  ruleId: string;
  version: number;
  minPrice: string;
  maxPrice: string;
}

export interface CompletedImageAnalysis {
  analysis: ImageAnalysisResult;
  conversation: Conversation;
  quotation: {
    status: LeadStatus;
    reviewReasons: ReviewReason[];
    pricingRule: QuotationPricingSnapshot | null;
  };
}

@Injectable()
export class ImageAnalysisWorkflowService {
  private readonly logger = new Logger(ImageAnalysisWorkflowService.name);

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

    await this.leadImageService.ensureStored(lead.id, image);

    let result: ImageAnalysisResult;

    try {
      result = await this.imageAnalysisService.analyzeTattooImage(image);
    } catch {
      this.logger.error(`Image analysis failed for lead ${lead.id}.`);
      throw new ServiceUnavailableException(
        'No fue posible analizar la imagen. La información del lead quedó guardada.',
      );
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

    if (!lead?.aiAnalysis || !this.isFinalLeadStatus(lead.status)) {
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
          this.logger.error(
            `No active pricing rule for ${selectedSize}/${selectedDetail} (lead ${leadId}).`,
          );
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

      return this.toCompletedResult(finalizedConversation, finalizedLead, analysis);
    });
  }

  private toCompletedResult(
    conversation: Conversation,
    lead: Lead,
    analysis: AiAnalysis,
  ): CompletedImageAnalysis {
    return {
      conversation,
      analysis: toImageAnalysisResult(analysis),
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

  private formatMoney(value: Prisma.Decimal): string {
    return value
      .toFixed(2)
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  }

  private isFinalLeadStatus(status: LeadStatus): boolean {
    return status === LeadStatus.VERIFIED || status === LeadStatus.REQUIRES_REVIEW;
  }
}
