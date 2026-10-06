import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { DashboardService } from './dashboard.service.js';

describe('DashboardService account isolation', () => {
  const accountA = '00000000-0000-4000-8000-000000000001';
  const accountB = '00000000-0000-4000-8000-000000000002';
  const leadA = '10000000-0000-4000-8000-000000000001';
  const leadB = '10000000-0000-4000-8000-000000000002';

  it('blocks cross-account lead details and signed image URLs before accessing storage', async () => {
    const leads = [
      { id: leadA, accountId: accountA },
      { id: leadB, accountId: accountB },
    ];
    const findFirst = vi.fn(({ where }: { where: { id: string; accountId: string } }) =>
      Promise.resolve(
        leads.find((lead) => lead.id === where.id && lead.accountId === where.accountId) ?? null,
      ),
    );
    const exists = vi.fn();
    const createSignedUrl = vi.fn();
    const service = new DashboardService(
      { lead: { findFirst } } as unknown as PrismaService,
      { exists, createSignedUrl } as unknown as StorageService,
    );

    await expect(service.getLead(accountA, leadB)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getLead(accountB, leadA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getLeadReference(accountA, leadB)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getLeadReference(accountB, leadA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(exists).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('scopes both lead list and count to the authenticated account', async () => {
    const findMany = vi
      .fn<(argument: { where: { accountId: string } }) => Promise<unknown[]>>()
      .mockResolvedValue([]);
    const count = vi
      .fn<(argument: { where: { accountId: string } }) => Promise<number>>()
      .mockResolvedValue(0);
    const service = new DashboardService(
      { lead: { findMany, count } } as unknown as PrismaService,

      {} as StorageService,
    );
    const query = {
      filter: 'all' as const,
      archived: false,
      sortOrder: 'desc' as const,
      page: 1,
      pageSize: 20,
    };

    await service.listLeads(accountA, query);
    await service.listLeads(accountB, query);

    expect(findMany.mock.calls[0]?.[0].where.accountId).toBe(accountA);
    expect(findMany.mock.calls[1]?.[0].where.accountId).toBe(accountB);
    expect(count.mock.calls[0]?.[0].where.accountId).toBe(accountA);
    expect(count.mock.calls[1]?.[0].where.accountId).toBe(accountB);
  });
});
