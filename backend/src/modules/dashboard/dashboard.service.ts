import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AnalysisVersion,
  ConversationStatus,
  LeadStatus,
  Prisma,
  ReadinessStatus,
  type PricingRule,
  type ReviewReason,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { PricingService, type PricingRulePriceUpdate } from '../pricing/pricing.service.js';
import { StorageService } from '../storage/storage.service.js';
import { toImageAnalysisResult } from '../image-analysis/domain/persisted-image-analysis.js';
import {
  buildWhatsappUrl,
  detailLabel,
  formatMoney,
  reviewReasonMessage,
  sizeLabel,
  sizeRangeLabel,
  statusLabel,
} from './domain/dashboard-labels.js';
import type {
  LeadFilter,
  LeadListQueryDto,
  LeadSortField,
  SortOrder,
} from './dto/dashboard.dto.js';
import { v2PreparationFromJson } from '../chatbot/domain/nita-v2-decision.js';

const SUMMARY_INCLUDE = {
  conversation: { select: { flowVersion: true } },
  quote: {
    select: {
      id: true,
      amount: true,
      currency: true,
      detectedStyle: true,
      targetAreaCm2: true,
      targetColorCoverage: true,
      pricingModelVersionId: true,
      algorithmVersion: true,
      createdAt: true,
    },
  },
  customer: { select: { phoneNumber: true } },
  evaluation: true,
  aiAnalysis: {
    select: {
      analysisVersion: true,
      sizeConfidence: true,
      detailConfidence: true,
      style: true,
    },
  },
} satisfies Prisma.LeadInclude;

const DETAIL_INCLUDE = {
  conversation: { select: { flowVersion: true } },
  quote: SUMMARY_INCLUDE.quote,
  customer: { select: { phoneNumber: true } },
  aiAnalysis: true,
  evaluation: true,
} satisfies Prisma.LeadInclude;

type SummaryLead = Prisma.LeadGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type DetailLead = Prisma.LeadGetPayload<{ include: typeof DETAIL_INCLUDE }>;
interface LeadDeletionCandidate {
  status: LeadStatus;
  manualFinalPrice: Prisma.Decimal | null;
  calculatedMinPrice: Prisma.Decimal | null;
  calculatedMaxPrice: Prisma.Decimal | null;
  evaluation: { readinessStatus: ReadinessStatus } | null;
  quote?: { id: string } | null;
}

const RETAINED_IMAGE_MESSAGE = 'Imagen no disponible.';
const SIGNED_URL_TTL_SECONDS = 5 * 60;
const COMPLETABLE_LEAD_STATUSES = [
  LeadStatus.VERIFIED,
  LeadStatus.REQUIRES_REVIEW,
  LeadStatus.HANDOFF_TO_TATTOO_ARTIST,
  LeadStatus.AUTO_QUOTED,
  LeadStatus.SPECIAL_REVIEW,
  LeadStatus.READY_TO_COORDINATE,
];

