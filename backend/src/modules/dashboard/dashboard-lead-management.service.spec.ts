const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
import { ConflictException } from '@nestjs/common';
import { ConversationStatus, LeadStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { DashboardService } from './dashboard.service.js';
import type { LeadListQueryDto } from './dto/dashboard.dto.js';

const LEAD_ID = '290f2044-e63c-4e49-8847-067cd62426e4';
const CONVERSATION_ID = 'a459f257-b03c-48f4-9091-2dc37871ef81';
const CUSTOMER_ID = '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e';

function query(overrides: Partial<LeadListQueryDto> = {}): LeadListQueryDto {
  return {
    filter: 'all',
    archived: false,
    sortOrder: 'desc',
    page: 1,
    pageSize: 20,
    ...overrides,
  };
}

function createService(prismaShape: object, storageShape: object = {}) {
  return new DashboardService(prismaShape as PrismaService, storageShape as StorageService);
}

function completeLeadDetail(archivedAt: Date | null = null) {
  const now = new Date('2026-09-20T12:00:00.000Z');

  return {
    id: LEAD_ID,
    accountId: ACCOUNT_ID,
    customerId: crypto.randomUUID(),
    conversationId: CONVERSATION_ID,
    bodyPart: 'Brazo',
    status: LeadStatus.ANALYZING,
    manualFinalPrice: null,
    archivedAt,
    createdAt: now,
    updatedAt: now,
    customer: { phoneNumber: '+51999999999' },
    aiAnalysis: null,
    quote: null,
    conversation: { status: ConversationStatus.ABANDONED },
    targetSizeCm: null,
    v2Preparation: null,
    bookingIntent: null,
  };
}

describe('DashboardService lead management', () => {
  it.each([
    [false, null],
    [true, { not: null }],
  ])('uses archived=%s to select the appropriate inbox', async (archived, archivedAt) => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const service = createService({ lead: { findMany, count } });

    await service.listLeads(ACCOUNT_ID, query({ archived }));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: ACCOUNT_ID, archivedAt } }),
    );
  });

  it('orders the normal inbox by most recent leads', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = createService({
      lead: { findMany, count: vi.fn().mockResolvedValue(0) },
    });

    await service.listLeads(ACCOUNT_ID, query());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }],
      }),
    );
  });

  it('exposes finalized leads as deletable so the frontend follows backend policy', async () => {
    const finalizedLead = {
      ...completeLeadDetail(),
      status: LeadStatus.COMPLETED,
    };
    const service = createService({
      lead: {
        findMany: vi.fn().mockResolvedValue([finalizedLead]),
        count: vi.fn().mockResolvedValue(1),
      },
    });

    const result = await service.listLeads(ACCOUNT_ID, query());

    expect(result.leads[0]).toMatchObject({ id: LEAD_ID, deletable: true });
  });

  it('archives a lead logically and removes it from the normal inbox query', async () => {
    const detail = completeLeadDetail(new Date());
    const findFirst = vi.fn().mockResolvedValue(detail);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = createService({ lead: { findFirst, updateMany } });

    await service.archiveLead(ACCOUNT_ID, LEAD_ID);
    const anyDate: unknown = expect.any(Date);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: LEAD_ID, accountId: ACCOUNT_ID, archivedAt: null },
      data: { archivedAt: anyDate },
    });
  });

  it('restores an archived lead', async () => {
    const detail = completeLeadDetail(null);
    const findFirst = vi.fn().mockResolvedValue(detail);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = createService({ lead: { findFirst, updateMany } });

    await service.restoreLead(ACCOUNT_ID, LEAD_ID);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: LEAD_ID, accountId: ACCOUNT_ID, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
  });

  it('deletes an abandoned incomplete lead, its abandoned conversation and its storage objects', async () => {
    const storagePath = `leads/${LEAD_ID}/${crypto.randomUUID()}.png`;
    const deleteObject = vi.fn().mockResolvedValue('deleted');
    const deleteLead = vi.fn().mockResolvedValue({ id: LEAD_ID });
    const deleteConversation = vi.fn().mockResolvedValue({ count: 1 });
    const deleteCustomer = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      lead: { delete: deleteLead },
      conversation: { deleteMany: deleteConversation },
      customer: { deleteMany: deleteCustomer },
    };
    const service = createService(
      {
        lead: {
          findFirst: vi.fn().mockResolvedValue({
            id: LEAD_ID,
            accountId: ACCOUNT_ID,
            customerId: CUSTOMER_ID,
            conversationId: CONVERSATION_ID,
            status: LeadStatus.ANALYZING,
            manualFinalPrice: null,
            conversation: { status: ConversationStatus.ABANDONED },
            images: [{ storagePath }],
          }),
        },
        customer: { delete: deleteCustomer },
        $transaction: vi.fn((callback: (client: typeof transaction) => Promise<void>) =>
          callback(transaction),
        ),
      },
      { delete: deleteObject },
    );

    await expect(service.deleteIncompleteLead(ACCOUNT_ID, LEAD_ID)).resolves.toEqual({
      deleted: true,
      leadId: LEAD_ID,
    });
    expect(deleteObject).toHaveBeenCalledWith(storagePath);
    expect(deleteLead).toHaveBeenCalledWith({ where: { id: LEAD_ID } });
    expect(deleteConversation).toHaveBeenCalledWith({
      where: {
        id: CONVERSATION_ID,
        accountId: ACCOUNT_ID,
        status: { in: [ConversationStatus.ABANDONED, ConversationStatus.COMPLETED] },
      },
    });
    expect(deleteCustomer).toHaveBeenCalledWith({
      where: {
        id: CUSTOMER_ID,
        accountId: ACCOUNT_ID,
        leads: { none: {} },
        conversations: { none: {} },
      },
    });
  });

  it('deletes a finalized lead regardless of its previous status and manual price', async () => {
    const storagePath = `leads/${LEAD_ID}/${crypto.randomUUID()}.webp`;
    const deleteObject = vi.fn().mockResolvedValue('deleted');
    const deleteLead = vi.fn().mockResolvedValue({ id: LEAD_ID });
    const deleteConversation = vi.fn().mockResolvedValue({ count: 1 });
    const deleteCustomer = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      lead: { delete: deleteLead },
      conversation: { deleteMany: deleteConversation },
      customer: { deleteMany: deleteCustomer },
    };
    const service = createService(
      {
        lead: {
          findFirst: vi.fn().mockResolvedValue({
            id: LEAD_ID,
            accountId: ACCOUNT_ID,
            customerId: CUSTOMER_ID,
            conversationId: CONVERSATION_ID,
            status: LeadStatus.COMPLETED,
            manualFinalPrice: new Prisma.Decimal(175),
            images: [{ storagePath }],
          }),
        },
        $transaction: vi.fn((callback: (client: typeof transaction) => Promise<void>) =>
          callback(transaction),
        ),
      },
      { delete: deleteObject },
    );

    await expect(service.deleteIncompleteLead(ACCOUNT_ID, LEAD_ID)).resolves.toEqual({
      deleted: true,
      leadId: LEAD_ID,
    });
    expect(deleteObject).toHaveBeenCalledWith(storagePath);
    expect(deleteLead).toHaveBeenCalledWith({ where: { id: LEAD_ID } });
    expect(deleteConversation).toHaveBeenCalledWith({
      where: {
        id: CONVERSATION_ID,
        accountId: ACCOUNT_ID,
        status: { in: [ConversationStatus.ABANDONED, ConversationStatus.COMPLETED] },
      },
    });
    expect(deleteCustomer).toHaveBeenCalledOnce();
  });

  it.each([LeadStatus.AUTO_QUOTED, LeadStatus.REQUIRES_REVIEW, LeadStatus.ANALYZING])(
    'rejects deletion when status is %s',
    async (status) => {
      const deleteObject = vi.fn();
      const transaction = vi.fn();
      const service = createService(
        {
          lead: {
            findFirst: vi.fn().mockResolvedValue({
              id: LEAD_ID,
              accountId: ACCOUNT_ID,
              customerId: CUSTOMER_ID,
              conversationId: CONVERSATION_ID,
              status: status,
              manualFinalPrice: null,
              conversation: { status: ConversationStatus.ACTIVE },
              images: [],
            }),
          },
          $transaction: transaction,
        },
        { delete: deleteObject },
      );

      await expect(service.deleteIncompleteLead(ACCOUNT_ID, LEAD_ID)).rejects.toEqual(
        new ConflictException('Solo se pueden eliminar leads incompletos sin cotización.'),
      );
      expect(deleteObject).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
