import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
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
import { CustomerMessagingService } from './customer-messaging.service.js';
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

const SUMMARY_INCLUDE = {
  customer: { select: { phoneNumber: true } },
  evaluation: true,
  aiAnalysis: {
    select: {
      sizeConfidence: true,
      detailConfidence: true,
    },
  },
} satisfies Prisma.LeadInclude;

const DETAIL_INCLUDE = {
  customer: { select: { phoneNumber: true } },
  aiAnalysis: true,
  evaluation: true,
} satisfies Prisma.LeadInclude;

type SummaryLead = Prisma.LeadGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type DetailLead = Prisma.LeadGetPayload<{ include: typeof DETAIL_INCLUDE }>;
interface LeadDeletionCandidate {
  status: LeadStatus;
  calculatedMinPrice: Prisma.Decimal | null;
  calculatedMaxPrice: Prisma.Decimal | null;
  priceSentAt: Date | null;
  evaluation: { readinessStatus: ReadinessStatus } | null;
}

const PRICE_SENT_CONFIRMATION = 'Precio enviado correctamente (modo prueba).';
const RETAINED_IMAGE_MESSAGE = 'Imagen eliminada por política de retención.';
const SIGNED_URL_TTL_SECONDS = 5 * 60;
const COMPLETABLE_LEAD_STATUSES = [
  LeadStatus.VERIFIED,
  LeadStatus.REQUIRES_REVIEW,
  LeadStatus.HANDOFF_TO_TATTOO_ARTIST,
];