@Injectable()
export class DashboardService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(PricingService)
    private readonly pricingService: PricingService,
    @Inject(StorageService)
    private readonly storage: StorageService,
  ) {}

  async getMetrics(accountId: string) {
    const [newOrders, verified, requiresReview, completed, recentLeads] = await Promise.all([
      this.prisma.lead.count({
        where: {
          accountId,
          archivedAt: null,
          status: {
            in: [
              LeadStatus.ANALYZING,
              LeadStatus.VERIFIED,
              LeadStatus.REQUIRES_REVIEW,
              LeadStatus.AUTO_QUOTED,
              LeadStatus.SPECIAL_REVIEW,
              LeadStatus.READY_TO_COORDINATE,
            ],
          },
        },
      }),
      this.prisma.lead.count({
        where: {
          accountId,
          archivedAt: null,
          status: {
            in: [LeadStatus.VERIFIED, LeadStatus.AUTO_QUOTED, LeadStatus.READY_TO_COORDINATE],
          },
        },
      }),
      this.prisma.lead.count({
        where: {
          accountId,
          archivedAt: null,
          status: { in: [LeadStatus.REQUIRES_REVIEW, LeadStatus.SPECIAL_REVIEW] },
        },
      }),
      this.prisma.lead.count({
        where: { accountId, archivedAt: null, status: LeadStatus.COMPLETED },
      }),
      this.prisma.lead.findMany({
        where: { accountId, archivedAt: null },
        include: SUMMARY_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    return {
      totals: { newOrders, verified, requiresReview, completed },
      recentLeads: recentLeads.map((lead) => this.toSummary(lead)),
    };
  }

  async listLeads(accountId: string, query: LeadListQueryDto) {
    const where = this.filterWhere(accountId, query);
    const skip = (query.page - 1) * query.pageSize;
    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: this.orderBy(query.sortBy, query.sortOrder),
        skip,
        take: query.pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      leads: leads.map((lead) => this.toSummary(lead)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async getLead(accountId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      include: DETAIL_INCLUDE,
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    return this.toDetail(lead);
  }

  async getLeadReference(accountId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: {
        id: true,
        images: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, storagePath: true },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    const image = lead.images[0];

    if (!image) {
      return this.unavailableReference();
    }

    try {
      if (!(await this.storage.exists(image.storagePath))) {
        return this.unavailableReference();
      }

      return {
        available: true,
        imageId: image.id,
        signedUrl: await this.storage.createSignedUrl(image.storagePath, SIGNED_URL_TTL_SECONDS),
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
        message: null,
      };
    } catch {
      throw new ServiceUnavailableException(
        'No pudimos cargar la imagen de referencia. Inténtalo nuevamente.',
      );
    }
  }

  async completeLead(accountId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: { status: true, conversation: { select: { id: true, flowVersion: true } } },
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    if (lead.conversation?.flowVersion === 'V2') {
      const conversationId = lead.conversation.id;
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId}::uuid AND account_id = ${accountId}::uuid FOR UPDATE`;
        const updated = await tx.lead.updateMany({
          where: {
            id: leadId,
            accountId,
            status: { in: [...COMPLETABLE_LEAD_STATUSES, 'COMPLETED'] },
          },
          data: { status: 'COMPLETED' },
        });
        if (!updated.count)
          throw new ConflictException('Este pedido todavía no puede marcarse como finalizado.');
        await tx.conversation.updateMany({
          where: { id: conversationId, accountId, flowVersion: 'V2', status: 'ACTIVE' },
          data: { currentState: 'HANDOFF_TO_TATTOO_ARTIST', status: 'COMPLETED' },
        });
      });
      return this.getLead(accountId, leadId);
    }

    if (lead.status === LeadStatus.COMPLETED) {
      return this.getLead(accountId, leadId);
    }

    const update = await this.prisma.lead.updateMany({
      where: {
        id: leadId,
        accountId,
        status: { in: COMPLETABLE_LEAD_STATUSES },
      },
      data: { status: LeadStatus.COMPLETED },
    });

    if (update.count === 0) {
      throw new ConflictException('Este pedido todavía no puede marcarse como finalizado.');
    }

    return this.getLead(accountId, leadId);
  }

  async saveManualFinalPrice(accountId: string, leadId: string, price: number) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: {
        calculatedMinPrice: true,
        calculatedMaxPrice: true,
        evaluation: { select: { readinessStatus: true } },
      },
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    if (
      lead.evaluation?.readinessStatus !== ReadinessStatus.REVISAR ||
      lead.calculatedMinPrice !== null ||
      lead.calculatedMaxPrice !== null
    ) {
      throw new ConflictException(
        'El precio final manual solo puede guardarse en pedidos que requieren revisión y no tienen precio automático.',
      );
    }

    await this.prisma.lead.update({
      where: { id: leadId, accountId },
      data: { manualFinalPrice: new Prisma.Decimal(price) },
    });

    return this.getLead(accountId, leadId);
  }

  async archiveLead(accountId: string, leadId: string) {
    await this.ensureLeadExists(accountId, leadId);
    await this.prisma.lead.updateMany({
      where: { id: leadId, accountId, archivedAt: null },
      data: { archivedAt: new Date() },
    });

    return this.getLead(accountId, leadId);
  }

  async restoreLead(accountId: string, leadId: string) {
    await this.ensureLeadExists(accountId, leadId);
    await this.prisma.lead.updateMany({
      where: { id: leadId, accountId, archivedAt: { not: null } },
      data: { archivedAt: null },
    });

    return this.getLead(accountId, leadId);
  }

  async deleteIncompleteLead(accountId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: {
        id: true,
        customerId: true,
        conversationId: true,
        status: true,
        manualFinalPrice: true,
        calculatedMinPrice: true,
        calculatedMaxPrice: true,
        evaluation: { select: { readinessStatus: true } },
        images: { select: { storagePath: true } },
        quote: { select: { id: true } },
      },
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    if (!this.isLeadDeletable(lead)) {
      throw new ConflictException('Solo se pueden eliminar leads incompletos sin cotización.');
    }

    try {
      for (const image of lead.images) {
        await this.storage.delete(image.storagePath);
      }
    } catch {
      throw new ServiceUnavailableException(
        'No pudimos limpiar la imagen del lead. Inténtalo nuevamente.',
      );
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.lead.delete({ where: { id: lead.id } });

      if (lead.conversationId) {
        await transaction.conversation.deleteMany({
          where: {
            id: lead.conversationId,
            accountId,
            status: { in: [ConversationStatus.ABANDONED, ConversationStatus.COMPLETED] },
          },
        });
      }

      await transaction.customer.deleteMany({
        where: {
          id: lead.customerId,
          accountId,
          leads: { none: {} },
          conversations: { none: {} },
        },
      });
    });

    return { deleted: true, leadId: lead.id };
  }

  async getPricingRules(accountId: string) {
    const rules = await this.pricingService.listActiveRules(accountId);

    return {
      rules: rules.map((rule) => this.toPricingRule(rule)),
    };
  }

  async updatePricingRules(
    accountId: string,
    updates: PricingRulePriceUpdate[],
    changedByUserId: string,
  ) {
    const result = await this.pricingService.updateActiveRules(accountId, updates, changedByUserId);

    return {
      rules: result.rules.map((rule) => this.toPricingRule(rule)),
      updatedCount: result.updatedCount,
      message: 'Precios actualizados correctamente.',
    };
  }

  private filterWhere(accountId: string, query: LeadListQueryDto): Prisma.LeadWhereInput {
    const statusByFilter: Partial<Record<LeadFilter, LeadStatus[]>> = {
      verified: [LeadStatus.VERIFIED, LeadStatus.AUTO_QUOTED, LeadStatus.READY_TO_COORDINATE],
      'requires-review': [LeadStatus.REQUIRES_REVIEW, LeadStatus.SPECIAL_REVIEW],
      completed: [LeadStatus.COMPLETED],
    };
    const operationalStatus = statusByFilter[query.filter];

    return {
      accountId,
      archivedAt: query.archived ? { not: null } : null,
      ...(operationalStatus ? { status: { in: operationalStatus } } : {}),
      ...(query.status
        ? {
            OR: [
              { evaluation: { is: { readinessStatus: query.status } } },
              {
                conversation: { flowVersion: 'V2' },
                status: {
                  in:
                    query.status === 'LISTO'
                      ? [
                          LeadStatus.AUTO_QUOTED,
                          LeadStatus.READY_TO_COORDINATE,
                          LeadStatus.HANDOFF_TO_TATTOO_ARTIST,
                        ]
                      : query.status === 'REVISAR'
                        ? [LeadStatus.REQUIRES_REVIEW, LeadStatus.SPECIAL_REVIEW]
                        : [LeadStatus.ANALYZING],
                },
              },
            ],
          }
        : {}),
      ...(query.size ? { selectedSize: query.size } : {}),
      ...(query.detail ? { selectedDetail: query.detail } : {}),
      ...(query.search ? { customer: { is: { phoneNumber: { contains: query.search } } } } : {}),
    };
  }

  private orderBy(
    sortBy: LeadSortField | undefined,
    sortOrder: SortOrder,
  ): Prisma.LeadOrderByWithRelationInput[] {
    if (!sortBy) {
      return [
        { evaluation: { readinessStatus: 'asc' } },
        { evaluation: { readinessScore: 'desc' } },
      ];
    }

    const orderByField: Record<LeadSortField, Prisma.LeadOrderByWithRelationInput> = {
      readinessScore: { evaluation: { readinessScore: sortOrder } },
      price: { calculatedMinPrice: sortOrder },
      createdAt: { createdAt: sortOrder },
      size: { selectedSize: sortOrder },
      detail: { selectedDetail: sortOrder },
      status: { evaluation: { readinessStatus: sortOrder } },
    };

    return [orderByField[sortBy], { createdAt: 'desc' }];
  }

  private toSummary(lead: SummaryLead) {
    const preparation = v2PreparationFromJson(lead.v2Preparation);
    const v2 =
      lead.conversation?.flowVersion === 'V2' ||
      !!preparation ||
      lead.aiAnalysis?.analysisVersion === 'V2';
    return {
      id: lead.id,
      customerPhoneNumber: lead.customer.phoneNumber,
      selectedSize: lead.selectedSize,
      selectedSizeLabel: lead.selectedSize ? sizeLabel(lead.selectedSize) : null,
      selectedDetail: lead.selectedDetail,
      selectedDetailLabel: lead.selectedDetail ? detailLabel(lead.selectedDetail) : null,
      bodyPart: lead.bodyPart,
      status: lead.status,
      statusLabel: statusLabel(lead.status),
      createdAt: lead.createdAt.toISOString(),
      archivedAt: lead.archivedAt?.toISOString() ?? null,
      manualFinalPrice: this.manualFinalPrice(lead.manualFinalPrice),
      price: this.priceRange(lead.calculatedMinPrice, lead.calculatedMaxPrice),
      quote: lead.quote
        ? {
            id: lead.quote.id,
            amount: lead.quote.amount.toFixed(2),
            currency: lead.quote.currency,
            pricingModelVersionId: lead.quote.pricingModelVersionId,
            algorithmVersion: lead.quote.algorithmVersion,
            createdAt: lead.quote.createdAt.toISOString(),
          }
        : null,
      v2: v2
        ? {
            style: lead.quote?.detectedStyle ?? lead.aiAnalysis?.style ?? null,
            targetAreaCm2:
              lead.quote?.targetAreaCm2.toString() ?? preparation?.targetAreaCm2 ?? null,
            targetColorCoverage:
              lead.quote?.targetColorCoverage.toNumber() ??
              preparation?.targetColorCoverage ??
              null,
            bookingIntent: lead.bookingIntent ?? null,
            decision: preparation?.decision ?? null,
            reviewReasons: preparation?.reviewReasons ?? [],
            specialReviewTypes: preparation?.specialReviewTypes ?? [],
          }
        : null,
      deletable: this.isLeadDeletable(lead),
      readiness: lead.evaluation
        ? {
            status: lead.evaluation.readinessStatus,
            score: Math.round(lead.evaluation.readinessScore.toNumber()),
            rawScore: lead.evaluation.rawScore,
            rulesVersion: lead.evaluation.rulesVersion,
          }
        : null,
      confidence:
        lead.aiAnalysis?.analysisVersion === AnalysisVersion.V1 &&
        lead.aiAnalysis.sizeConfidence &&
        lead.aiAnalysis.detailConfidence
          ? {
              size: lead.aiAnalysis.sizeConfidence.toNumber(),
              detail: lead.aiAnalysis.detailConfidence.toNumber(),
            }
          : null,
    };
  }

  private toDetail(lead: DetailLead) {
    const analysis = lead.aiAnalysis ? toImageAnalysisResult(lead.aiAnalysis) : null;
    return {
      ...this.toSummary(lead),
      visionV2:
        lead.aiAnalysis?.analysisVersion === 'V2'
          ? {
              style: lead.aiAnalysis.style,
              overallConfidence: lead.aiAnalysis.overallConfidence,
              referenceMainDimensionCm: lead.aiAnalysis.referenceMainDimensionCm,
              referenceAreaCm2: lead.aiAnalysis.referenceAreaCm2,
              scaleReferenceType: lead.aiAnalysis.scaleReferenceType,
              scaleConfidence: lead.aiAnalysis.scaleConfidence,
              colorCoverage: lead.aiAnalysis.colorCoverage,
            }
          : null,
      analysis: analysis
        ? {
            detectedSize: analysis.detectedSize,
            detectedSizeLabel: sizeLabel(analysis.detectedSize),
            sizeConfidence: analysis.sizeConfidence,
            detectedDetail: analysis.detectedDetail,
            detectedDetailLabel: detailLabel(analysis.detectedDetail),
            detailConfidence: analysis.detailConfidence,
          }
        : null,
      reviewMessages: lead.reviewReasons.map((reason: ReviewReason) => reviewReasonMessage(reason)),
      evaluation: lead.evaluation
        ? {
            rawScore: lead.evaluation.rawScore,
            maxPositiveScore: lead.evaluation.maxPositiveScore,
            readinessScore: Math.round(lead.evaluation.readinessScore.toNumber()),
            status: lead.evaluation.readinessStatus,
            rulesVersion: lead.evaluation.rulesVersion,
            contributions: lead.evaluation.contributions,
            blockers: lead.evaluation.blockers,
            evaluatedAt: lead.evaluation.evaluatedAt.toISOString(),
          }
        : null,
      whatsappUrl: buildWhatsappUrl(lead.customer.phoneNumber),
    };
  }

  private unavailableReference() {
    return {
      available: false,
      imageId: null,
      signedUrl: null,
      expiresInSeconds: null,
      message: RETAINED_IMAGE_MESSAGE,
    };
  }

  private isLeadDeletable(lead: LeadDeletionCandidate): boolean {
    if (lead.quote) return false;
    if (lead.status === LeadStatus.COMPLETED) {
      return true;
    }

    return (
      lead.evaluation?.readinessStatus === ReadinessStatus.INCOMPLETO &&
      lead.status !== LeadStatus.HANDOFF_TO_TATTOO_ARTIST &&
      lead.manualFinalPrice === null &&
      lead.calculatedMinPrice === null &&
      lead.calculatedMaxPrice === null
    );
  }

  private async ensureLeadExists(accountId: string, leadId: string): Promise<void> {
    const exists = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('No encontramos ese pedido.');
    }
  }

  private priceRange(minimum: Prisma.Decimal | null, maximum: Prisma.Decimal | null) {
    return minimum && maximum
      ? { minimum: formatMoney(minimum), maximum: formatMoney(maximum) }
      : null;
  }

  private manualFinalPrice(price: Prisma.Decimal | null): string | null {
    return price?.toFixed(2) ?? null;
  }

  private toPricingRule(rule: PricingRule) {
    return {
      id: rule.id,
      size: rule.size,
      sizeLabel: sizeLabel(rule.size),
      sizeRange: sizeRangeLabel(rule.size),
      detail: rule.detail,
      detailLabel: detailLabel(rule.detail),
      minPrice: formatMoney(rule.minPrice),
      maxPrice: formatMoney(rule.maxPrice),
    };
  }
}
