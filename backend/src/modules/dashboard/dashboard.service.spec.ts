import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  DetailLevel,
  LeadStatus,
  Prisma,
  ReadinessStatus,
  ReviewReason,
  TattooSize,
  type AiAnalysis,
  type Lead,
  type LeadEvaluation,
  type LeadImage,
  type PricingRule,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { StorageService } from '../storage/storage.service.js';
import { CustomerMessagingService } from './customer-messaging.service.js';
import { DashboardService } from './dashboard.service.js';
import type { LeadListQueryDto } from './dto/dashboard.dto.js';

type DashboardLead = Lead & {
  customer: { phoneNumber: string };
  aiAnalysis: AiAnalysis | null;
  evaluation: LeadEvaluation | null;
  images: LeadImage[];
};

const LEAD_ID = '290f2044-e63c-4e49-8847-067cd62426e4';
const USER_ID = 'bb8bf7d2-e17c-44da-b456-b7240d30daf2';

function makeLead(overrides: Partial<DashboardLead> = {}): DashboardLead {
  const now = new Date('2026-09-14T12:00:00.000Z');

  return {
    id: LEAD_ID,
    customerId: '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e',
    conversationId: 'a459f257-b03c-48f4-9091-2dc37871ef81',
    selectedSize: TattooSize.MEDIUM,
    selectedDetail: DetailLevel.DETAILED,
    bodyPart: 'Brazo',
    status: LeadStatus.VERIFIED,
    reviewReasons: [],
    calculatedMinPrice: new Prisma.Decimal(500),
    calculatedMaxPrice: new Prisma.Decimal(700),
    pricingRuleId: 'ce16a85c-cc5b-43de-8a56-1b2ef568fd39',
    pricingRuleVersion: 1,
    priceSentAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    customer: { phoneNumber: '+51 999999999' },
    aiAnalysis: {
      id: 'c29080d9-49de-4d6e-bea2-6017cbe109f8',
      leadId: LEAD_ID,
      detectedSize: TattooSize.MEDIUM,
      sizeConfidence: new Prisma.Decimal('0.950'),
      detectedDetail: DetailLevel.DETAILED,
      detailConfidence: new Prisma.Decimal('0.960'),
      rawResponse: null,
      createdAt: now,
    },
    evaluation: {
      id: '4a0ec352-1674-45e1-b6af-41748736da76',
      leadId: LEAD_ID,
      rawScore: 250,
      maxPositiveScore: 250,
      readinessScore: new Prisma.Decimal(100),
      readinessStatus: ReadinessStatus.LISTO,
      rulesVersion: 1,
      contributions: [],
      blockers: [],
      evaluatedAt: now,
      updatedAt: now,
    },
    images: [],
    ...overrides,
  };
}

function leadQuery(overrides: Partial<LeadListQueryDto> = {}): LeadListQueryDto {
  return {
    filter: 'all',
    archived: false,
    sortOrder: 'desc',
    page: 1,
    pageSize: 20,
    ...overrides,
  };
}

function serviceWith(
  prismaShape: object,
  sendPrice = vi.fn().mockResolvedValue(undefined),
  pricingShape: object = {},
  storageShape: object = {},
) {
  const prisma = prismaShape as PrismaService;
  const messaging = { sendPrice } as unknown as CustomerMessagingService;
  const pricing = pricingShape as PricingService;
  const storage = storageShape as StorageService;

  return { service: new DashboardService(prisma, messaging, pricing, storage), sendPrice };
}

