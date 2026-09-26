import { ConflictException } from '@nestjs/common';
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

function serviceWith(prismaShape: object, pricingShape: object = {}, storageShape: object = {}) {
  const prisma = prismaShape as PrismaService;
  const pricing = pricingShape as PricingService;
  const storage = storageShape as StorageService;

  return { service: new DashboardService(prisma, pricing, storage) };
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
    expect(result).not.toHaveProperty('priceSentAt');
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
      {},
      { exists, createSignedUrl },
    );

    const result = await service.getLeadReference(LEAD_ID, new Date('2026-09-14T12:00:00.000Z'));

    expect(result.message).toBe('Imagen eliminada por política de retención.');
    expect(createSignedUrl).not.toHaveBeenCalled();
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
    const { service } = serviceWith({}, { listActiveRules });

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
    const { service } = serviceWith({}, { updateActiveRules });

    const result = await service.updatePricingRules([update], USER_ID);

    expect(updateActiveRules).toHaveBeenCalledWith([update], USER_ID);
    expect(result).toMatchObject({
      updatedCount: 1,
      message: 'Precios actualizados correctamente.',
    });
  });
});
