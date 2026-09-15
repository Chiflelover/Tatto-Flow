import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LeadStatus,
  Prisma,
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
import type { LeadFilter } from './dto/dashboard.dto.js';

const SUMMARY_INCLUDE = {
  customer: { select: { phoneNumber: true } },
} satisfies Prisma.LeadInclude;

const DETAIL_INCLUDE = {
  customer: { select: { phoneNumber: true } },
  aiAnalysis: true,
} satisfies Prisma.LeadInclude;

type SummaryLead = Prisma.LeadGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type DetailLead = Prisma.LeadGetPayload<{ include: typeof DETAIL_INCLUDE }>;

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
          status: {
            in: [LeadStatus.ANALYZING, LeadStatus.VERIFIED, LeadStatus.REQUIRES_REVIEW],
          },
        },
      }),
      this.prisma.lead.count({ where: { status: LeadStatus.VERIFIED } }),
      this.prisma.lead.count({ where: { status: LeadStatus.REQUIRES_REVIEW } }),
      this.prisma.lead.count({ where: { status: LeadStatus.COMPLETED } }),
      this.prisma.lead.findMany({
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

  async listLeads(filter: LeadFilter) {
    const leads = await this.prisma.lead.findMany({
      where: this.filterWhere(filter),
      include: SUMMARY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return { leads: leads.map((lead) => this.toSummary(lead)) };
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

  private filterWhere(filter: LeadFilter): Prisma.LeadWhereInput | undefined {
    const statusByFilter: Partial<Record<LeadFilter, LeadStatus>> = {
      verified: LeadStatus.VERIFIED,
      'requires-review': LeadStatus.REQUIRES_REVIEW,
      completed: LeadStatus.COMPLETED,
    };
    const status = statusByFilter[filter];

    return status ? { status } : undefined;
  }

  private toSummary(lead: SummaryLead) {
    return {
      id: lead.id,
      customerPhoneNumber: lead.customer.phoneNumber,
      selectedSize: lead.selectedSize,
      selectedSizeLabel: sizeLabel(lead.selectedSize),
      selectedDetail: lead.selectedDetail,
      selectedDetailLabel: detailLabel(lead.selectedDetail),
      bodyPart: lead.bodyPart,
      status: lead.status,
      statusLabel: statusLabel(lead.status),
      createdAt: lead.createdAt.toISOString(),
      price: this.priceRange(lead.calculatedMinPrice, lead.calculatedMaxPrice),
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