@Injectable()
export class DashboardService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(CustomerMessagingService)
    private readonly customerMessaging: CustomerMessagingService,
    @Inject(PricingService)
    private readonly pricingService: PricingService,
    @Inject(StorageService)
    private readonly storage: StorageService,
  ) {}

  async getMetrics() {
    const [newOrders, verified, requiresReview, completed, recentLeads] = await Promise.all([
      this.prisma.lead.count({
        where: {
          archivedAt: null,
          status: {
            in: [LeadStatus.ANALYZING, LeadStatus.VERIFIED, LeadStatus.REQUIRES_REVIEW],
          },
        },
      }),
      this.prisma.lead.count({ where: { archivedAt: null, status: LeadStatus.VERIFIED } }),
      this.prisma.lead.count({
        where: { archivedAt: null, status: LeadStatus.REQUIRES_REVIEW },
      }),
      this.prisma.lead.count({ where: { archivedAt: null, status: LeadStatus.COMPLETED } }),
      this.prisma.lead.findMany({
        where: { archivedAt: null },
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

  async listLeads(query: LeadListQueryDto) {
    const where = this.filterWhere(query);
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

  async getLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: DETAIL_INCLUDE,
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    return this.toDetail(lead);
  }

  async getLeadReference(leadId: string, now = new Date()) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        images: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { storagePath: true, expiresAt: true },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    const image = lead.images[0];

    if (!image || image.expiresAt.getTime() <= now.getTime()) {
      return this.unavailableReference();
    }

    try {
      if (!(await this.storage.exists(image.storagePath))) {
        return this.unavailableReference();
      }

      return {
        available: true,
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

  async saveManualPrice(leadId: string, minPrice: number, maxPrice: number) {
    if (
      !Number.isFinite(minPrice) ||
      !Number.isFinite(maxPrice) ||
      minPrice < 0 ||
      maxPrice < minPrice
    ) {
      throw new BadRequestException('El precio máximo debe ser igual o mayor al precio mínimo.');
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { status: true, priceSentAt: true },
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    if (lead.status !== LeadStatus.REQUIRES_REVIEW || lead.priceSentAt) {
      throw new ConflictException('Este pedido ya no admite cambios de precio.');
    }

    const update = await this.prisma.lead.updateMany({
      where: {
        id: leadId,
        status: LeadStatus.REQUIRES_REVIEW,
        priceSentAt: null,
      },
      data: {
        calculatedMinPrice: new Prisma.Decimal(minPrice),
        calculatedMaxPrice: new Prisma.Decimal(maxPrice),
      },
    });

    if (update.count === 0) {
      throw new ConflictException('Este pedido ya no admite cambios de precio.');
    }

    return this.getLead(leadId);
  }

  async sendPrice(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        status: true,
        calculatedMinPrice: true,
        calculatedMaxPrice: true,
        priceSentAt: true,
        customer: { select: { phoneNumber: true } },
      },
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    if (lead.priceSentAt) {
      return this.alreadySentResponse(lead.priceSentAt);
    }

    if (lead.status !== LeadStatus.REQUIRES_REVIEW) {
      throw new ConflictException(
        'Solo los pedidos que requieren revisión admiten el envío manual de precio.',
      );
    }

    if (lead.calculatedMinPrice === null || lead.calculatedMaxPrice === null) {
      throw new BadRequestException('Guarda un precio mínimo y máximo antes de enviarlo.');
    }

    if (
      lead.calculatedMinPrice.isNegative() ||
      lead.calculatedMaxPrice.lessThan(lead.calculatedMinPrice)
    ) {
      throw new BadRequestException('El rango de precios guardado no es válido.');
    }

    const priceSentAt = new Date();
    const update = await this.prisma.lead.updateMany({
      where: {
        id: lead.id,
        status: LeadStatus.REQUIRES_REVIEW,
        priceSentAt: null,
        calculatedMinPrice: lead.calculatedMinPrice,
        calculatedMaxPrice: lead.calculatedMaxPrice,
      },
      data: {
        priceSentAt,
        status: LeadStatus.HANDOFF_TO_TATTOO_ARTIST,
      },
    });

    if (update.count === 0) {
      const alreadyUpdated = await this.prisma.lead.findUniqueOrThrow({
        where: { id: lead.id },
        select: { priceSentAt: true, status: true },
      });

      if (alreadyUpdated.priceSentAt) {
        return this.alreadySentResponse(alreadyUpdated.priceSentAt);
      }

      throw new ConflictException('Este pedido ya no admite el envío manual de precio.');
    }

    const message =
      `El tatuador revisó tu diseño. El precio aproximado estaría entre ` +
      `S/${formatMoney(lead.calculatedMinPrice)} y S/${formatMoney(lead.calculatedMaxPrice)}. ` +
      'El precio final se confirma antes de realizar el trabajo.';

    await this.customerMessaging.sendPrice({
      phoneNumber: lead.customer.phoneNumber,
      message,
      idempotencyKey: `lead:${lead.id}:price`,
    });

    return {
      sent: true,
      alreadySent: false,
      confirmation: PRICE_SENT_CONFIRMATION,
      priceSentAt: priceSentAt.toISOString(),
    };
  }

  async completeLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { status: true },
    });

    if (!lead) {
      throw new NotFoundException('No encontramos ese pedido.');
    }

    if (lead.status === LeadStatus.COMPLETED) {
      return this.getLead(leadId);
    }

    const update = await this.prisma.lead.updateMany({
      where: {
        id: leadId,
        status: { in: COMPLETABLE_LEAD_STATUSES },
      },
      data: { status: LeadStatus.COMPLETED },
    });

    if (update.count === 0) {
      throw new ConflictException('Este pedido todavía no puede marcarse como finalizado.');
    }

    return this.getLead(leadId);
  }

  async archiveLead(leadId: string) {
    await this.ensureLeadExists(leadId);
    await this.prisma.lead.updateMany({
      where: { id: leadId, archivedAt: null },
      data: { archivedAt: new Date() },
    });

    return this.getLead(leadId);
  }

  async restoreLead(leadId: string) {
    await this.ensureLeadExists(leadId);
    await this.prisma.lead.updateMany({
      where: { id: leadId, archivedAt: { not: null } },
      data: { archivedAt: null },
    });

    return this.getLead(leadId);
  }

  async deleteIncompleteLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        customerId: true,
        conversationId: true,
        status: true,
        calculatedMinPrice: true,
        calculatedMaxPrice: true,
        priceSentAt: true,
        evaluation: { select: { readinessStatus: true } },
        images: { select: { storagePath: true } },
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
            status: { in: [ConversationStatus.ABANDONED, ConversationStatus.COMPLETED] },
          },
        });
      }

      await transaction.customer.deleteMany({
        where: {
          id: lead.customerId,
          leads: { none: {} },
          conversations: { none: {} },
        },
      });
    });

    return { deleted: true, leadId: lead.id };
  }

  async getPricingRules() {
    const rules = await this.pricingService.listActiveRules();

    return {
      rules: rules.map((rule) => this.toPricingRule(rule)),
    };
  }

  async updatePricingRules(updates: PricingRulePriceUpdate[], changedByUserId: string) {
    const result = await this.pricingService.updateActiveRules(updates, changedByUserId);

    return {
      rules: result.rules.map((rule) => this.toPricingRule(rule)),
      updatedCount: result.updatedCount,
      message: 'Precios actualizados correctamente.',
    };
  }

  private filterWhere(query: LeadListQueryDto): Prisma.LeadWhereInput {
    const statusByFilter: Partial<Record<LeadFilter, LeadStatus>> = {
      verified: LeadStatus.VERIFIED,
      'requires-review': LeadStatus.REQUIRES_REVIEW,
      completed: LeadStatus.COMPLETED,
    };
    const operationalStatus = statusByFilter[query.filter];

    return {
      archivedAt: query.archived ? { not: null } : null,
      ...(operationalStatus ? { status: operationalStatus } : {}),
      ...(query.status ? { evaluation: { is: { readinessStatus: query.status } } } : {}),
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
      price: this.priceRange(lead.calculatedMinPrice, lead.calculatedMaxPrice),
      deletable: this.isLeadDeletable(lead),
      readiness: lead.evaluation
        ? {
            status: lead.evaluation.readinessStatus,
            score: Math.round(lead.evaluation.readinessScore.toNumber()),
            rawScore: lead.evaluation.rawScore,
            rulesVersion: lead.evaluation.rulesVersion,
          }
        : null,
      confidence: lead.aiAnalysis
        ? {
            size: lead.aiAnalysis.sizeConfidence.toNumber(),
            detail: lead.aiAnalysis.detailConfidence.toNumber(),
          }
        : null,
    };
  }

  private toDetail(lead: DetailLead) {
    return {
      ...this.toSummary(lead),
      analysis: lead.aiAnalysis
        ? {
            detectedSize: lead.aiAnalysis.detectedSize,
            detectedSizeLabel: sizeLabel(lead.aiAnalysis.detectedSize),
            sizeConfidence: lead.aiAnalysis.sizeConfidence.toNumber(),
            detectedDetail: lead.aiAnalysis.detectedDetail,
            detectedDetailLabel: detailLabel(lead.aiAnalysis.detectedDetail),
            detailConfidence: lead.aiAnalysis.detailConfidence.toNumber(),
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
      priceSentAt: lead.priceSentAt?.toISOString() ?? null,
      whatsappUrl: buildWhatsappUrl(lead.customer.phoneNumber),
    };
  }

  private unavailableReference() {
    return {
      available: false,
      signedUrl: null,
      expiresInSeconds: null,
      message: RETAINED_IMAGE_MESSAGE,
    };
  }

  private isLeadDeletable(lead: LeadDeletionCandidate): boolean {
    if (lead.status === LeadStatus.COMPLETED) {
      return true;
    }

    return (
      lead.evaluation?.readinessStatus === ReadinessStatus.INCOMPLETO &&
      lead.status !== LeadStatus.HANDOFF_TO_TATTOO_ARTIST &&
      lead.calculatedMinPrice === null &&
      lead.calculatedMaxPrice === null &&
      lead.priceSentAt === null
    );
  }

  private async ensureLeadExists(leadId: string): Promise<void> {
    const exists = await this.prisma.lead.findUnique({
      where: { id: leadId },
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

  private alreadySentResponse(priceSentAt: Date) {
    return {
      sent: false,
      alreadySent: true,
      confirmation: 'Este precio ya fue enviado anteriormente.',
      priceSentAt: priceSentAt.toISOString(),
    };
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