describe('DashboardService', () => {
  it('counts only complete Lead records and returns recent orders', async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(12);
    const findMany = vi.fn().mockResolvedValue([makeLead()]);
    const conversationFindMany = vi.fn().mockResolvedValue([{ currentState: 'ASK_DETAIL' }]);
    const { service } = serviceWith({
      lead: { count, findMany },
      conversation: { findMany: conversationFindMany },
    });

    const result = await service.getMetrics();

    expect(result.totals).toEqual({
      newOrders: 4,
      verified: 3,
      requiresReview: 1,
      completed: 12,
    });
    expect(result.recentLeads).toHaveLength(1);
    expect(conversationFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ['verified' as const, LeadStatus.VERIFIED, 'Verificado'],
    ['requires-review' as const, LeadStatus.REQUIRES_REVIEW, 'Requiere revisión'],
  ])('lists the %s lead filter', async (filter, status, expectedLabel) => {
    const findMany = vi.fn().mockResolvedValue([makeLead({ status })]);
    const count = vi.fn().mockResolvedValue(1);
    const { service } = serviceWith({ lead: { findMany, count } });

    const result = await service.listLeads(leadQuery({ filter }));

    expect(findMany).toHaveBeenCalledWith({
      where: { archivedAt: null, status },
      include: {
        customer: { select: { phoneNumber: true } },
        evaluation: true,
        aiAnalysis: {
          select: { sizeConfidence: true, detailConfidence: true },
        },
      },
      orderBy: [
        { evaluation: { readinessStatus: 'asc' } },
        { evaluation: { readinessScore: 'desc' } },
      ],
      skip: 0,
      take: 20,
    });
    expect(result.leads[0]?.statusLabel).toBe(expectedLabel);
  });

  it('returns the complete lead detail with translated review reasons', async () => {
    const lead = makeLead({
      status: LeadStatus.REQUIRES_REVIEW,
      reviewReasons: [ReviewReason.SIZE_MISMATCH, ReviewReason.LOW_DETAIL_CONFIDENCE],
      calculatedMinPrice: null,
      calculatedMaxPrice: null,
      pricingRuleId: null,
      pricingRuleVersion: null,
    });
    const { service } = serviceWith({
      lead: { findUnique: vi.fn().mockResolvedValue(lead) },
    });

    const result = await service.getLead(LEAD_ID);

    expect(result.customerPhoneNumber).toBe('+51 999999999');
    expect(result.analysis).toMatchObject({
      detectedSizeLabel: 'Mediano',
      sizeConfidence: 0.95,
      detectedDetailLabel: 'Detallado',
      detailConfidence: 0.96,
    });
    expect(result.reviewMessages).toEqual([
      'El tamaño detectado no coincide con lo indicado por el cliente.',
      'La IA no tuvo suficiente confianza al identificar el nivel de detalle.',
    ]);
    expect(result.reviewMessages.join(' ')).not.toContain('SIZE_MISMATCH');
  });

  it('creates a five-minute signed URL only for a current stored image', async () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    const storagePath =
      'leads/290f2044-e63c-4e49-8847-067cd62426e4/bf3b934c-8338-45f3-992f-3ad65c3ce537.png';
    const exists = vi.fn().mockResolvedValue(true);
    const createSignedUrl = vi.fn().mockResolvedValue('https://temporary.example/signed');
    const { service } = serviceWith(
      {
        lead: {
          findUnique: vi.fn().mockResolvedValue({
            id: LEAD_ID,
            images: [{ storagePath, expiresAt: new Date(now.getTime() + 60_000) }],
          }),
        },
      },
      vi.fn(),
      {},
      { exists, createSignedUrl },
    );

    await expect(service.getLeadReference(LEAD_ID, now)).resolves.toEqual({
      available: true,
      signedUrl: 'https://temporary.example/signed',
      expiresInSeconds: 300,
      message: null,
    });
    expect(exists).toHaveBeenCalledWith(storagePath);
    expect(createSignedUrl).toHaveBeenCalledWith(storagePath, 300);
  });

  it.each([
    ['deleted', []],
    [
      'expired',
      [
        {
          storagePath:
            'leads/290f2044-e63c-4e49-8847-067cd62426e4/bf3b934c-8338-45f3-992f-3ad65c3ce537.png',
          expiresAt: new Date('2026-09-14T12:00:00.000Z'),
        },
      ],
    ],
  ] as const)('does not sign a %s image', async (_case, images) => {
    const exists = vi.fn();
    const createSignedUrl = vi.fn();
    const { service } = serviceWith(
      {
        lead: {
          findUnique: vi.fn().mockResolvedValue({ id: LEAD_ID, images }),
        },
      },
      vi.fn(),
      {},
      { exists, createSignedUrl },
    );

    await expect(
      service.getLeadReference(LEAD_ID, new Date('2026-09-14T12:00:00.000Z')),
    ).resolves.toEqual({
      available: false,
      signedUrl: null,
      expiresInSeconds: null,
      message: 'Imagen eliminada por política de retención.',
    });
    expect(exists).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('does not create a signed URL when the object is missing from storage', async () => {
    const exists = vi.fn().mockResolvedValue(false);
    const createSignedUrl = vi.fn();
    const { service } = serviceWith(
      {
        lead: {
          findUnique: vi.fn().mockResolvedValue({
            id: LEAD_ID,
            images: [
              {
                storagePath:
                  'leads/290f2044-e63c-4e49-8847-067cd62426e4/bf3b934c-8338-45f3-992f-3ad65c3ce537.png',
                expiresAt: new Date('2026-09-15T12:00:00.000Z'),
              },
            ],
          }),
        },
      },
      vi.fn(),
      {},
      { exists, createSignedUrl },
    );

    const result = await service.getLeadReference(LEAD_ID, new Date('2026-09-14T12:00:00.000Z'));

    expect(result.message).toBe('Imagen eliminada por política de retención.');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('saves a valid manual range for a lead that requires review', async () => {
    const updatedLead = makeLead({
      status: LeadStatus.REQUIRES_REVIEW,
      calculatedMinPrice: new Prisma.Decimal(420),
      calculatedMaxPrice: new Prisma.Decimal(610),
      pricingRuleId: null,
      pricingRuleVersion: null,
    });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ status: LeadStatus.REQUIRES_REVIEW, priceSentAt: null })
      .mockResolvedValueOnce(updatedLead);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { service } = serviceWith({ lead: { findUnique, updateMany } });

    const result = await service.saveManualPrice(LEAD_ID, 420, 610);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: LEAD_ID,
        status: LeadStatus.REQUIRES_REVIEW,
        priceSentAt: null,
      },
      data: {
        calculatedMinPrice: new Prisma.Decimal(420),
        calculatedMaxPrice: new Prisma.Decimal(610),
      },
    });
    expect(result.price).toEqual({ minimum: '420', maximum: '610' });
  });

  it('does not overwrite a price when the lead changes during a concurrent save', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const { service } = serviceWith({
      lead: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ status: LeadStatus.REQUIRES_REVIEW, priceSentAt: null }),
        updateMany,
      },
    });

    await expect(service.saveManualPrice(LEAD_ID, 420, 610)).rejects.toEqual(
      new ConflictException('Este pedido ya no admite cambios de precio.'),
    );
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it('rejects a manual range whose maximum is below its minimum', async () => {
    const findUnique = vi.fn();
    const { service } = serviceWith({ lead: { findUnique } });

    await expect(service.saveManualPrice(LEAD_ID, 700, 500)).rejects.toEqual(
      new BadRequestException('El precio máximo debe ser igual o mayor al precio mínimo.'),
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects non-finite manual price values before accessing the database', async () => {
    const findUnique = vi.fn();
    const { service } = serviceWith({ lead: { findUnique } });

    await expect(service.saveManualPrice(LEAD_ID, Number.NaN, 500)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['minimum', null, new Prisma.Decimal(610)],
    ['maximum', new Prisma.Decimal(420), null],
  ] as const)('does not send when the %s price is missing', async (_field, minimum, maximum) => {
    const updateMany = vi.fn();
    const sendPrice = vi.fn();
    const { service } = serviceWith(
      {
        lead: {
          findUnique: vi.fn().mockResolvedValue(
            makeLead({
              status: LeadStatus.REQUIRES_REVIEW,
              calculatedMinPrice: minimum,
              calculatedMaxPrice: maximum,
            }),
          ),
          updateMany,
        },
      },
      sendPrice,
    );

    await expect(service.sendPrice(LEAD_ID)).rejects.toEqual(
      new BadRequestException('Guarda un precio mínimo y máximo antes de enviarlo.'),
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(sendPrice).not.toHaveBeenCalled();
  });

  it.each([
    ['negative minimum', new Prisma.Decimal(-1), new Prisma.Decimal(100)],
    ['maximum below minimum', new Prisma.Decimal(700), new Prisma.Decimal(500)],
  ] as const)('does not send an invalid persisted range: %s', async (_case, minimum, maximum) => {
    const updateMany = vi.fn();
    const sendPrice = vi.fn();
    const { service } = serviceWith(
      {
        lead: {
          findUnique: vi.fn().mockResolvedValue(
            makeLead({
              status: LeadStatus.REQUIRES_REVIEW,
              calculatedMinPrice: minimum,
              calculatedMaxPrice: maximum,
            }),
          ),
          updateMany,
        },
      },
      sendPrice,
    );

    await expect(service.sendPrice(LEAD_ID)).rejects.toEqual(
      new BadRequestException('El rango de precios guardado no es válido.'),
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(sendPrice).not.toHaveBeenCalled();
  });

  it('does not expose manual sending for an automatically VERIFIED lead', async () => {
    const updateMany = vi.fn();
    const sendPrice = vi.fn();
    const { service } = serviceWith(
      {
        lead: {
          findUnique: vi.fn().mockResolvedValue(makeLead({ status: LeadStatus.VERIFIED })),
          updateMany,
        },
      },
      sendPrice,
    );

    await expect(service.sendPrice(LEAD_ID)).rejects.toEqual(
      new ConflictException(
        'Solo los pedidos que requieren revisión admiten el envío manual de precio.',
      ),
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(sendPrice).not.toHaveBeenCalled();
  });

  it('sends the mock price once and records priceSentAt', async () => {
    let lead = makeLead({
      status: LeadStatus.REQUIRES_REVIEW,
      calculatedMinPrice: new Prisma.Decimal(420),
      calculatedMaxPrice: new Prisma.Decimal(610),
      pricingRuleId: null,
      pricingRuleVersion: null,
    });
    const updateMany = vi.fn(
      (arguments_: {
        where: {
          id: string;
          status: LeadStatus;
          priceSentAt: null;
          calculatedMinPrice: Prisma.Decimal;
          calculatedMaxPrice: Prisma.Decimal;
        };
        data: { priceSentAt: Date; status: LeadStatus };
      }) => {
        lead = {
          ...lead,
          status: LeadStatus.HANDOFF_TO_TATTOO_ARTIST,
          priceSentAt: arguments_.data.priceSentAt,
        };
        return Promise.resolve({ count: 1 });
      },
    );
    const { service, sendPrice } = serviceWith({
      lead: {
        findUnique: vi.fn(() => Promise.resolve(lead)),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(lead)),
        updateMany,
      },
    });

    const result = await service.sendPrice(LEAD_ID);

    expect(result).toMatchObject({
      sent: true,
      alreadySent: false,
      confirmation: 'Precio enviado correctamente (modo prueba).',
    });
    expect(updateMany.mock.calls[0]?.[0].data.priceSentAt).toBeInstanceOf(Date);
    const updateArguments = updateMany.mock.calls[0]?.[0];
    expect(updateArguments?.where).toEqual({
      id: LEAD_ID,
      status: LeadStatus.REQUIRES_REVIEW,
      priceSentAt: null,
      calculatedMinPrice: new Prisma.Decimal(420),
      calculatedMaxPrice: new Prisma.Decimal(610),
    });
    expect(updateArguments?.data.status).toBe(LeadStatus.HANDOFF_TO_TATTOO_ARTIST);
    expect(sendPrice).toHaveBeenCalledWith({
      phoneNumber: '+51 999999999',
      message:
        'El tatuador revisó tu diseño. El precio aproximado estaría entre S/420 y S/610. El precio final se confirma antes de realizar el trabajo.',
      idempotencyKey: `lead:${LEAD_ID}:price`,
    });
  });

  it('does not duplicate the mock action when send is repeated', async () => {
    let lead = makeLead({
      status: LeadStatus.REQUIRES_REVIEW,
      priceSentAt: null,
    });
    const updateMany = vi.fn().mockImplementation(() => {
      lead = {
        ...lead,
        status: LeadStatus.HANDOFF_TO_TATTOO_ARTIST,
        priceSentAt: new Date(),
      };
      return Promise.resolve({ count: 1 });
    });
    const { service, sendPrice } = serviceWith({
      lead: {
        findUnique: vi.fn(() => Promise.resolve(lead)),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(lead)),
        updateMany,
      },
    });

    await service.sendPrice(LEAD_ID);
    const repeated = await service.sendPrice(LEAD_ID);

    expect(repeated).toMatchObject({ sent: false, alreadySent: true });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(sendPrice).toHaveBeenCalledOnce();
  });

  it('does not send again when a concurrent request already claimed the lead', async () => {
    const sentAt = new Date('2026-09-14T12:30:00.000Z');
    const sendPrice = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const { service } = serviceWith(
      {
        lead: {
          findUnique: vi.fn().mockResolvedValue(
            makeLead({
              status: LeadStatus.REQUIRES_REVIEW,
              calculatedMinPrice: new Prisma.Decimal(420),
              calculatedMaxPrice: new Prisma.Decimal(610),
              priceSentAt: null,
            }),
          ),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            status: LeadStatus.HANDOFF_TO_TATTOO_ARTIST,
            priceSentAt: sentAt,
          }),
          updateMany,
        },
      },
      sendPrice,
    );

    await expect(service.sendPrice(LEAD_ID)).resolves.toMatchObject({
      sent: false,
      alreadySent: true,
      priceSentAt: sentAt.toISOString(),
    });
    expect(sendPrice).not.toHaveBeenCalled();
  });

  it('does not send a stale range when another request changes the price first', async () => {
    const sendPrice = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const { service } = serviceWith(
      {
        lead: {
          findUnique: vi.fn().mockResolvedValue(
            makeLead({
              status: LeadStatus.REQUIRES_REVIEW,
              calculatedMinPrice: new Prisma.Decimal(420),
              calculatedMaxPrice: new Prisma.Decimal(610),
              priceSentAt: null,
            }),
          ),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            status: LeadStatus.REQUIRES_REVIEW,
            priceSentAt: null,
          }),
          updateMany,
        },
      },
      sendPrice,
    );

    await expect(service.sendPrice(LEAD_ID)).rejects.toEqual(
      new ConflictException('Este pedido ya no admite el envío manual de precio.'),
    );
    expect(sendPrice).not.toHaveBeenCalled();
  });

  it('marks an attended lead as COMPLETED so the customer can request a new quotation', async () => {
    const completedLead = makeLead({ status: LeadStatus.COMPLETED });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ status: LeadStatus.VERIFIED })
      .mockResolvedValueOnce(completedLead);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { service } = serviceWith({ lead: { findUnique, updateMany } });

    const result = await service.completeLead(LEAD_ID);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: LEAD_ID,
        status: {
          in: [
            LeadStatus.VERIFIED,
            LeadStatus.REQUIRES_REVIEW,
            LeadStatus.HANDOFF_TO_TATTOO_ARTIST,
          ],
        },
      },
      data: { status: LeadStatus.COMPLETED },
    });
    expect(result.status).toBe(LeadStatus.COMPLETED);
  });

  it('keeps completing a lead idempotent', async () => {
    const completedLead = makeLead({ status: LeadStatus.COMPLETED });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ status: LeadStatus.COMPLETED })
      .mockResolvedValueOnce(completedLead);
    const updateMany = vi.fn();
    const { service } = serviceWith({ lead: { findUnique, updateMany } });

    await expect(service.completeLead(LEAD_ID)).resolves.toMatchObject({
      status: LeadStatus.COMPLETED,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not finalize a lead while image analysis is still running', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const { service } = serviceWith({
      lead: {
        findUnique: vi.fn().mockResolvedValue({ status: LeadStatus.ANALYZING }),
        updateMany,
      },
    });

    await expect(service.completeLead(LEAD_ID)).rejects.toEqual(
      new ConflictException('Este pedido todavía no puede marcarse como finalizado.'),
    );
  });

  it('never lists an incomplete conversation without a Lead', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const conversationFindMany = vi
      .fn()
      .mockResolvedValue([{ id: 'draft', currentState: 'ASK_BODY_PART' }]);
    const { service } = serviceWith({
      lead: { findMany, count },
      conversation: { findMany: conversationFindMany },
    });

    const result = await service.listLeads(leadQuery());

    expect(result.leads).toEqual([]);
    expect(findMany).toHaveBeenCalledOnce();
    expect(conversationFindMany).not.toHaveBeenCalled();
  });

  it('returns friendly pricing labels without exposing versions', async () => {
    const rule: PricingRule = {
      id: '00000000-0000-4000-8000-000000000001',
      size: TattooSize.SMALL,
      detail: DetailLevel.LIGHT,
      minPrice: new Prisma.Decimal(70),
      maxPrice: new Prisma.Decimal(80),
      isActive: true,
      version: 4,
      updatedAt: new Date('2026-09-14T12:00:00.000Z'),
    };
    const listActiveRules = vi.fn().mockResolvedValue([rule]);
    const { service } = serviceWith({}, vi.fn(), { listActiveRules });

    const result = await service.getPricingRules();

    expect(result.rules[0]).toEqual({
      id: rule.id,
      size: TattooSize.SMALL,
      sizeLabel: 'Pequeño',
      sizeRange: '4–6 cm',
      detail: DetailLevel.LIGHT,
      detailLabel: 'Ligero',
      minPrice: '70',
      maxPrice: '80',
    });
    expect(result.rules[0]).not.toHaveProperty('version');
  });

  it('passes only price changes and the authenticated user to PricingService', async () => {
    const update = {
      pricingRuleId: '00000000-0000-4000-8000-000000000001',
      minPrice: 75,
      maxPrice: 85,
    };
    const updatedRule: PricingRule = {
      id: update.pricingRuleId,
      size: TattooSize.SMALL,
      detail: DetailLevel.LIGHT,
      minPrice: new Prisma.Decimal(update.minPrice),
      maxPrice: new Prisma.Decimal(update.maxPrice),
      isActive: true,
      version: 2,
      updatedAt: new Date('2026-09-14T12:00:00.000Z'),
    };
    const updateActiveRules = vi.fn().mockResolvedValue({
      rules: [updatedRule],
      updatedCount: 1,
    });
    const { service } = serviceWith({}, vi.fn(), { updateActiveRules });

    const result = await service.updatePricingRules([update], USER_ID);

    expect(updateActiveRules).toHaveBeenCalledWith([update], USER_ID);
    expect(result).toMatchObject({
      updatedCount: 1,
      message: 'Precios actualizados correctamente.',
    });
  });
});
