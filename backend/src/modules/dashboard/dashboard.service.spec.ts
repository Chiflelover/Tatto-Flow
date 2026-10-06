const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
import { ConflictException } from '@nestjs/common';
import {
  LeadStatus,
  Prisma,
  type AiAnalysis,
  type Lead,
  type LeadImage,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { DashboardService } from './dashboard.service.js';
import type { LeadListQueryDto } from './dto/dashboard.dto.js';
import { persistedVision } from '../../../test/fixtures/vision-v2.js';

type DashboardLead = Lead & {
  customer: { phoneNumber: string };
  aiAnalysis: AiAnalysis | null;
  images: LeadImage[];
  quote: null;
};

const LEAD_ID = '290f2044-e63c-4e49-8847-067cd62426e4';

function makeLead(overrides: Partial<DashboardLead> = {}): DashboardLead {
  const now = new Date('2026-09-14T12:00:00.000Z');

  return {
    id: LEAD_ID,
    accountId: ACCOUNT_ID,
    customerId: '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e',
    conversationId: 'a459f257-b03c-48f4-9091-2dc37871ef81',
    bodyPart: 'Brazo',
    firstTattoo: null,
    sameSizeAsReference: null,
    targetSizeCm: null,
    colorDeclaration: null,
    v2Preparation: null,
    bookingIntent: null,
    status: LeadStatus.AUTO_QUOTED,
    manualFinalPrice: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    customer: { phoneNumber: '+51 999999999' },
    aiAnalysis: persistedVision(),
    quote: null,
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

function serviceWith(prismaShape: object, storageShape: object = {}) {
  const prisma = prismaShape as PrismaService;
  const storage = storageShape as StorageService;

  return { service: new DashboardService(prisma, storage) };
}

describe('DashboardService', () => {
  it.each(['price', 'targetSizeCm'] as const)(
    'sorts current leads by %s within the account',
    async (sortBy) => {
      const findMany = vi.fn().mockResolvedValue([]);
      const { service } = serviceWith({ lead: { findMany, count: vi.fn().mockResolvedValue(0) } });
      await service.listLeads(
        ACCOUNT_ID,
        leadQuery({ sortBy, sortOrder: 'asc', status: LeadStatus.SPECIAL_REVIEW }),
      );
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            accountId: ACCOUNT_ID,
            archivedAt: null,
            AND: [{ status: LeadStatus.SPECIAL_REVIEW }],
          },
          orderBy: [
            sortBy === 'price' ? { quote: { amount: 'asc' } } : { targetSizeCm: 'asc' },
            { createdAt: 'desc' },
          ],
        }),
      );
    },
  );

  it('exposes declared centimeters and persisted density without creating a price', async () => {
    const lead = makeLead({ targetSizeCm: 12.5, aiAnalysis: persistedVision() });
    const { service } = serviceWith({ lead: { findFirst: vi.fn().mockResolvedValue(lead) } });
    const result = await service.getLead(ACCOUNT_ID, LEAD_ID);
    expect(result).toMatchObject({
      targetSizeCm: 12.5,
      quote: null,
      manualFinalPrice: null,
      visionV2: { estimatedDensity: 34.5 },
    });
  });

  it.each([LeadStatus.ANALYZING, LeadStatus.AUTO_QUOTED, LeadStatus.READY_TO_COORDINATE])(
    'does not allow manual pricing in %s',
    async (status) => {
      const update = vi.fn();
      const { service } = serviceWith({
        lead: { findFirst: vi.fn().mockResolvedValue({ status, quote: null }), update },
      });
      await expect(service.saveManualFinalPrice(ACCOUNT_ID, LEAD_ID, 500)).rejects.toThrow(
        ConflictException,
      );
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('preserves an existing Quote when a lead is under review', async () => {
    const update = vi.fn();
    const { service } = serviceWith({
      lead: {
        findFirst: vi.fn().mockResolvedValue({
          status: LeadStatus.REQUIRES_REVIEW,
          quote: { id: 'current-quote' },
        }),
        update,
      },
    });
    await expect(service.saveManualFinalPrice(ACCOUNT_ID, LEAD_ID, 500)).rejects.toThrow(
      ConflictException,
    );
    expect(update).not.toHaveBeenCalled();
  });
  it('counts only complete Lead records and returns recent orders', async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(12);
    const findMany = vi.fn().mockResolvedValue([makeLead()]);
    const conversationFindMany = vi.fn().mockResolvedValue([{ currentState: 'ASK_COLOR' }]);
    const { service } = serviceWith({
      lead: { count, findMany },
      conversation: { findMany: conversationFindMany },
    });

    const result = await service.getMetrics(ACCOUNT_ID);

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
    ['verified' as const, LeadStatus.AUTO_QUOTED, 'Cotización automática lista'],
    ['requires-review' as const, LeadStatus.REQUIRES_REVIEW, 'Requiere revisión'],
  ])('lists the %s lead filter', async (filter, status, expectedLabel) => {
    const findMany = vi.fn().mockResolvedValue([makeLead({ status })]);
    const count = vi.fn().mockResolvedValue(1);
    const { service } = serviceWith({ lead: { findMany, count } });

    const result = await service.listLeads(ACCOUNT_ID, leadQuery({ filter }));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: ACCOUNT_ID,
          archivedAt: null,
          status: {
            in:
              filter === 'verified'
                ? ['AUTO_QUOTED', 'READY_TO_COORDINATE']
                : ['REQUIRES_REVIEW', 'SPECIAL_REVIEW'],
          },
        },
        include: expect.objectContaining({
          customer: { select: { phoneNumber: true } },
          aiAnalysis: {
            select: {
              style: true,
            },
          },
        }) as unknown,
        orderBy: [{ createdAt: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
    expect(result.leads[0]?.statusLabel).toBe(expectedLabel);
  });

  it('serializes manual prices and preserves pending quotes', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        makeLead({ manualFinalPrice: new Prisma.Decimal('650.00') }),
        makeLead({ id: crypto.randomUUID(), manualFinalPrice: null }),
      ]);
    const { service } = serviceWith({
      lead: { findMany, count: vi.fn().mockResolvedValue(2) },
    });

    const result = await service.listLeads(ACCOUNT_ID, leadQuery());

    expect(result.leads[0]).toMatchObject({
      manualFinalPrice: '650.00',
    });
    expect(result.leads[1]).toMatchObject({
      manualFinalPrice: null,
    });
  });

  it('creates a five-minute signed URL for a stored image regardless of age', async () => {
    const storagePath =
      'leads/290f2044-e63c-4e49-8847-067cd62426e4/bf3b934c-8338-45f3-992f-3ad65c3ce537.png';
    const exists = vi.fn().mockResolvedValue(true);
    const createSignedUrl = vi.fn().mockResolvedValue('https://temporary.example/signed');
    const { service } = serviceWith(
      {
        lead: {
          findFirst: vi.fn().mockResolvedValue({
            id: LEAD_ID,
            accountId: ACCOUNT_ID,
            images: [
              { id: 'image-1', storagePath, createdAt: new Date('2025-01-01T00:00:00.000Z') },
            ],
          }),
        },
      },
      { exists, createSignedUrl },
    );

    await expect(service.getLeadReference(ACCOUNT_ID, LEAD_ID)).resolves.toEqual({
      available: true,
      imageId: 'image-1',
      signedUrl: 'https://temporary.example/signed',
      expiresInSeconds: 300,
      message: null,
    });
    expect(exists).toHaveBeenCalledWith(storagePath);
    expect(createSignedUrl).toHaveBeenCalledWith(storagePath, 300);
  });

  it('does not sign a manually deleted image', async () => {
    const exists = vi.fn();
    const createSignedUrl = vi.fn();
    const { service } = serviceWith(
      {
        lead: {
          findFirst: vi.fn().mockResolvedValue({ id: LEAD_ID, images: [] }),
        },
      },
      { exists, createSignedUrl },
    );

    await expect(service.getLeadReference(ACCOUNT_ID, LEAD_ID)).resolves.toEqual({
      available: false,
      imageId: null,
      signedUrl: null,
      expiresInSeconds: null,
      message: 'Imagen no disponible.',
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
          findFirst: vi.fn().mockResolvedValue({
            id: LEAD_ID,
            accountId: ACCOUNT_ID,
            images: [
              {
                storagePath:
                  'leads/290f2044-e63c-4e49-8847-067cd62426e4/bf3b934c-8338-45f3-992f-3ad65c3ce537.png',
              },
            ],
          }),
        },
      },
      { exists, createSignedUrl },
    );

    const result = await service.getLeadReference(ACCOUNT_ID, LEAD_ID);

    expect(result.message).toBe('Imagen no disponible.');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('marks an attended lead as COMPLETED so the customer can request a new quotation', async () => {
    const completedLead = makeLead({ status: LeadStatus.COMPLETED });
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ status: LeadStatus.AUTO_QUOTED })
      .mockResolvedValueOnce(completedLead);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { service } = serviceWith({ lead: { findFirst, updateMany } });

    const result = await service.completeLead(ACCOUNT_ID, LEAD_ID);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: LEAD_ID,
        accountId: ACCOUNT_ID,
        status: {
          in: [
            LeadStatus.REQUIRES_REVIEW,
            LeadStatus.HANDOFF_TO_TATTOO_ARTIST,
            LeadStatus.AUTO_QUOTED,
            LeadStatus.SPECIAL_REVIEW,
            LeadStatus.READY_TO_COORDINATE,
          ],
        },
      },
      data: { status: LeadStatus.COMPLETED },
    });
    expect(result.status).toBe(LeadStatus.COMPLETED);
  });

  it('keeps completing a lead idempotent', async () => {
    const completedLead = makeLead({ status: LeadStatus.COMPLETED });
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ status: LeadStatus.COMPLETED })
      .mockResolvedValueOnce(completedLead);
    const updateMany = vi.fn();
    const { service } = serviceWith({ lead: { findFirst, updateMany } });

    await expect(service.completeLead(ACCOUNT_ID, LEAD_ID)).resolves.toMatchObject({
      status: LeadStatus.COMPLETED,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('saves a manual final price without changing the lead status or conversation', async () => {
    const updatedLead = makeLead({
      status: LeadStatus.REQUIRES_REVIEW,
      manualFinalPrice: new Prisma.Decimal('650.00'),
    });
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ status: LeadStatus.REQUIRES_REVIEW, quote: null })
      .mockResolvedValueOnce(updatedLead);
    const update = vi.fn().mockResolvedValue({ id: LEAD_ID });
    const { service } = serviceWith({ lead: { findFirst, update } });

    const result = await service.saveManualFinalPrice(ACCOUNT_ID, LEAD_ID, 650);

    expect(update).toHaveBeenCalledOnce();
    const updateCalls = update.mock.calls as Array<
      [{ data: { manualFinalPrice: Prisma.Decimal } }]
    >;
    const updateData = updateCalls[0][0].data;
    expect(Object.keys(updateData)).toEqual(['manualFinalPrice']);
    expect(String(updateData.manualFinalPrice)).toBe('650');
    expect(result).toMatchObject({
      status: LeadStatus.REQUIRES_REVIEW,
      manualFinalPrice: '650.00',
    });
  });

  it('allows editing an existing manual final price', async () => {
    const updatedLead = makeLead({
      status: LeadStatus.REQUIRES_REVIEW,
      manualFinalPrice: new Prisma.Decimal('725.50'),
    });
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ status: LeadStatus.REQUIRES_REVIEW, quote: null })
      .mockResolvedValueOnce(updatedLead);
    const update = vi.fn().mockResolvedValue({ id: LEAD_ID });
    const { service } = serviceWith({ lead: { findFirst, update } });

    await expect(service.saveManualFinalPrice(ACCOUNT_ID, LEAD_ID, 725.5)).resolves.toMatchObject({
      manualFinalPrice: '725.50',
      status: LeadStatus.REQUIRES_REVIEW,
    });
  });

  it('does not finalize a lead while image analysis is still running', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const { service } = serviceWith({
      lead: {
        findFirst: vi.fn().mockResolvedValue({ status: LeadStatus.ANALYZING }),
        updateMany,
      },
    });

    await expect(service.completeLead(ACCOUNT_ID, LEAD_ID)).rejects.toEqual(
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

    const result = await service.listLeads(ACCOUNT_ID, leadQuery());

    expect(result.leads).toEqual([]);
    expect(findMany).toHaveBeenCalledOnce();
    expect(conversationFindMany).not.toHaveBeenCalled();
  });
});
